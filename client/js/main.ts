declare let moment: any;
declare let qwest: any; // Update with actual definitions later

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
	}
}
const States: { [key: string]: State } = {
	"checkin": new State("open-checkin", "checkin"),
	"attendees": new State("open-attendees", "import"),
	"users": new State("open-users", "manage-users")
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

interface IAttendee {
	reverted?: boolean;
	id: string;
	tag: string;
	name: string;
	emails: string[];
	checked_in: boolean;
	checked_in_date?: Date;
	checked_in_by?: string;
}

function delay (milliseconds: number) {
	return new Promise<void>(resolve => {
		setTimeout(resolve, milliseconds);
	});
}

function statusFormatter (time: Date, by: string = "unknown"): string {
	// Escape possible HTML in username
	by = by.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

	return `Checked in <abbr title="${moment(time).format("dddd, MMMM Do YYYY, h:mm:ss A")}">${moment(time).fromNow()}</abbr> by <code>${by}</code>`;
}

function checkIn (e: Event) {
	let button = (<HTMLButtonElement> e.target)!;
	let isCheckedIn: boolean = button.classList.contains("checked-in");
	button.disabled = true;
	
	qwest.post("/api/checkin", {
		id: button.parentElement!.parentElement!.id.slice(5),
		revert: isCheckedIn ? "true" : "false"
	}).catch((e, xhr, response) => {
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
	qwest.get("/api/search", {
		"q": filter,
		"tag": tag,
		"checkedin": checkedIn
	}).then((xhr, response: IAttendee[]) => {
		let attendeeList = document.getElementById("attendees")!;
		let attendeeTemplate = <HTMLTemplateElement> document.getElementById("attendee-item")!;
		let numberOfExistingNodes = document.querySelectorAll("#attendees li").length;
		if (!attendeeList.firstChild || numberOfExistingNodes < response.length) {
			// First load, preallocate children
			status.textContent = "Preallocating nodes...";
			for (let i = numberOfExistingNodes; i < response.length; i++) {
				let node = document.importNode(attendeeTemplate.content, true) as DocumentFragment;
				node.querySelector("li")!.style.display = "none";
				node.querySelector(".actions > button")!.addEventListener("click", checkIn);
				attendeeList.appendChild(node);
			}
			(<any> window).mdc.autoInit();
			console.warn(`Allocated ${response.length - numberOfExistingNodes} nodes due to insufficient number`);
			status.textContent = "Loading...";
		}

		// Reuse nodes already loaded from template
		let existingNodes = document.querySelectorAll("#attendees li") as NodeListOf<HTMLElement>;
		for (let i = 0; i < existingNodes.length; i++) {
			let attendee = response[i];
			if (!!attendee) {
				existingNodes[i].style.display = "";
				
				existingNodes[i].id = "item-" + attendee.id;
				existingNodes[i].querySelector("#name")!.textContent = attendee.name;
				
				let emails = attendee.emails.reduce((prev, current) => {
					if (prev.indexOf(current) === -1) {
						prev.push(current);
					}
					return prev;
				}, <string[]> []);
				existingNodes[i].querySelector("#emails")!.textContent = emails.join(", ");
				
				let button = existingNodes[i].querySelector(".actions > button")!;
				let status = existingNodes[i].querySelector(".actions > span.status")!;
				if (attendee.checked_in_date) {
					button.textContent = "Uncheck in";
					button.classList.add("checked-in");
					status.innerHTML = statusFormatter(attendee.checked_in_date, attendee.checked_in_by);
				}
				else {
					button.textContent = "Check in";
					button.classList.remove("checked-in");
					status.textContent = "";
				}
			}
			else {
				existingNodes[i].style.display = "none";
				existingNodes[i].id = "";
			}
		}
		tag = tag || "no tags found";
		tag = tag.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		status.innerHTML = `Found ${response.length} attendee${response.length === 1 ? "" : "s"} (<code>${tag}</code>)`;
	}).catch((e, xhr, response) => {
		status.textContent = "An error occurred";
		alert(response.error);
	});
}

mdc.ripple.MDCRipple.attachTo(document.querySelector(".mdc-ripple-surface"));
let drawer = new mdc.drawer.MDCTemporaryDrawer(document.querySelector(".mdc-temporary-drawer"));
document.querySelector("nav.toolbar > i:first-of-type")!.addEventListener("click", () => {
	drawer.open = !drawer.open;
});

document.querySelector("#import button")!.addEventListener("click", (e) => {
	let button = (<HTMLButtonElement> e.target)!;
	button.disabled = true;

	let form = new FormData();
	let fileInput = <HTMLInputElement> document.querySelector(`#import input[type="file"]`)!;
	let tagInput = <HTMLInputElement> document.getElementById("add-tag");
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
		// Get current list of tags
		let tags: string[] = Array.prototype.slice.call(document.querySelectorAll("#tag-choose > option")).map((el: HTMLOptionElement) => {
			return el.textContent;
		});
		// Add new tags to the options list
		if (tags.indexOf(tag) === -1) {
			let tagsList = <NodeListOf<HTMLSelectElement>> document.querySelectorAll("select.tags");
			Array.prototype.slice.call(document.querySelectorAll("select.tags")).forEach((el: HTMLSelectElement) => {
				let tagOption = document.createElement("option");
				tagOption.textContent = tag;
				el.appendChild(tagOption);
			});
		}
		alert("Successfully imported attendees");
	}).catch((e, xhr, response) => {
		alert(response.error);
	}).complete(() => {
		button.disabled = false;
	});
});

document.getElementById("add-update-user")!.addEventListener("click", (e) => {
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

// Listen for updates
const wsProtocol = location.protocol === "http:" ? "ws" : "wss";
function startWebSocketListener() {
	const socket = new WebSocket(`${wsProtocol}://${window.location.host}`);
	socket.addEventListener("message", (event) => {
		if (!States["checkin"].isDisplayed)
			return;
		
		let attendee: IAttendee = JSON.parse(event.data);
		let button = <HTMLButtonElement> document.querySelector(`#item-${attendee.id} > .actions > button`);
		if (!button) {
			// This attendee belongs to a tag that isn't currently being shown
			// This message can safely be ignored; the user list will be updated when switching tags
			return;
		}
		let status = <HTMLSpanElement> document.querySelector(`#${button.parentElement!.parentElement!.id} > .actions > span.status`)!;

		if (!attendee.reverted && attendee.checked_in_date) {
			button.textContent = "Uncheck in";
			button.classList.add("checked-in");
			status.innerHTML = statusFormatter(attendee.checked_in_date, attendee.checked_in_by);
		}
		else {
			button.textContent = "Check in";
			button.classList.remove("checked-in");
			status.textContent = "";
		}
	});
	socket.addEventListener("error", (event) => {
		console.warn("Socket encountered an error, restarting...:", event);
		startWebSocketListener();
	});
	socket.addEventListener("close", (event) => {
		console.warn("Socket closed unexpectedly");
		startWebSocketListener();
	});
}
startWebSocketListener();

attachUserDeleteHandlers();
// Update check in relative times every minute the lazy way
setInterval(() => {
	if (States["checkin"].isDisplayed) {
		loadAttendees();
	}
}, 1000 * 60);
loadAttendees();
