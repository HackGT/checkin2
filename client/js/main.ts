declare let moment: any;

interface IAttendee {
	id: string;
	tag: string;
	name: string;
	communication_email: string;
	gatech_email: string;
	checked_in: boolean;
	checked_in_date?: Date;
	checked_in_by?: string;
}
enum CheckInStatus {
	Any, CheckedIn, NotCheckedIn
}

function checkIn (e: Event) {
	let button = (<HTMLButtonElement> e.srcElement)!;
	let isCheckedIn: boolean = button.classList.contains("checked-in");
	button.disabled = true;
	
	qwest.post("/api/checkin", {
		id: button.parentElement!.id.slice(5),
		revert: isCheckedIn ? "true" : "false"
	}).then((xhr, response: IAttendee) => {
		if (!isCheckedIn) {
			button.textContent = "Uncheck in";
			button.classList.add("checked-in");
			document.querySelector(`#${button.parentElement!.id} > span.status`)!.textContent = `Checked in ${moment(response.checked_in_date).fromNow()} by ${response.checked_in_by || "unknown"}`;
		}
		else {
			button.textContent = "Check in";
			button.classList.remove("checked-in");
			document.querySelector(`#${button.parentElement!.id} > span.status`)!.textContent = "";
		}
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
			
			let button = attendeeTemplate.content.querySelector("button")!;
			let status = attendeeTemplate.content.querySelector("span.status")!;
			if (attendee.checked_in_date) {
				button.textContent = "Uncheck in";
				button.classList.add("checked-in");
				status.textContent = `Checked in ${moment(attendee.checked_in_date).fromNow()} by ${attendee.checked_in_by || "unknown"}`;
			}
			else {
				button.textContent = "Check in";
				button.classList.remove("checked-in");
				status.textContent = "";
			}

			let attendeeItem = document.importNode(attendeeTemplate.content, true);
			attendeeList.appendChild(attendeeItem);
			attendeeList.querySelector(`#item-${attendee.id} > button`)!.addEventListener("click", checkIn);
		}
		document.getElementById("count")!.textContent = response.length.toString();
		(<any> window).mdc.autoInit();
	}).catch((e, xhr, response) => {
		alert(response.error);
	});
}

loadAttendees();
let queryField = <HTMLInputElement> document.getElementById("query")!;
queryField.addEventListener("keyup", e => {
	loadAttendees(queryField.value);
});
let checkedInFilterField = <HTMLSelectElement> document.getElementById("checked-in-filter")!;
checkedInFilterField.addEventListener("change", e => {
	loadAttendees(queryField.value, undefined, checkedInFilterField.value);
});