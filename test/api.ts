import * as assert from "assert";
import * as crypto from "crypto";

import * as mocha from "mocha";
import {expect} from "chai";
import * as request from "supertest";
import * as cheerio from "cheerio";

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
			.expect(response => {
				let $ = cheerio.load(response.text);
				expect($("#username").text()).to.equal(testUser.username);
				expect($("#version").text()).to.match(/^v[0-9-.a-z]+ @ [a-f0-9]{7}$/);
				expect($(".tags").length).to.be.greaterThan(0);
				expect($("#users").children().length).to.be.greaterThan(0);
			})
			.end(done);
	});
	it("Unauthenticated GET /login", done => {
		request(app)
			.get("/login")
			.redirects(0)
			.expect(200)
			.expect("Content-Type", /html/)
			.end(done);
	});
	it("Authenticated GET /login", done => {
		request(app)
			.get("/login")
			.set("Cookie", testUser.cookie)
			.redirects(0)
			.expect(200)
			.expect("set-cookie", /^auth=;/)
			.expect("Content-Type", /html/)
			.end(done);
	});

	describe("Static content", () => {
		it("/default.css", done => {
			request(app)
				.get("/default.css")
				.expect(200)
				.expect("Content-Type", /css/)
				.end(done);
		});
		it("/node_modules/material-components-web/dist/material-components-web.css", done => {
			request(app)
				.get("/node_modules/material-components-web/dist/material-components-web.css")
				.expect(200)
				.expect("Content-Type", /css/)
				.end(done);
		});
	});
});

describe("User endpoints", () => {
	before(function() {
		this.timeout(1000 * 30);
		return insertTestUser();
	});
	after(function() {
		this.timeout(1000 * 30);
		return removeTestUser();
	});

	it("Unauthenticated PUT /api/user/update", done => {
		request(app)
			.put("/api/user/update")
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("Authenticated PUT /api/user/update");
	it("Unauthenticated DELETE /api/user/update", done => {
		request(app)
			.delete("/api/user/update")
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("Authenticated DELETE /api/user/update");
	it("POST /api/user/login");
});

describe("Data endpoints", () => {
	before(function() {
		this.timeout(1000 * 30);
		return insertTestUser();
	});
	after(function() {
		this.timeout(1000 * 30);
		return removeTestUser();
	});

	it("Unauthenticated POST /api/data/import", done => {
		request(app)
			.post("/api/data/import")
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("Authenticated POST /api/data/import");
	it("Unauthenticated GET /api/data/export", done => {
		request(app)
			.get("/api/data/export")
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("Authenticated GET /api/data/export");
	it("Unauthenticated DELETE /api/data/tag/:tag", done => {
		request(app)
			.delete("/api/data/tag/test")
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("Authenticated DELETE /api/data/tag/:tag");
});

describe("Miscellaneous endpoints", () => {
	before(function() {
		this.timeout(1000 * 30);
		return insertTestUser();
	});
	after(function() {
		this.timeout(1000 * 30);
		return removeTestUser();
	});

	it("Unauthenticated GET /api/search", done => {
		request(app)
			.get("/api/search")
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("Authenticated GET /api/search");
	it("Unauthenticated POST /api/checkin", done => {
		request(app)
			.post("/api/checkin")
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("Authenticated POST /api/checkin");
});