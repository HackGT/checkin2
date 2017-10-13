/// <reference types="qwest" />
declare const mdc: any;

mdc.autoInit();

document.addEventListener("keydown", e => {
	// Enter key
	if (e.keyCode === 13) {
		submit();
	}
});
let submitButton = <HTMLButtonElement> document.getElementById("submit");
if (submitButton) {
	submitButton.addEventListener("click", e => {
		submit();
	});
}
let usernameField = <HTMLInputElement> document.getElementById("username");
let passwordField = <HTMLInputElement> document.getElementById("password");

function submit(): void {
	submitButton.disabled = true;
	qwest.post("/api/user/login", {
		"username": usernameField.value,
		"password": passwordField.value
	}).then((xhr, response) => {
		window.location.assign("/");
	}).catch((e, xhr, response) => {
		alert(response.error);
	}).complete(() => {
		submitButton.disabled = false;
	});
}
