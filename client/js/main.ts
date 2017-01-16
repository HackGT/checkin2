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

function loadAttendees(filter: string = "", tag: string = "", checkedIn: CheckInStatus = CheckInStatus.Any) {
	let checkedInValue: string = "";
	if (checkedIn === CheckInStatus.CheckedIn) {
		checkedInValue = "true";
	}
	if (checkedIn === CheckInStatus.NotCheckedIn) {
		checkedInValue = "false";
	}
	qwest.get("/api/search", {
		"q": filter,
		"tag": tag,
		"checkedin": checkedInValue
	}).then((xhr, response: IAttendee[]) => {
		let attendeeList = document.getElementById("attendees")!;
		// Remove current contents
		while (attendeeList.firstChild) {
			attendeeList.removeChild(attendeeList.firstChild);
		}
		// Load from template
		let attendeeTemplate = <HTMLTemplateElement> document.getElementById("attendee-item")!;
		for (let attendee of response) {
			attendeeTemplate.content.querySelector("li")!.id = attendee.id;
			attendeeTemplate.content.querySelector("#name")!.textContent = attendee.name;
			let emailContent: string = attendee.gatech_email;
			if (attendee.communication_email !== attendee.gatech_email)
				emailContent = `${attendee.communication_email}, ${attendee.gatech_email}`;
			attendeeTemplate.content.querySelector("#emails")!.textContent = emailContent;
			let attendeeItem = document.importNode(attendeeTemplate.content, true);
			attendeeList.appendChild(attendeeItem);
		}
		(<any> window).mdc.autoInit();
	}).catch((e, xhr, response) => {
		alert(response.error);
	});
}

loadAttendees();