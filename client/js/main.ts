/// <reference path="../../apis/checkin.d.ts" />

declare let mdc: any;
declare let moment: any;

import {ApolloClient} from "apollo-client";
import {split} from "apollo-link";
import {createHttpLink} from "apollo-link-http";
import {InMemoryCache} from "apollo-cache-inmemory";
import {WebSocketLink} from "apollo-link-ws";
import {SubscriptionClient} from "subscriptions-transport-ws";
import {getOperationAST} from "graphql";
import gql from "graphql-tag";
import swal from "sweetalert2";

const httpLink = createHttpLink({
	uri: "/graphql",
	credentials: "same-origin"
});

const wsProtocol = location.protocol === "http:" ? "ws" : "wss";
const wsClient = new SubscriptionClient(`${wsProtocol}://${window.location.host}/graphql`, {
	reconnect: true
});
const wsLink = new WebSocketLink(wsClient);

const link = split(
	// split based on operation type
	operation => {
		const operationAST = getOperationAST(operation.query, operation.operationName);
		return !!operationAST && operationAST.operation === 'subscription';
	},
	wsLink,
	httpLink
);

const client = new ApolloClient({
	link: link,
	cache: new InMemoryCache(),
	defaultOptions: {
		query: {
			fetchPolicy: "network-only"
		}
	}
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
	"users": new State("open-users", "manage-users"),
	"tags": new State("open-tags", "edit-tags")
};

// Set the correct state on page load
function readURLHash() {
	let state: State | undefined = States[window.location.hash.substr(1)];
	if (state) {
		state.show();
	} else {
		States["checkin"].show();
	}
}

readURLHash();
window.addEventListener("hashchange", readURLHash);

function delay(milliseconds: number) {
	return new Promise<void>(resolve => {
		setTimeout(resolve, milliseconds);
	});
}

function statusFormatter(time: string, by: string): string {
	// Escape possible HTML in username
	by = by.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const date: Date = new Date(time);
	return `Checked in <abbr title="${moment(date).format("dddd, MMMM Do YYYY, h:mm:ss A")}">${moment(time).fromNow()}</abbr> by <code>${by}</code>`;
}

function catalystCalculateAge(dob: Date): number {
	return moment().diff(dob, 'years')
}

function catalystGetYPData(id: string) {
    const query = gql`
		query ($user: ID!) {
			user(id: $user) {
				user {
					name
					question(name: "birthday") {
						value
					}
				}
			}
			attendee(id: $user) {
				authorizedPickupPersons
				formID
				notes
			}
		}
	`;

	return client.query<GQL.IQuery>({
		query: query,
		variables: {
			user: id
		}
	});
}

function getAgeElement(isOver18: boolean, name: string, age: number): string {
	const over18Icon = '<i class="material-icons catalyst-age-icon" aria-hidden="true">check_circle</i>';
	const under18Icon = '<i class="material-icons catalyst-age-icon" aria-hidden="true">warning</i>';
	return isOver18 ? `<span class="green">${over18Icon} ${name} is 18+ (${age} years old)</span>`
		: `<span class="red">${under18Icon} ${name} is a <strong>minor</strong> (${age} years old)</span>`;
}

function catalystCheckIn(id: string, isCheckIn: boolean = true) {
	return catalystGetYPData(id).then((response:any) => {
		console.log("catalystcheckin", response);
		if (!response || !response.data || !response.data.user || !response.data.user.user
			|| !response.data.user.user.name || !response.data.user.user.question || !response.data.user.user.question.value) {
			return Promise.reject("Data that was expected from the server was not provided");
		}

		const dob = moment(response.data.user.user.question.value, "YYYY-MM-DD");
		const age = catalystCalculateAge(dob);
		const name = response.data.user.user.name;
		if (isNaN(age)) {
			Promise.reject(`${name}'s date of birth was most likely entered into registration incorrectly.  Have them complete
			a walk-up registration application on your laptop to rectify the problem.`);
		}
		const isOver18 = age >= 18;
		const hideAuthorizedAdults = isOver18 || !isCheckIn ? "hidden" : "";
		const hideCheckoutFields = isCheckIn ? "hidden" : "";
		const over18 = getAgeElement(isOver18, name, age);

		let APPsList = "";
		let notes = "";
		let formID = "";
		let checkoutAdultOptions = "";
		if (response.data.attendee) {
			if (response.data.attendee.authorizedPickupPersons && response.data.attendee.authorizedPickupPersons.length > 0) {
				APPsList = response.data.attendee.authorizedPickupPersons.reduce((a: string, b: string) => `${a}\n${b}`);
				if (isOver18) {
					checkoutAdultOptions = `<option value="Self">Self</option>`;
				} else {
					checkoutAdultOptions = response.data.attendee.authorizedPickupPersons
						.map((p: string) => `<option value="${p}">${p}</option>`).join('');
				}
			}

			if (response.data.attendee.formID) {
				formID = response.data.attendee.formID;
			}

			if (response.data.attendee.notes) {
				notes = response.data.attendee.notes;
			}
		}

		const disableAPPSelect = isCheckIn || isOver18 ? "disabled" : "";
		const APPSelectChoice = isOver18 ? "" : `<option style="display: none"">Select authorized pickup person</option>`;
		const APPSelfChoice = isOver18 ? `<option value="Self">Self</option>` : "";
		const APPOtherChoice = isOver18 ? "" : `<option>Not on this list</option>`;
		const hideIfNot16Or17 = age === 16 || age === 17 ? "" : "hidden";

		return swal({
			title: `Enter ${isCheckIn ? "check-in" : "check-out"} data`,
			type: "question",
			showCancelButton: true,
			allowOutsideClick: false,
			html:
				`${over18}
			<select id="authorized-dismissal" class="swal2-input catalyst-data ${hideIfNot16Or17} ${!isCheckIn ? "hidden" : ""}">
				<option value="ad-false">No authorized dismissal</option>
				<option value="ad-true">Authorized dismissal signed by parent/guardian</option>
			</select>
			<select id="checkout-adult-dropdown" class="swal2-input catalyst-data ${hideCheckoutFields}" ${disableAPPSelect}>
				${APPSelectChoice}
				${APPSelfChoice}
			 	${checkoutAdultOptions}
			 	${APPOtherChoice}
			</select>
			<input type="text" id="checkout-adult-other" class="swal2-input catalyst-data ${isOver18 ? "hidden" : ""} ${hideCheckoutFields}" placeholder="Name of other authorized pickup person"/>
            <textarea id="authorized-adults" class="swal2-input catalyst-data ${hideAuthorizedAdults}" placeholder="Authorized pickup persons (one per line)" rows="5">${APPsList}</textarea>
            <input type="text" id="form-id" class="swal2-input catalyst-data" value="${formID}" placeholder="Form ID" ${!isCheckIn ? "readonly": ""}/>
            <textarea placeholder="Notes" id="notes" class="swal2-input catalyst-data" rows="3">${notes}</textarea>`,
			preConfirm: function (value) {
				const authorizedAdults = (<HTMLInputElement>document.getElementById("authorized-adults")!).value;
				const authorizedDismissal = (<HTMLInputElement>document.getElementById("authorized-dismissal")!).value;

				const formID = (<HTMLInputElement>document.getElementById("form-id")!).value;
				const notes = (<HTMLInputElement>document.getElementById("notes")!).value;

				const checkoutPersonDropdown: string = (<HTMLInputElement>document.getElementById("checkout-adult-dropdown")!).value;
				const checkoutPersonOther: string = (<HTMLInputElement>document.getElementById("checkout-adult-other")!).value;

				const authorizedAdultsBlank = "  You must provide at least one authorized adult for pickup because this participant is a minor. ";
				const formIDBlank = " Form ID is required. ";
				//const noCheckoutPerson = "You must indicate a checkout person for this participant.";
				let validationMessage = "";
				let checkoutPerson: string|null = null;
				if (isCheckIn) {
					if (!isOver18 && authorizedAdults.trim().length === 0 && authorizedDismissal === "ad-false") {
						validationMessage += authorizedAdultsBlank;
					}
				}
				const invalidCheckoutPerson = ` To specify an authorized adult for pickup that is not listed, select
				 "Not on this list" in the dropdown and then enter the name of the new authorized pickup person in the text box below. 
				 If you aren't trying to specify a new authorized adult for checkout, then make sure the text box directly underneath
				 the dropdown menu is empty. `;
				const nonSelfOver18Checkout = ` Participant is over 18 and can check themselves out.  Please leave authorized pickup person value
				set to "Self". `;
				const noCheckoutPersonSelected = ` You must specify an authorized pickup person. `;

				if (!isCheckIn) {
					if (!isOver18) {
						if (checkoutPersonDropdown === "Select authorized pickup person") {
							validationMessage += noCheckoutPersonSelected;
						}

						if (checkoutPersonOther.trim().length > 0 && checkoutPersonDropdown !== "Not on this list") {
							validationMessage += invalidCheckoutPerson;
						}
					}
					if (isOver18 && checkoutPersonDropdown !== "Self") {
						validationMessage += nonSelfOver18Checkout;
					}

					if ((checkoutPersonDropdown !== "Select authorized pickup person" && checkoutPersonDropdown !== "Not on this list")
						&& checkoutPersonOther.trim().length === 0) {
						checkoutPerson = checkoutPersonDropdown;
					} else if (checkoutPersonDropdown === "Not on this list" && checkoutPersonOther.trim().length > 0) {
						checkoutPerson = checkoutPersonOther.trim();
					}
				}

				if (formID.trim().length === 0) {
					validationMessage += formIDBlank;
				}

				validationMessage = validationMessage.trim();

				if (validationMessage.length > 0) {
					swal.showValidationMessage(validationMessage);
					return false;
				}

				return new Promise(function (resolve) {
					resolve({
						authorizedAdults,
						authorizedDismissal,
						formID,
						notes,
						checkoutPerson
					});
				})
			},
			onOpen: function () {
				if (isCheckIn) {
					document.getElementById("authorized-adults")!.focus();
				} else {
					document.getElementById("checkout-adult-dropdown")!.focus();
				}
			}
		})
	});
}

function checkIn(e: Event) {
	let button = (<HTMLButtonElement>e.target)!;
	let isCheckedIn: boolean = button.classList.contains("checked-in");
	button.disabled = true;
	let tag: string = tagSelector.value;
	let id: string = button.parentElement!.parentElement!.id.slice(5);
	let checkingIn: boolean = !isCheckedIn;

    const mutation = gql`mutation ($user: ID!, $tag: String!, $checkin: Boolean!, $formID: String, $APPs: [String!], $checkedOutBy: String, $notes: String) {
		check_in(user: $user, tag: $tag, checkin: $checkin, formID: $formID, APPs: $APPs, checkedOutBy: $checkedOutBy, notes: $notes) {
			tags {
				tag {
					name
				}
				checked_in
				checkin_success
			}
		}
	}`;

		catalystCheckIn(id, checkingIn)
		.then((result:any) => {
			if (result.dismiss === swal.DismissReason.cancel) {
				button.disabled = false;
				return Promise.reject("Check in cancelled");
			}

			let authorizedAdults = null;
			if (result.value.authorizedAdults) {
				authorizedAdults = result.value.authorizedAdults.split("\n");
			}
			if (result.value.authorizedDismissal === "ad-true" && authorizedAdults) {
				authorizedAdults.push("Self (authorized dismissal)");
			} else if (result.value.authorizedDismissal === "ad-true" && !result.value.authorizedAdults) {
				authorizedAdults = ["Self (authorized dismissal)"];
			}

			console.log("Authorized adults", authorizedAdults);
			return client.mutate<GQL.IMutation>({
				mutation: mutation,
				variables: {
					user: id,
					tag,
					checkin: checkingIn,
					APPs: authorizedAdults,
					formID: result.value.formID,
					checkedOutBy: checkingIn ? "" : result.value.checkoutPerson,
					notes: result.value.notes
				}
			});
		}).then((response:any) => {
			button.disabled = false;

			if (response && response.data) {
				let checkin_success = null;
				for (let i = 0; i < response.data.check_in.tags.length; i++) {
					let tagData = response.data.check_in.tags[i];

					if (tagData.tag.name === tag) {
						checkin_success = tagData.checkin_success;
						break;
					}
				}
				if (!checkin_success) {
					swal({
						title: "Glitch in the matrix",
						text: "Your local check-in data is out-of-date.  Please refresh the page to continue",
						type: "error",
						confirmButtonText: "Refresh"
					}).then(() => window.location.reload());
				}
			} else {
				swal("Empty server response", "The server didn't respond with the expected data", "error");
			}
		}).catch((error:any) => {
			if (error !== "Check in cancelled") {
				console.error(error);
				swal("Nah fam ✋", "An error is preventing us from checking in this user", "error");
				button.disabled = false;
			} else {
				const checkInPhrase = checkingIn ? "Check-in" : "Check-out";
				swal(`${checkInPhrase} cancelled`, `The ${checkInPhrase.toLowerCase()} operation was cancelled because you clicked the Cancel button.  No data has changed.`, "info");
			}
		});
		//}
		// else if (!checkingIn) {
		//     swal("checking out").then(() => {
		//         button.disabled = false;
		//     })
	// } else {
	// 	client.mutate<GQL.IMutation>({
	// 		mutation: mutation,
	// 		variables: {
	// 			user: id,
	// 			tag,
	// 			checkin: checkingIn
	// 		}
	// 	}).then(response => {
	// 		button.disabled = false;
	//
	// 		if (response && response.data) {
	// 			let checkin_success = null;
	// 			for (let i = 0; i < response.data.check_in.tags.length; i++) {
	// 				let tagData = response.data.check_in.tags[i];
	//
	// 				if (tagData.tag.name === tag) {
	// 					checkin_success = tagData.checkin_success;
	// 					break;
	// 				}
	// 			}
	// 			if (!checkin_success) {
	// 				swal({
	// 					title: "Glitch in the matrix",
	// 					text: "Your local check-in data is out-of-date.  Please refresh the page to continue",
	// 					type: "error",
	// 					confirmButtonText: "Refresh"
	// 				}).then(() => window.location.reload());
	// 			}
	// 		} else {
	// 			swal("Empty server response", "The server didn't respond with the expected data", "error");
	// 		}
	// 	}).catch(error => {
	// 		if (error !== "Check in cancelled") {
	// 			console.error(error);
	// 			swal("Nah fam ✋", `An error is preventing us from checking in this user: ${error}`, "error");
	// 		}
	// 		button.disabled = false;
	// 	});
	// }


}

function attachUserDeleteHandlers() {
	let deleteButtons = document.querySelectorAll("#manage-users .actions > button");
	for (let i = 0; i < deleteButtons.length; i++) {
		deleteButtons[i].addEventListener("click", e => {
			let source = (<HTMLButtonElement>e.target)!;
			let username: string = source.parentElement!.parentElement!.dataset.username!;
			let extraWarn: boolean = !!source.parentElement!.querySelector(".status");
			const extraWarnMessage = `<strong><em>YOU ARE TRYING TO DELETE THE ACCOUNT THAT YOU ARE CURRENTLY LOGGED IN 
                                         WITH. THIS WILL DELETE YOUR USER AND LOG YOU OUT.</em></strong>`;

			swal({
				title: `Delete ${username}?`,
				html: `${extraWarn ? extraWarnMessage + "<br /><br />" : ""}<strong>${username}</strong> will be permanently deleted!`,
				type: "warning",
				showCancelButton: true,
				confirmButtonText: "Delete",
				focusCancel: true,
				confirmButtonColor: "#dc3545"
			}).then(result => {
				if (result.value) {
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
						swal("Couldn't delete user", response.error, "error");
					}).complete(() => {
						source.disabled = false;
					});
				}
			});

		});
	}
}

let queryField = <HTMLInputElement>document.getElementById("query")!;
queryField.addEventListener("keyup", e => {
	loadAttendees();
});
let checkedInFilterField = <HTMLSelectElement>document.getElementById("checked-in-filter")!;
checkedInFilterField.addEventListener("change", e => {
	loadAttendees();
});
let tagSelector = <HTMLSelectElement>document.getElementById("tag-choose")!;
tagSelector.addEventListener("change", e => {
	if (!States["checkin"].isDisplayed) {
		States["checkin"].show();
	}
	drawer.open = false;
	loadAttendees();
});

function loadAttendees(filter: string = queryField.value, checkedIn: string = checkedInFilterField.value) {
	let status = document.getElementById("loading-status")!;
	status.textContent = "Loading...";

	let tag = tagSelector.value;

    // Get checked question options
	let checked: string[] = [];
	let checkedElems = document.querySelectorAll("#question-options input:checked") as NodeListOf<HTMLInputElement>;
	for (let i = 0; i < checkedElems.length; i++) {
		checked.push(checkedElems[i].value);
	}

    // Create filter query based on selected values
	let registrationFilter: GQL.IUserFilter = {};
	let subgroup = document.getElementById("attending-filter") as HTMLInputElement;
	if (subgroup.value) {
		if (subgroup.value === "attending") {
			registrationFilter.confirmed = true;
			registrationFilter.accepted = true;
		} else if (subgroup.value === "accepted") {
			registrationFilter.accepted = true;
		} else if (subgroup.value === "applied") {
			registrationFilter.applied = true;
		}
	}
	let branch = document.getElementById("branches-filter") as HTMLInputElement;
	if (branch.value) {
		registrationFilter.application_branch = branch.value;
	}
	const confirmationBranch = document.getElementById("confirmation-branches-filter") as HTMLInputElement;
	if (confirmationBranch.value) {
		registrationFilter.confirmation_branch = confirmationBranch.value;
	}

    const query = gql`query UserAndTags($search: String!, $questions: [String!]!, $filter: UserFilter) {
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
				last_successful_checkin {
					checked_in
					checked_in_by
					checked_in_date
				}
			}
		}
	}`;

	client.query<GQL.IQuery>({
		query: query,
		variables: {
			search: filter || " ",
			questions: checked,
			filter: registrationFilter
		}
	}).then(response => {
		let attendees = response.data.search_user_simple;

		let attendeeList = document.getElementById("attendees")!;
		let attendeeTemplate = <HTMLTemplateElement>document.getElementById("attendee-item")!;
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
			(<any>window).mdc.autoInit();
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
				let tagInfo = attendee.tags.filter(curr => curr.tag.name === tag);

				if (tagInfo.length > 0 && tagInfo[0].last_successful_checkin && tagInfo[0].last_successful_checkin!.checked_in) {
					button.textContent = "Check out";
					button.classList.add("checked-in");

					let date = tagInfo[0].last_successful_checkin!.checked_in_date;
					if (date && tagInfo[0].last_successful_checkin!.checked_in_by) {
						status.innerHTML = statusFormatter(date, tagInfo[0].last_successful_checkin!.checked_in_by);
					}
				} else {
					button.textContent = "Check in";
					button.classList.remove("checked-in");
					status.textContent = "";
				}
				if (attendee.user.questions) {
					const infoToText = (info: GQL.IFormItem) => {
						if (info.value) {
							return `${info.name}: ${info.value}`;
						} else if (info.values) {
							return `${info.name}: ${info.values.join(",")}`;
						} else if (info.file) {
							const path = encodeURIComponent(info.file.path);
							const url = `${location.protocol}//${location.host}/uploads?file=${path}`;
							return `${info.name}: <a href="${url}">${info.file.original_name}</a>`;
						}
						return `${info.name}: Not given.`;
					};
					let registrationInformation = attendee.user.questions.map(infoToText);
					existingNodes[i].querySelector("#additional-info")!.innerHTML = registrationInformation.join("<br>");
				}
			} else {
				existingNodes[i].style.display = "none";
				existingNodes[i].id = "";
			}
		}
		tag = tag || "no tags found";
		tag = tag.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		status.innerHTML = `Found ${attendees.length} attendee${attendees.length === 1 ? "" : "s"} (<code>${tag}</code>)`;
	}).catch(error => {
		console.error(error);
		swal("Nah fam ✋", "Error fetching participants", "error");
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


document.getElementById("add-update-user")!.addEventListener("click", e => {
	let button = (<HTMLButtonElement>e.target)!;
	button.disabled = true;

	let usernameInput = <HTMLInputElement>document.getElementById("manage-username");
	let passwordInput = <HTMLInputElement>document.getElementById("manage-password");
	let username = usernameInput.value.trim();
	let password = passwordInput.value;
	qwest.put("/api/user/update", {
		username: username,
		password: password
	}).then((xhr, response) => {
		if (response.created) {
			swal("Got it!", `User '${username}' was successfully created`, "success")
				.then(() => window.location.reload());
		} else {
			swal("Got it!", `Password for user '${username}' successfully updated. All active sessions with this account will need to log in again.`, "success")
				.then(() => window.location.reload());
		}


	}).catch((e, xhr, response) => {
		swal("Unable to process request", response.error, "error");
	}).complete(() => {
		button.disabled = false;
	});
});

// Add tags to users
document.getElementById("add-new-tag")!.addEventListener("click", e => {
	let button = e.target as HTMLButtonElement;
	button.disabled = true;

	let tagInput = <HTMLInputElement>document.getElementById("new-tag-name");
	let tagStart = <HTMLInputElement>document.getElementById("new-tag-start-dt");
	let tagEnd = <HTMLInputElement>document.getElementById("new-tag-end-dt");
	let tagWarnDuplicates = <HTMLInputElement>document.getElementById("tag-warn-duplicate");

	let tag = tagInput.value.trim().toLowerCase();
	if (!tag) {
		swal("Enter a tag name", "", "warning");
		button.disabled = false;
		return;
	}

    const mutation = gql`
		mutation Tag($tag: String!, $start: String, $end: String, $warnOnDuplicates: Boolean = false) {
			add_tag(tag: $tag, start: $start, end: $end, warnOnDuplicates: $warnOnDuplicates) {
				name
				start
				end
				warnOnDuplicates
			}
		}`;

	client.mutate({
		mutation: mutation,
		variables: {
			tag: tag,
			start: tagStart.value,
			end: tagEnd.value,
			warnOnDuplicates: tagWarnDuplicates.checked
		}
	}).then(response => {
		// Add to tag selectors
		updateTagSelectors([tag]);

		// if the API returns null, the tag already exists, so show a warning
		if (response && response.hasOwnProperty("data")
			&& response.data && response.data.hasOwnProperty("add_tag")
			&& !response.data.add_tag) {
			swal({
				title: "Tag already exists",
				html: `The tag <strong>${tag}</strong> already exists.  Try again with a different name.`,
				type: "warning"
			});
		} else {
			document.querySelector(`label[for="new-tag-name"]`)!.classList.remove("mdc-textfield__label--float-above");
			swal("Got it!", "Successfully created tag", "success");

			// Clear form
			tagInput.value = "";
			tagStart.value = "";
			tagEnd.value = "";
			tagWarnDuplicates.checked = false;
		}

		button.disabled = false;
	}).catch(error => {
		console.error(error);
		swal("Nah fam 🤚", "Unable to create new tag", "error");
		button.disabled = false;
	});
});

// Populate checkboxes for question names
client.query<GQL.IQuery>({
    query: gql`{ question_names }`
}).then(response => {
	if (!response.data || !response.data.question_names) {
		return;
	}
	let checkboxTemplate = <HTMLTemplateElement>document.getElementById("checkbox-item")!;
	let checkboxContainer = document.getElementById("question-options")!;
	let button = document.getElementById("button-row")!;

	let question_names = response.data.question_names.map(name => name);
	question_names = question_names.sort((a, b) => {
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
}).catch(error => {
	console.error(error);
	swal("Nah fam ✋", "Error fetching registration question names", "error");
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
client.query<GQL.IQuery>({
    query: gql`{ application_branches }`
}).then(response => {
	let select = document.getElementById("branches-filter")!;
	let branches = response.data.application_branches;

	for (let curr of branches) {
		let option = document.createElement("option");
		option.textContent = curr;
		option.value = curr;
		select.appendChild(option);
	}
}).catch(error => {
	console.error(error);
	swal("Nah fam ✋", "Error fetching registration application branches", "error");
});

// Populate confirmation branch options
client.query<GQL.IQuery>({
    query: gql`{ confirmation_branches }`
}).then(response => {
	let select = document.getElementById("confirmation-branches-filter")!;
	let branches = response.data.confirmation_branches;

	for (let curr of branches) {
		let option = document.createElement("option");
		option.textContent = curr;
		option.value = curr;
		select.appendChild(option);
	}
}).catch(error => {
	console.error(error);
	swal("Nah fam ✋", "Error fetching registration confirmation branches", "error");
});

document.getElementById("branches-filter")!.addEventListener("change", e => {
	loadAttendees();
});

document.getElementById("confirmation-branches-filter")!.addEventListener("change", e => {
	loadAttendees();
});

//TODO: this should display last successful checkin info
// Subscriptions for updating checked in/out
const subscriptionQuery = gql`subscription {
	tag_change {
		user {
			id
			name
			email
		}
		tags {
			tag {
				name
			}
			last_successful_checkin {
				checked_in
				checked_in_by
				checked_in_date
			}
		}
	}
}`;

client.subscribe({
	query: subscriptionQuery,
}).subscribe({
	next(response: { data: GQL.ISubscription }) {
		if (!response.data || !response.data.tag_change) {
			return;
		}

		let attendee = response.data.tag_change;

		if (!States["checkin"].isDisplayed)
			return;

		let tag = tagSelector.value;

		// Filter by the currently shown tag
		let attendeeTags = attendee.tags.filter((t) => t.tag.name === tag);
		let button = <HTMLButtonElement>document.querySelector(`#item-${attendee.user.id} > .actions > button`);

		if (!button) {
			// This attendee belongs to a tag that isn't currently being shown
			// This message can safely be ignored; the user list will be updated when switching tags
			return;
		}
		if (attendeeTags.length === 0) {
			// Check if the currently displayed tag is the tag that was just updated
			return;
		}
		let attendeeTag = attendeeTags[0];
		let status = <HTMLSpanElement>document.querySelector(`#${button.parentElement!.parentElement!.id} > .actions > span.status`)!;
		if (attendeeTag.last_successful_checkin) {
			if (attendeeTag.last_successful_checkin.checked_in) {
				button.textContent = "Check out";
				button.classList.add("checked-in");
				if (attendeeTag.last_successful_checkin.checked_in_date && attendeeTag.last_successful_checkin.checked_in_by) {
					status.innerHTML = statusFormatter(attendeeTag.last_successful_checkin.checked_in_date, attendeeTag.last_successful_checkin.checked_in_by);
				}
			} else {
				button.textContent = "Check in";
				button.classList.remove("checked-in");
				status.textContent = "";
			}
		} else {
			swal("Invalid server response", "A new check-in event was received, but the server didn't send back enough data to process it", "error");
		}
	}
});

attachUserDeleteHandlers();
// Update check in relative times every minute the lazy way
setInterval(() => {
	if (States["checkin"].isDisplayed) {
		loadAttendees();
	}
}, 1000 * 60);
loadAttendees();