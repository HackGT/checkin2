declare let moment: any;

interface IAttendee {
	reverted?: boolean;
	id: string;
	tag: string;
	name: string;
	communication_email: string;
	gatech_email: string;
	checked_in: boolean;
	checked_in_date?: Date;
	checked_in_by?: string;
}
enum State {
	CheckIn, Import
}
let currentState: State;

function statusFormatter (time: Date, by: string = "unknown"): string {
	// Escape possible HTML in username
	by = by.replace("&", "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

function loadAttendees (filter: string = "", tag: string = "", checkedIn: string = "") {
	qwest.get("/api/search", {
		"q": filter,
		"tag": tag,
		"checkedin": checkedIn
	}).then((xhr, response: IAttendee[]) => {
		let attendeeList = document.getElementById("attendees")!;
		// Remove current contents
		while (attendeeList.firstChild) {
			attendeeList.removeChild(attendeeList.firstChild);
		}
		// Load from template
		let attendeeTemplate = <HTMLTemplateElement> document.getElementById("attendee-item")!;
		for (let attendee of response) {
			attendeeTemplate.content.querySelector("li")!.id = "item-" + attendee.id;
			attendeeTemplate.content.querySelector("#name")!.textContent = attendee.name;
			
			let emailContent: string = attendee.gatech_email;
			if (attendee.communication_email !== attendee.gatech_email)
				emailContent = `${attendee.communication_email}, ${attendee.gatech_email}`;
			attendeeTemplate.content.querySelector("#emails")!.textContent = emailContent;
			
			let button = attendeeTemplate.content.querySelector(".actions > button")!;
			let status = attendeeTemplate.content.querySelector(".actions > span.status")!;
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

			let attendeeItem = document.importNode(attendeeTemplate.content, true);
			attendeeList.appendChild(attendeeItem);
			attendeeList.querySelector(`#item-${attendee.id} > .actions > button`)!.addEventListener("click", checkIn);
		}
		document.getElementById("count")!.textContent = response.length.toString();
		(<any> window).mdc.autoInit();
	}).catch((e, xhr, response) => {
		alert(response.error);
	});
}
function enterState(state: State) {
	currentState = state;
	if (state === State.CheckIn) {
		document.getElementById("checkin")!.style.display = "block";
		document.getElementById("import")!.style.display = "none";
		loadAttendees();
	}
	if (state === State.Import) {
		document.getElementById("checkin")!.style.display = "none";
		document.getElementById("import")!.style.display = "block";
	}
}

let queryField = <HTMLInputElement> document.getElementById("query")!;
queryField.addEventListener("keyup", e => {
	loadAttendees(queryField.value);
});
let checkedInFilterField = <HTMLSelectElement> document.getElementById("checked-in-filter")!;
checkedInFilterField.addEventListener("change", e => {
	loadAttendees(queryField.value, undefined, checkedInFilterField.value);
});

mdc.ripple.MDCRipple.attachTo(document.querySelector(".mdc-ripple-surface"));
let drawer = new mdc.drawer.MDCTemporaryDrawer(document.querySelector(".mdc-temporary-drawer"));
document.querySelector("nav.toolbar > i:first-of-type")!.addEventListener("click", () => {
	drawer.open = !drawer.open;
});

// Listen for updates
const socket = new WebSocket(`ws://${window.location.host}`);
socket.addEventListener("message", (event) => {
	if (currentState !== State.CheckIn)
		return;
	
	let attendee: IAttendee = JSON.parse(event.data);
	let button = <HTMLButtonElement> document.querySelector(`#item-${attendee.id} > .actions > button`)!;
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

enterState(State.CheckIn);
// ES6 is pretty cool
let [enterCheckIn, enterImport] = ["enter-checkin", "enter-import"].map((id) => document.getElementById(id)!);
const drawerSelectedClass = "mdc-temporary-drawer--selected";
// setTimeout is necessary probably because the drawer is reshown upon any click event
enterCheckIn.addEventListener("click", (e) => {
	enterCheckIn.classList.add(drawerSelectedClass);
	enterImport.classList.remove(drawerSelectedClass);
	enterState(State.CheckIn);
	setTimeout(() => {
		drawer.open = false;
	}, 10);
});
enterImport.addEventListener("click", (e) => {
	enterCheckIn.classList.remove(drawerSelectedClass);
	enterImport.classList.add(drawerSelectedClass);
	enterState(State.Import);
	setTimeout(() => {
		drawer.open = false;
	}, 10);
});
// Update check in relative times every minute the lazy way
setInterval(() => {
	if (currentState === State.CheckIn) {
		loadAttendees();
	}
}, 1000 * 60);