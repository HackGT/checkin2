import * as assert from "assert";
import * as crypto from "crypto";

import * as mocha from "mocha";
import {expect} from "chai";
import * as request from "supertest";

import {app, pbkdf2Async, mongoose} from "../server/app";
import {IUser, IUserMongoose, User, IAttendee, IAttendeeMongoose, Attendee} from "../server/schema";

let testUser = {
	"username": "testuser",
	"password": crypto.randomBytes(16).toString("hex"),
	"key": crypto.randomBytes(32).toString("hex"),
	"cookie": ""
}
testUser.cookie = `auth=${testUser.key}`;

async function insertTestUser() {
	// Create a new user with username and password "test"
	let salt = crypto.randomBytes(32);
	let passwordHashed = await pbkdf2Async(testUser.password, salt, 500000, 128, "sha256");
	let user = new User({
		username: testUser.username,
		login: {
			hash: passwordHashed.toString("hex"),
			salt: salt.toString("hex")
		},
		auth_keys: [testUser.key]
	});
	return user.save();
}
function removeTestUser() {
	return User.remove({ "username": testUser.username });
}

describe("Content endpoints", () => {
	before(function() {
		this.timeout(1000 * 30);
		return insertTestUser();
	});
	after(function() {
		this.timeout(1000 * 30);
		return removeTestUser();
	});

	it("Unauthenticated GET /", done => {
		request(app)
			.get("/")
			.expect("location", "/login")
			.end(done);
	});
	it("Authenticated GET /", done => {
		request(app)
			.get("/")
			.set("Cookie", testUser.cookie)
			.redirects(0)
			.expect(200)
			.expect("Content-Type", /html/)
			.end(done)
	});
	it("Unauthenticated GET /login", done => {
		request(app)
			.get("/login")
			.redirects(0)
			.expect(200)
			.expect("Content-Type", /html/)
			.end(done)
	});
	it("Authenticated GET /login", done => {
		request(app)
			.get("/login")
			.set("Cookie", testUser.cookie)
			.redirects(0)
			.expect(200)
			.expect("set-cookie", /^auth=;/)
			.expect("Content-Type", /html/)
			.end(done)
	});

	describe("Static content", () => {
		it("/default.css", done => {
			request(app)
				.get("/default.css")
				.expect(200)
				.expect("Content-Type", /css/)
				.end(done)
		});
		it("/node_modules/material-components-web/dist/material-components-web.css", done => {
			request(app)
				.get("/node_modules/material-components-web/dist/material-components-web.css")
				.expect(200)
				.expect("Content-Type", /css/)
				.end(done)
		});
	});
});