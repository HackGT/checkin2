declare let mdc: any;
declare let moment: any;

import { ApolloClient } from "apollo-client";
import { createHttpLink } from "apollo-link-http";
import { InMemoryCache } from 'apollo-cache-inmemory';
import gql from 'graphql-tag';

const link = createHttpLink({
	uri: "/graphql",
	credentials: "same-origin"
});

const client = new ApolloClient({
	link: link,
	cache: new InMemoryCache()
});

class State {
	public linkID: string;
	public sectionID: string;
	public isDisplayed: boolean = false;
	private link: HTMLAnchorElement;
	private section: HTMLElement;
	private readonly drawerSelectedClass = "mdc-temporary-drawer--selected";
	constructor(linkID: string, sectionID: string) {
		this.linkID = linkID;
		this.sectionID = sectionID;

		let link = document.getElementById(linkID);
		if (!link) {
			throw new Error("Invalid link ID");
		}
		this.link = link as HTMLAnchorElement;
		this.link.addEventListener("click", async e => {
			await delay(10);
			drawer.open = false;
			this.show();
			if (States["checkin"] === this) {
				loadAttendees();
			}
		});

		let section = document.getElementById(sectionID);
		if (!section) {
			throw new Error("Invalid section ID");
		}
		this.section = section as HTMLElement;
	}
	static hideAll(): void {
		Object.keys(States).forEach(stateKey => States[stateKey].hide());
	}
	hide(): void {
		this.isDisplayed = false;
		this.link.classList.remove(this.drawerSelectedClass);
		this.section.style.display = "none";
	}
	show(hideOthers: boolean = true): void {
		if (hideOthers) State.hideAll();
		this.isDisplayed = true;
		this.link.classList.add(this.drawerSelectedClass);
		this.section.style.display = "block";
		window.scrollTo(0, 0);
	}
}
const States: { [key: string]: State } = {
	"checkin": new State("open-checkin", "checkin"),
	"attendees": new State("open-attendees", "import"),
	"users": new State("open-users", "manage-users"),
	"tags": new State("open-tags", "edit-tags")
};

// Set the correct state on page load
function readURLHash() {
	let state: State | undefined = States[window.location.hash.substr(1)];
	if (state) {
		state.show();
	}
	else {
		States["checkin"].show();
	}
}
readURLHash();
window.addEventListener("hashchange", readURLHash);

interface IGraphqlTag {
	tag: {
		name: string
	};
	checked_in: boolean;
	checked_in_by?: string;
	checked_in_date?: string;
}

interface IGraphqlQuestion {
	name: string;
	value: string;
}

interface IGraphqlAttendee {
	user: {
		id: string,
		name: string,
		email: string,
		questions?: IGraphqlQuestion[]
	};
	tags: IGraphqlTag[];
}

interface ISearchUserResponse {
	data: {
		search_user_simple: IGraphqlAttendee[];
	}
}

// interface ITagChangeResponse {
// 	tag_change: IGraphqlAttendee;
// }

const graphqlOptions = {
	dataType: "text",
	responseType: "json",
	headers: {
		"Content-Type": "application/json",
		"Accept": "application/json"
	}
}

function delay (milliseconds: number) {
	return new Promise<void>(resolve => {
		setTimeout(resolve, milliseconds);
	});
}

function statusFormatter (time: string, by: string = "unknown"): string {
	// Escape possible HTML in username
	by = by.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const date: Date = new Date(time);
	return `Checked in <abbr title="${moment(date).format("dddd, MMMM Do YYYY, h:mm:ss A")}">${moment(time).fromNow()}</abbr> by <code>${by}</code>`;
}

function checkIn (e: Event) {
	let button = (<HTMLButtonElement> e.target)!;
	let isCheckedIn: boolean = button.classList.contains("checked-in");
	button.disabled = true;
	let tag: string = tagSelector.value;
	let id: string = button.parentElement!.parentElement!.id.slice(5);
	let action: string = isCheckedIn ? "check_out" : "check_in";

	let mutation: string = `mutation UserAndTags($user: ID!, $tag: String!) {
	  ${action}(user: $user, tag: $tag) {
		tags {
		  tag {
			name
		  }
		  checked_in
		}
	  }
	}`;

	qwest.post("/graphql", JSON.stringify({
		query: mutation,
		variables: {
			user: id,
			tag: tag
		}
	}), graphqlOptions).catch((e, xhr, response) => {
		alert(response.error);
	}).complete(() => {
		button.disabled = false;
	});
}

function attachUserDeleteHandlers () {
	let deleteButtons = document.querySelectorAll("#manage-users .actions > button");
	for (let i = 0; i < deleteButtons.length; i++) {
		deleteButtons[i].addEventListener("click", e => {
			let source = (<HTMLButtonElement> e.target)!;
			let username: string = source.parentElement!.parentElement!.dataset.username!;
			let extraWarn: boolean = !!source.parentElement!.querySelector(".status");
			const extraWarnMessage = `**YOU ARE TRYING TO DELETE THE ACCOUNT THAT YOU ARE CURRENTLY LOGGED IN WITH. THIS WILL DELETE YOUR USER AND LOG YOU OUT.**`;

			let shouldContinue: boolean = confirm(`${extraWarn ? extraWarnMessage + "\n\n": ""}Are you sure that you want to delete the user '${username}'?`);
			if (!shouldContinue)
				return;

			source.disabled = true;
			qwest.delete("/api/user/update", {
				username: username
			}).then((xhr, response) => {
				let toRemove = document.querySelector(`li[data-username="${username}"]`);
				if (toRemove && toRemove.parentElement) {
					toRemove.parentElement.removeChild(toRemove);
				}
				// Reattach button event handlers
				attachUserDeleteHandlers();

				if (response.reauth) {
					window.location.reload();
				}
			}).catch((e, xhr, response) => {
				alert(response.error);
			}).complete(() => {
				source.disabled = false;
			});
		});
	}
}

let queryField = <HTMLInputElement> document.getElementById("query")!;
queryField.addEventListener("keyup", e => {
	loadAttendees();
});
let checkedInFilterField = <HTMLSelectElement> document.getElementById("checked-in-filter")!;
checkedInFilterField.addEventListener("change", e => {
	loadAttendees();
});
let tagSelector = <HTMLSelectElement> document.getElementById("tag-choose")!;
tagSelector.addEventListener("change", e => {
	if (!States["checkin"].isDisplayed) {
		States["checkin"].show();
	}
	drawer.open = false;
	loadAttendees();
});
let tagDeleteSelector = <HTMLSelectElement> document.getElementById("tag-delete")!;
tagDeleteSelector.addEventListener("change", e => {
	let tag: string = tagDeleteSelector.value;
	if (!tag)
		return;
	let shouldContinue = confirm(`Are you sure that you want to delete all attendees tagged with '${tag}'?`);
	if (!shouldContinue) {
		tagDeleteSelector.selectedIndex = 0;
		return;
	}
	tagDeleteSelector.disabled = true;
	qwest.delete(`/api/data/tag/${tag}`)
	.then(() => {
		drawer.open = false;

		let deleteIndex: number = tagDeleteSelector.selectedIndex;
		tagDeleteSelector.removeChild(tagDeleteSelector.options[deleteIndex]);
		tagSelector.removeChild(tagSelector.options[deleteIndex - 1]); // - 1 compensates for default "please choose" <option>
		loadAttendees();
	})
	.catch((e, xhr, response) => {
		alert(response.error);
	}).complete(() => {
		tagDeleteSelector.disabled = false;
	});
});

function loadAttendees (filter: string = queryField.value, checkedIn: string = checkedInFilterField.value) {
	let status = document.getElementById("loading-status")!;
	status.textContent = "Loading...";

	let tag: string = tagSelector.value;

	// Get checked question options
	let checked: string[] = [];
	let checkedElems = document.querySelectorAll("#question-options input:checked") as NodeListOf<HTMLInputElement>;
	for (let i = 0; i < checkedElems.length; i++) {
		checked.push(checkedElems[i].value);
	}

	// Create filter query based on selected values
	let registrationFilter: any = {};
	let subgroup = document.getElementById("attending-filter") as HTMLInputElement;
	if (subgroup.value) {
		registrationFilter[subgroup.value] = true;
	}
	let branch = document.getElementById("branches-filter") as HTMLInputElement;
	if (branch.value) {
		registrationFilter.application_branch = branch.value; 
	}
	const confirmationBranch = document.getElementById("confirmation-branches-filter") as HTMLInputElement;
	if (confirmationBranch.value) {
		registrationFilter.confirmation_branch = confirmationBranch.value;
	}

	// TODO: some kind of pagination when displaying users
	let query: string = `query UserAndTags($search: String!, $questions: [String!]!, $filter: UserFilter) {
		search_user_simple(search: $search, n: 25, offset: 0, filter: $filter) {
			user {
				id 
				name 
				email
				questions(names: $questions) {
					name
					value
					values
					file {
						path
						original_name
					}
				} 
			} 
			tags {
				tag {
					name 
				} 
				checked_in
				checked_in_by
				checked_in_date 
			} 
		} 
	}`;

	qwest.post("/graphql", JSON.stringify({
		query: query,
		variables: {
			search: filter || " ",
			questions: checked,
			filter: registrationFilter
		}
	}), graphqlOptions).then((xhr, response: ISearchUserResponse) => {
		let attendees: IGraphqlAttendee[] = response.data.search_user_simple;

		let attendeeList = document.getElementById("attendees")!;
		let attendeeTemplate = <HTMLTemplateElement> document.getElementById("attendee-item")!;
		let numberOfExistingNodes = document.querySelectorAll("#attendees li").length;

		if (!attendeeList.firstChild || numberOfExistingNodes < attendees.length) {
			// First load, preallocate children
			status.textContent = "Preallocating nodes...";
			for (let i = numberOfExistingNodes; i < attendees.length; i++) {
				let node = document.importNode(attendeeTemplate.content, true) as DocumentFragment;
				node.querySelector("li")!.style.display = "none";
				node.querySelector(".actions > button")!.addEventListener("click", checkIn);
				attendeeList.appendChild(node);
			}
			(<any> window).mdc.autoInit();
			console.warn(`Allocated ${attendees.length - numberOfExistingNodes} nodes due to insufficient number`);
			status.textContent = "Loading...";
		}

		// Reuse nodes already loaded from template
		let existingNodes = document.querySelectorAll("#attendees li") as NodeListOf<HTMLElement>;
		for (let i = 0; i < existingNodes.length; i++) {
			let attendee = attendees[i];
			if (!!attendee) {
				existingNodes[i].style.display = "";

				existingNodes[i].id = "item-" + attendee.user.id;
				existingNodes[i].querySelector("#name")!.textContent = attendee.user.name;
				existingNodes[i].querySelector("#emails")!.textContent = attendee.user.email;

				let button = existingNodes[i].querySelector(".actions > button")!;
				let status = existingNodes[i].querySelector(".actions > span.status")!;

				// Determine if user has the current tag
				let tagInfo: IGraphqlTag[] = attendee.tags.filter(curr => curr.tag.name === tag );

				if (tagInfo.length > 0 && tagInfo[0].checked_in) {
					button.textContent = "Uncheck in";
					button.classList.add("checked-in");

					let date = tagInfo[0].checked_in_date;
					if (date && tagInfo[0].checked_in_by) {
						status.innerHTML = statusFormatter(date, tagInfo[0].checked_in_by);
					}
				}
				else {
					button.textContent = "Check in";
					button.classList.remove("checked-in");
					status.textContent = "";
				}
				if (attendee.user.questions) {
					const infoToText = (info: {
						name: string;
						value?: string;
						values?: string[];
						file?: {
							path: string;
							original_name: string;
						}
					}) => {
						if (info.value) {
							return `${info.name}: ${info.value}`;
						}
						else if (info.values) {
							return `${info.name}: ${info.values.join(",")}`;
						}
						else if (info.file) {
							const path = encodeURIComponent(info.file.path);
							const url = `${location.protocol}//${location.host}/uploads?file=${path}`;
							return `${info.name}: <a href="${url}">${info.file.original_name}</a>`;
						}
						return `${info.name}: Not given.`;
					};
					let registrationInformation = attendee.user.questions.map(infoToText);
					existingNodes[i].querySelector("#additional-info")!.innerHTML = registrationInformation.join("<br>");
				}
			}
			else {
				existingNodes[i].style.display = "none";
				existingNodes[i].id = "";
			}
		}
		tag = tag || "no tags found";
		tag = tag.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		status.innerHTML = `Found ${attendees.length} attendee${attendees.length === 1 ? "" : "s"} (<code>${tag}</code>)`;
	}).catch((e, xhr, response) => {
		status.textContent = "An error occurred";
		alert(response.error);
	});
}

function updateTagSelectors(newTags: string[]) {
	// Get current list of tags
	let tags: string[] = Array.prototype.slice.call(document.querySelectorAll("#tag-choose > option")).map((el: HTMLOptionElement) => {
		return el.textContent;
	});
	for (let curr of newTags) {
		if (tags.indexOf(curr) === -1) {
			const tagsList = document.querySelectorAll("select.tags");
			Array.prototype.slice.call(tagsList).forEach((el: HTMLSelectElement) => {
				let tagOption = document.createElement("option");
				tagOption.textContent = curr;
				el.appendChild(tagOption);
			});
		}
	}
}

mdc.ripple.MDCRipple.attachTo(document.querySelector(".mdc-ripple-surface"));
let drawer = new mdc.drawer.MDCTemporaryDrawer(document.querySelector(".mdc-temporary-drawer"));
document.querySelector("nav.toolbar > i:first-of-type")!.addEventListener("click", () => {
	drawer.open = !drawer.open;
});

document.getElementById("import-attendees")!.addEventListener("click", e => {
	let button = (<HTMLButtonElement> e.target)!;
	button.disabled = true;

	let form = new FormData();
	let fileInput = <HTMLInputElement> document.querySelector(`#import input[type="file"]`)!;
	let tagInput = <HTMLInputElement> document.getElementById("import-tag");
	let tag: string = tagInput.value.trim().toLowerCase();
	let nameInput = <HTMLInputElement> document.getElementById("name-header");
	let emailInput = <HTMLInputElement> document.getElementById("email-headers");
	if (!fileInput.files || fileInput.files.length < 1) {
		alert("Please choose a CSV file to upload");
		button.disabled = false;
		return;
	}
	form.append("import", fileInput.files[0]);
	form.append("tag", tagInput.value);
	form.append("name", nameInput.value);
	form.append("email", emailInput.value.replace(/, /g, ","));

	qwest.post("/api/data/import", 
		form
	).then(() => {
		// Clear the form
		[fileInput, tagInput, nameInput, emailInput].forEach((el) => {
			el.value = el.defaultValue;
		});
		// Add new tags to the options list
		let newTags: string[] = tag.toLowerCase().split(/, */);
		updateTagSelectors(newTags);
		alert("Successfully imported attendees");
	}).catch((e, xhr, response) => {
		alert(response.error);
	}).complete(() => {
		button.disabled = false;
	});
});

document.getElementById("add-update-user")!.addEventListener("click", e => {
	let button = (<HTMLButtonElement> e.target)!;
	button.disabled = true;

	let usernameInput = <HTMLInputElement> document.getElementById("manage-username");
	let passwordInput = <HTMLInputElement> document.getElementById("manage-password");
	let username = usernameInput.value.trim();
	let password = passwordInput.value;
	qwest.put("/api/user/update", {
		username: username,
		password: password
	}).then((xhr, response) => {
		if (response.created) {
			alert(`User '${username}' was successfully created`);
		}
		else {
			alert(`Password for user '${username}' successfully updated. All active sessions with this account will need to log in again.`);
		}
		window.location.reload();

	}).catch((e, xhr, response) => {
		alert(response.error);
	}).complete(() => {
		button.disabled = false;
	});
});

document.getElementById("add-attendee")!.addEventListener("click", e => {
	let button = (<HTMLButtonElement> e.target)!;
	button.disabled = true;

	let ids = ["add-tag", "add-name", "add-email"];
	let [tagInput, nameInput, emailInput] = ids.map(id => <HTMLInputElement> document.getElementById(id));
	if (!tagInput.value.trim()) {
		alert("Please enter a tag");
		button.disabled = false;
		return;
	}

	qwest.put(`/api/data/tag/${tagInput.value.trim()}`, {
		"name": nameInput.value.trim(),
		"email": emailInput.value.replace(/, /g, ",").trim()
	}).then(() => {
		// Add new tags to the options list
		let newTags: string[] = tagInput.value.toLowerCase().split(/, */)
		updateTagSelectors(newTags);
		// Clear the form
		[tagInput, nameInput, emailInput].forEach((el) => {
			el.value = el.defaultValue;
		});
		ids.forEach(id => {
			document.querySelector(`label[for="${id}"]`)!.classList.remove("mdc-textfield__label--float-above");
		});
		alert("Successfully added new attendee");
	}).catch((e, xhr, response) => {
		alert(response.error);
	}).complete(() => {
		button.disabled = false;
	});
});

// Add tags to users
document.getElementById("add-new-tag")!.addEventListener("click", e => {
	let button = e.target as HTMLButtonElement;
	button.disabled = true;

	let tagInput = <HTMLInputElement> document.getElementById("new-tag-name");
	let tag: string = tagInput.value.trim().toLowerCase();
	if (!tag) {
		alert("Please enter a tag name");
		button.disabled = false;
		return;
	}

	qwest.post("/graphql", JSON.stringify({
		query: `mutation Tag($tag: String!) {
			add_tag(tag: $tag) {
				name
			}
		}`,
		variables: {
			tag: tag
		}
	}), graphqlOptions).then((xhr, response) => {
		// Add to tag selectors
		updateTagSelectors([tag]);
		
		// Clear form
		tagInput.value = "";
		document.querySelector(`label[for="new-tag-name"]`)!.classList.remove("mdc-textfield__label--float-above");
		alert("Successfully added tag to attendee(s)!");
	}).catch((e, xhr, response) => {
		console.error(response);
		alert("An error occurred while adding the tag");
	}).complete(() => {
		button.disabled = false;
	});	
});

// Populate checkboxes for question names
qwest.post("/graphql", JSON.stringify({
	query: "{ question_names }"
}), graphqlOptions).then((xhr, response) => {
	let checkboxTemplate = <HTMLTemplateElement> document.getElementById("checkbox-item")!;
	let checkboxContainer = document.getElementById("question-options")!;
	let button = document.getElementById("button-row")!;
	if (!response.data || !response.data.question_names) {
		return;
	}

	let question_names: string[] = response.data.question_names.sort((a: string, b: string) => {
		return a.localeCompare(b);
	});

	for (let curr of question_names) {
		let node = document.importNode(checkboxTemplate.content, true) as DocumentFragment;
		let input = node.querySelector("input") as HTMLInputElement;
		let label = node.querySelector("label") as HTMLLabelElement;
		input.id = curr;
		input.value = curr;
		label.htmlFor = curr;
		label.textContent = curr;
		checkboxContainer.insertBefore(node, button);
	}	
}).catch((e, xhr, response) => {
	console.error(response);
	alert("Error fetching registration question names");
});

// Toggle display of question checkboxes
document.querySelector("#question-options-wrapper span")!.addEventListener("click", e => {
	let elem = document.getElementById("question-options")!;
	elem.style.display = elem.style.display == "none" ? "" : "none";
});

document.getElementById("update-question-options")!.addEventListener("click", e => {
	loadAttendees();
});

// Toggle display of filters
document.querySelector("#filters-wrapper span")!.addEventListener("click", e => {
	let elem = document.getElementById("filters")!;
	elem.style.display = elem.style.display == "none" ? "" : "none";
});

document.getElementById("attending-filter")!.addEventListener("change", e => {
	loadAttendees();
});

// Populate application branches select options
qwest.post("/graphql", JSON.stringify({
	query: "{ application_branches }"
}), graphqlOptions).then((xhr, response) => {
	let select = document.getElementById("branches-filter")!;
	let branches = response.data.application_branches;

	for (let curr of branches) {
		let option = document.createElement("option");
		option.textContent = curr;
		option.value = curr;
		select.appendChild(option);
	}
}).catch((e, xhr, response) => {
	console.error(response, e);
	alert("Error fetching registration application branches");
});

// Populate application branches select options
qwest.post("/graphql", JSON.stringify({
	query: "{ confirmation_branches }"
}), graphqlOptions).then((xhr, response) => {
	let select = document.getElementById("confirmation-branches-filter")!;
	let branches = response.data.confirmation_branches;

	for (let curr of branches) {
		let option = document.createElement("option");
		option.textContent = curr;
		option.value = curr;
		select.appendChild(option);
	}
}).catch((e, xhr, response) => {
	console.error(response, e);
	alert("Error fetching registration confirmation branches");
});

document.getElementById("branches-filter")!.addEventListener("change", e => {
	loadAttendees();
});

document.getElementById("confirmation-branches-filter")!.addEventListener("change", e => {
	loadAttendees();
});

attachUserDeleteHandlers();
// Update check in relative times every minute the lazy way
setInterval(() => {
	if (States["checkin"].isDisplayed) {
		loadAttendees();
	}
}, 1000 * 60);
loadAttendees();


client.query({
		query: gql`{
		  tags {
		    name
		  }
		}`
	})
	.then(data => console.log(data))
	.catch(error => console.log(error));

// // Set up graphql subscriptions listener
// declare let SubscriptionsTransportWs: any;

// import * as apollo from "apollo-client";
// import * as gqlRaw from "graphql-tag";
// // Types not working for some reason so we'll apply them manually here instead
// // TODO: Super hacky please fix
// const gql = <any>gqlRaw as (literals: any, ...placeholders: any[]) => any;

// const networkInterface = apollo.createNetworkInterface({
//  uri: '/graphql'
// });

// const wsProtocol = location.protocol === "http:" ? "ws" : "wss";
// const wsClient = new SubscriptionsTransportWs.SubscriptionClient(`${wsProtocol}://${window.location.host}/graphql`, {
// 	reconnect: true,
// });

// const networkInterfaceWithSubscriptions = SubscriptionsTransportWs.addGraphQLSubscriptions(
// 	networkInterface,
// 	wsClient
// );

// const apolloClient = new apollo.ApolloClient({
// 	networkInterface: networkInterfaceWithSubscriptions
// });

// const subscriptionQuery = gql(`subscription {
//   tag_change {
// 	user {
// 	  id
// 	  name
// 	  email
// 	}
// 	tags {
// 	  tag {
// 		name
// 	  }
// 	  checked_in
// 	  checked_in_by
// 	  checked_in_date
// 	}
//   }
// }`);

// apolloClient.subscribe({
// 	query: subscriptionQuery,
// 	variables: {}
// }).subscribe({ 
// 	next (data: ITagChangeResponse) {
// 		let attendee: IGraphqlAttendee = data.tag_change;

// 		if (!States["checkin"].isDisplayed)
// 			return;

// 		let tag: string = tagSelector.value;
// 		// Filter by the currently shown tag
// 		let attendeeTags = attendee.tags.filter((t: IGraphqlTag) => t.tag.name === tag);
// 		let button = <HTMLButtonElement> document.querySelector(`#item-${attendee.user.id} > .actions > button`);

// 		if (!button) {
// 			// This attendee belongs to a tag that isn't currently being shown
// 			// This message can safely be ignored; the user list will be updated when switching tags
// 			return;
// 		}
// 		if (attendeeTags.length === 0) {
// 			// Check if the currently displayed tag is the tag that was just updated
// 			return;
// 		}
// 		let attendeeTag = attendeeTags[0];
// 		let status = <HTMLSpanElement> document.querySelector(`#${button.parentElement!.parentElement!.id} > .actions > span.status`)!;

// 		if (attendeeTag.checked_in) {
// 			button.textContent = "Uncheck in";
// 			button.classList.add("checked-in");
// 			if (attendeeTag.checked_in_date && attendeeTag.checked_in_by) {
// 				status.innerHTML = statusFormatter(attendeeTag.checked_in_date, attendeeTag.checked_in_by);
// 			} 
// 		}
// 		else {
// 			button.textContent = "Check in";
// 			button.classList.remove("checked-in");
// 			status.textContent = "";
// 		}
// 	}
// });
