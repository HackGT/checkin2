import * as assert from "assert";
import * as crypto from "crypto";
import * as path from "path";

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

let cachedPassword: { "raw": string | null, "salt": string | null, "hashed": string | null} = {
	"raw": null,
	"salt": null,
	"hashed": null
};

async function insertTestUser() {
	// Create a new user with username and password "test"
	// Only run PBKDF2 if the raw password changed to speed things up
	if (!cachedPassword.hashed || cachedPassword.raw !== testUser.password) {
		cachedPassword.raw = testUser.password;
		cachedPassword.salt = crypto.randomBytes(32).toString("hex");
		cachedPassword.hashed = (await pbkdf2Async(testUser.password, Buffer.from(cachedPassword.salt, "hex"), 500000, 128, "sha256")).toString("hex");
	}
	let user = new User({
		username: testUser.username,
		login: {
			hash: cachedPassword.hashed,
			salt: cachedPassword.salt
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

	it("GET / (unauthenticated)", done => {
		request(app)
			.get("/")
			.expect("location", "/login")
			.end(done);
	});
	it("GET / (authenticated)", done => {
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
	it("GET /login (unauthenticated)", done => {
		request(app)
			.get("/login")
			.redirects(0)
			.expect(200)
			.expect("Content-Type", /html/)
			.end(done);
	});
	it("GET /login (authenticated)", done => {
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
		it("GET /default.css", done => {
			request(app)
				.get("/default.css")
				.expect(200)
				.expect("Content-Type", /css/)
				.end(done);
		});
		it("GET /node_modules/material-components-web/dist/material-components-web.css", done => {
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

	it("POST /api/user/login (no data)", function (done) {
		this.timeout(100);
		request(app)
			.post("/api/user/login")
			.expect(400)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("POST /api/user/login (invalid username and password)", function (done) {
		this.timeout(1000 * 5);
		request(app)
			.post("/api/user/login")
			.type("form")
			.send({
				"username": crypto.randomBytes(16).toString("hex"),
				"password": crypto.randomBytes(16).toString("hex")
			})
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("POST /api/user/login (invalid password)", function (done) {
		this.timeout(1000 * 5);
		request(app)
			.post("/api/user/login")
			.type("form")
			.send({
				"username": testUser.username,
				"password": crypto.randomBytes(16).toString("hex")
			})
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("POST /api/user/login (valid username and password)", function (done) {
		this.timeout(1000 * 5);
		request(app)
			.post("/api/user/login")
			.type("form")
			.send({
				"username": testUser.username,
				"password": testUser.password
			})
			.expect(200)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("success");
				expect(request.body).property("success", true);
				expect(request.header["set-cookie"][0]).to.match(/^auth=;/);
				expect(request.header["set-cookie"][1]).to.match(/^auth=[0-9a-f]{64}/);
			})
			.end(done);
	});
	it("PUT /api/user/update (unauthenticated)", done => {
		request(app)
			.put("/api/user/update")
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("PUT /api/user/update (no data)", done => {
		request(app)
			.put("/api/user/update")
			.set("Cookie", testUser.cookie)
			.expect(400)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("PUT /api/user/update (update current user)", async function () {
		this.timeout(1000 * 5);

		let user = await User.findOne({"username": testUser.username});
		expect(user.login.hash).to.equal(cachedPassword.hashed);
		expect(user.login.salt).to.equal(cachedPassword.salt);
		expect(user.auth_keys).to.not.be.empty;

		return request(app)
			.put("/api/user/update")
			.set("Cookie", testUser.cookie)
			.type("form")
			.send({
				"username": testUser.username,
				"password": crypto.randomBytes(16).toString("hex")
			})
			.expect(201)
			.expect("Content-Type", /json/)
			.then(async request => {
				expect(request.body).to.have.all.keys("success", "reauth", "created", "userlist");
				expect(request.body.success).to.be.true;
				expect(request.body.reauth).to.be.true;
				expect(request.body.created).to.be.false;
				expect(request.body.userlist).to.be.a("string");

				let updatedUser = await User.findOne({"username": testUser.username});
				let {hash: newHash, salt: newSalt} = updatedUser.login;
				expect(newHash).to.not.equal(user.login.hash);
				expect(newSalt).to.not.equal(user.login.salt);
				expect(updatedUser.auth_keys).to.be.empty;

				// Return to original state
				await removeTestUser();
				await insertTestUser();
			});
	});
	it("PUT /api/user/update (update different user)", async function () {
		this.timeout(1000 * 5);

		let newUsername = crypto.randomBytes(16).toString("hex");
		// Set up another dummy user with the same password as the test user for better performance when testing
		await new User({
			username: newUsername,
			login: {
				hash: cachedPassword.hashed,
				salt: cachedPassword.salt
			},
			auth_keys: []
		}).save();

		return request(app)
			.put("/api/user/update")
			.set("Cookie", testUser.cookie)
			.type("form")
			.send({
				"username": newUsername,
				"password": crypto.randomBytes(16).toString("hex")
			})
			.expect(201)
			.expect("Content-Type", /json/)
			.then(async request => {
				expect(request.body).to.have.all.keys("success", "reauth", "created", "userlist");
				expect(request.body.success).to.be.true;
				expect(request.body.reauth).to.be.false;
				expect(request.body.created).to.be.false;
				expect(request.body.userlist).to.be.a("string");

				let updatedUser = await User.findOne({"username": newUsername});
				let {hash: newHash, salt: newSalt} = updatedUser.login;
				expect(newHash).to.not.equal(cachedPassword.hashed);
				expect(newSalt).to.not.equal(cachedPassword.salt);
				expect(updatedUser.auth_keys).to.be.empty;

				// Return to original state
				await User.remove({"username": newUsername});
			});
	});
	it("PUT /api/user/update (add new user)", async function () {
		this.timeout(1000 * 5);

		let newUsername = crypto.randomBytes(16).toString("hex");
		expect(await User.findOne({"username": newUsername})).to.not.exist;

		return request(app)
			.put("/api/user/update")
			.set("Cookie", testUser.cookie)
			.type("form")
			.send({
				"username": newUsername,
				"password": crypto.randomBytes(16).toString("hex")
			})
			.expect(201)
			.expect("Content-Type", /json/)
			.then(async request => {
				expect(request.body).to.have.all.keys("success", "reauth", "created", "userlist");
				expect(request.body.success).to.be.true;
				expect(request.body.reauth).to.be.false;
				expect(request.body.created).to.be.true;
				expect(request.body.userlist).to.be.a("string");

				let user = await User.findOne({"username": newUsername});
				expect(user).to.exist;
				expect(user.auth_keys).to.be.empty;

				// Return to original state
				await User.remove({"username": newUsername});
			});
	});
	it("DELETE /api/user/update (unauthenticated)", done => {
		request(app)
			.delete("/api/user/update")
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("DELETE /api/user/update (current user)", async () => {
		expect(await User.findOne({"username": testUser.username})).to.exist;
		return request(app)
			.delete("/api/user/update")
			.set("Cookie", testUser.cookie)
			.type("form")
			.send({
				"username": testUser.username
			})
			.expect(201)
			.expect("Content-Type", /json/)
			.then(async request => {
				expect(request.body).to.have.all.keys("success", "reauth", "userlist");
				expect(request.body.success).to.be.true;
				expect(request.body.reauth).to.be.true;
				expect(request.body.userlist).to.be.a("string");
				expect(await User.findOne({"username": testUser.username})).to.not.exist;

				// Return to original state
				await insertTestUser();
			});
	});
	it("DELETE /api/user/update (different user)", async () => {
		let newUsername = crypto.randomBytes(16).toString("hex");
		// Set up another dummy user with the same password as the test user for better performance when testing
		await new User({
			username: newUsername,
			login: {
				hash: cachedPassword.hashed,
				salt: cachedPassword.salt
			},
			auth_keys: []
		}).save();

		return request(app)
			.delete("/api/user/update")
			.set("Cookie", testUser.cookie)
			.type("form")
			.send({
				"username": newUsername
			})
			.expect(201)
			.expect("Content-Type", /json/)
			.then(async request => {
				expect(request.body).to.have.all.keys("success", "reauth", "userlist");
				expect(request.body.success).to.be.true;
				expect(request.body.reauth).to.be.false;
				expect(request.body.userlist).to.be.a("string");
				expect(await User.findOne({"username": newUsername})).to.not.exist;
			});
	});
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

	it("POST /api/data/import (unauthenticated)", done => {
		request(app)
			.post("/api/data/import")
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("POST /api/data/import (missing tag)", done => {
		request(app)
			.post("/api/data/import")
			.set("Cookie", testUser.cookie)
			.field("tag", "")
			.field("name", crypto.randomBytes(16).toString("hex"))
			.field("email", crypto.randomBytes(16).toString("hex"))
			.expect(400)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("POST /api/data/import (missing CSV header names)", done => {
		request(app)
			.post("/api/data/import")
			.set("Cookie", testUser.cookie)
			.field("tag", crypto.randomBytes(16).toString("hex"))
			.field("name", "")
			.field("email", "")
			.expect(400)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("POST /api/data/import (missing CSV upload)", done => {
		request(app)
			.post("/api/data/import")
			.set("Cookie", testUser.cookie)
			.field("tag", crypto.randomBytes(16).toString("hex"))
			.field("name", crypto.randomBytes(16).toString("hex"))
			.field("email", crypto.randomBytes(16).toString("hex"))
			.expect(400)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("POST /api/data/import (invalid CSV header names)", done => {
		request(app)
			.post("/api/data/import")
			.set("Cookie", testUser.cookie)
			.field("tag", crypto.randomBytes(16).toString("hex"))
			.field("name", crypto.randomBytes(16).toString("hex"))
			.field("email", crypto.randomBytes(16).toString("hex"))
			.attach("import", path.resolve(__dirname, "data/valid.csv"), "test.csv")
			.expect(415)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("POST /api/data/import (no entries to import)", done => {
		request(app)
			.post("/api/data/import")
			.set("Cookie", testUser.cookie)
			.field("tag", crypto.randomBytes(16).toString("hex"))
			.field("name", "name")
			.field("email", "email")
			.attach("import", path.resolve(__dirname, "data/headers-only.csv"), "test.csv")
			.expect(415)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("POST /api/data/import (valid)", async () => {
		let tag = crypto.randomBytes(16).toString("hex");
		expect(await Attendee.find({"tag": tag})).to.have.length(0);

		return request(app)
			.post("/api/data/import")
			.set("Cookie", testUser.cookie)
			.field("tag", tag)
			.field("name", "name")
			.field("email", "email")
			.attach("import", path.resolve(__dirname, "data/valid.csv"), "test.csv")
			.expect(200)
			.expect("Content-Type", /json/)
			.then(async request => {
				expect(request.body).to.have.property("success");
				expect(request.body.success).to.be.true;

				let importedAttendees = await Attendee.find({"tag": tag});
				expect(importedAttendees).to.have.length(5);
				for (let attendee of importedAttendees) {
					expect(attendee.name).to.match(/^Test \d$/);
					expect(attendee.emails).to.have.length(1);
					expect(attendee.emails[0]).to.match(/^test\d@example\.com$/);
				}
				await Attendee.find({"tag": tag}).remove();
			});
	});
	it("GET /api/data/export (unauthenticated)", done => {
		request(app)
			.get("/api/data/export")
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("GET /api/data/export (authenticated)", done => {
		request(app)
			.get("/api/data/export")
			.set("Cookie", testUser.cookie)
			.expect(200)
			.expect("Content-Type", /text\/csv/)
			.expect("Content-Disposition", "attachment; filename=\"export.csv\"")
			.expect(request => {
				expect(request.text.replace(/\n/g, ",").replace(/"/g, "").split(",")).to.include.members(["tag","name","emails","checked_in","checked_in_date","checked_in_by","id"]);
			})
			.end(done);
	});
	it("DELETE /api/data/tag/:tag (unauthenticated)", done => {
		request(app)
			.delete("/api/data/tag/test")
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("DELETE /api/data/tag/:tag (authenticated)", async () => {
		let tag = crypto.randomBytes(16).toString("hex");
		let tag2 = crypto.randomBytes(16).toString("hex");
		const testAttendeeNumber = 25;
		let testAttendees: IAttendeeMongoose[] = [];
		for (let i = 0; i < testAttendeeNumber * 2; i++) {
			testAttendees.push(new Attendee({
				tag: i < testAttendeeNumber ? tag : tag2,
				name: crypto.randomBytes(16).toString("hex"),
				emails: crypto.randomBytes(16).toString("hex"),
				checked_in: false,
				id: crypto.randomBytes(16).toString("hex")
			}));
		}
		await Attendee.insertMany(testAttendees);
		expect(await Attendee.find({"tag": tag})).to.have.length(testAttendeeNumber);
		expect(await Attendee.find({"tag": tag2})).to.have.length(testAttendeeNumber);

		return request(app)
			.delete(`/api/data/tag/${tag}`)
			.set("Cookie", testUser.cookie)
			.expect(200)
			.expect("Content-Type", /json/)
			.then(async request => {
				expect(request.body).to.have.property("success");
				expect(request.body.success).to.be.true;

				expect(await Attendee.find({"tag": tag})).to.have.length(0);
				expect(await Attendee.find({"tag": tag2})).to.have.length(testAttendeeNumber);

				await Attendee.remove({"tag": tag2});
			});
	});
});

describe("Miscellaneous endpoints", () => {
	let testTags: string[];
	const attendeeCount = 10;
	let attendees: IAttendeeMongoose[] = [];
	before(async function() {
		this.timeout(1000 * 30);

		await insertTestUser();
		testTags = [
			crypto.randomBytes(16).toString("hex"),
			crypto.randomBytes(16).toString("hex"),
			crypto.randomBytes(16).toString("hex")
		];
		for (let tagIndex = 0; tagIndex < testTags.length; tagIndex++) {
			for (let i = 0; i < attendeeCount; i++) {
				attendees.push(new Attendee({
					tag: testTags[tagIndex],
					name: crypto.randomBytes(16).toString("hex"),
					emails: crypto.randomBytes(16).toString("hex"),
					checked_in: false,
					id: crypto.randomBytes(16).toString("hex")
				}));
			}
		}
		await Attendee.insertMany(attendees);
		expect(await Attendee.find({"tag": testTags})).to.have.length(testTags.length * attendeeCount);
	});
	after(async function() {
		this.timeout(1000 * 30);

		await removeTestUser();
		let ids = attendees.map(attendee => {
			return attendee.id;
		});
		await Attendee.remove({"id": ids});
		expect(await Attendee.find({"tag": testTags})).to.have.length(0);
	});

	it("GET /api/search (unauthenticated)", done => {
		request(app)
			.get("/api/search")
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("GET /api/search (no filters)", done => {
		request(app)
			.get("/api/search")
			.set("Cookie", testUser.cookie)
			.expect(200)
			.expect("Content-Type", /json/)
			.expect(request => {
				// Assertions here are more general because the returned attendees might include non-testing users
				expect(request.body).to.be.an("array");
				expect(request.body).to.have.length.of.at.least(testTags.length * attendeeCount);
				for (let result of request.body) {
					expect(result).to.contain.all.keys(["tag", "name", "emails", "checked_in", "id"]);
					expect(result.tag).to.be.a("string");
					expect(result.name).to.be.a("string");
					expect(result.emails).to.be.an("array");
					expect(result.checked_in).to.be.a("boolean");
					if (result.checked_in) {
						expect(result).to.have.contain.keys(["checked_in_date", "checked_in_by"]);
						expect(result.checked_in_date).to.be.a("string");
						expect(result.checked_in_by).to.be.a("string");
					}
					expect(result.id).to.be.a("string");
				}
			})
			.end(done);
	});
	it("GET /api/search (name)", done => {
		request(app)
			.get("/api/search")
			.set("Cookie", testUser.cookie)
			.query({
				"q": attendees[0].name
			})
			.expect(200)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.be.an("array");
				expect(request.body).to.have.length(1);
				let result = request.body[0];
				expect(result).to.have.all.keys(["tag", "name", "emails", "checked_in", "id"]);
				expect(result.tag).to.be.a("string");
				expect(result.tag).to.equal(attendees[0].tag);
				expect(result.name).to.be.a("string");
				expect(result.name).to.equal(attendees[0].name);
				expect(result.emails).to.be.an("array");
				expect(result.emails).to.have.members(attendees[0].emails);
				expect(result.checked_in).to.be.a("boolean");
				expect(result.checked_in).to.be.false;
				expect(result.id).to.be.a("string");
				expect(result.id).to.equal(attendees[0].id);
			})
			.end(done);
	});
	it("GET /api/search (email)", done => {
		request(app)
			.get("/api/search")
			.set("Cookie", testUser.cookie)
			.query({
				"q": attendees[0].emails[0]
			})
			.expect(200)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.be.an("array");
				expect(request.body).to.have.length(1);
				let result = request.body[0];
				expect(result).to.have.all.keys(["tag", "name", "emails", "checked_in", "id"]);
				expect(result.tag).to.be.a("string");
				expect(result.tag).to.equal(attendees[0].tag);
				expect(result.name).to.be.a("string");
				expect(result.name).to.equal(attendees[0].name);
				expect(result.emails).to.be.an("array");
				expect(result.emails).to.have.members(attendees[0].emails);
				expect(result.checked_in).to.be.a("boolean");
				expect(result.checked_in).to.be.false;
				expect(result.id).to.be.a("string");
				expect(result.id).to.equal(attendees[0].id);
			})
			.end(done);
	});
	it("GET /api/search (check in status)", async () => {
		let checkedInAttendee = await Attendee.findOne({"id": attendees[0].id});
		checkedInAttendee.checked_in = true;
		checkedInAttendee.checked_in_by = testUser.username;
		checkedInAttendee.checked_in_date = new Date();
		await checkedInAttendee.save();

		return request(app)
			.get("/api/search")
			.set("Cookie", testUser.cookie)
			.query({
				"checkedin": "true"
			})
			.expect(200)
			.expect("Content-Type", /json/)
			.then(async request => {
				expect(request.body).to.be.an("array");
				expect(request.body).to.have.length.of.at.least(1);
				let checkedInAttendeeFound = false;
				for (let attendee of request.body) {
					expect(attendee).to.contain.all.keys(["tag", "name", "emails", "checked_in", "id"]);
					expect(attendee.tag).to.be.a("string");
					expect(attendee.name).to.be.a("string");
					expect(attendee.emails).to.be.an("array");
					expect(attendee.checked_in).to.be.a("boolean");
					if (attendee.checked_in) {
						expect(attendee).to.have.contain.keys(["checked_in_date", "checked_in_by"]);
						expect(attendee.checked_in_date).to.be.a("string");
						expect(attendee.checked_in_by).to.be.a("string");
					}
					expect(attendee.id).to.be.a("string");

					if (attendee.id === attendees[0].id) {
						checkedInAttendeeFound = true;
						expect(attendee.tag).to.equal(attendees[0].tag);
						expect(attendee.name).to.equal(attendees[0].name);
						expect(attendee.emails).to.have.members(attendees[0].emails);
						expect(attendee.checked_in).to.be.true;
						expect(attendee.checked_in_by).to.equal(testUser.username);
					}
				}
				expect(checkedInAttendeeFound).to.be.true;

				// Reset state
				checkedInAttendee = await Attendee.findOne({"id": attendees[0].id});
				checkedInAttendee.checked_in = false;
				checkedInAttendee.checked_in_by = undefined;
				checkedInAttendee.checked_in_date = undefined;
				await checkedInAttendee.save();
			});
	});
	it("GET /api/search (tag)", done => {
		request(app)
			.get("/api/search")
			.set("Cookie", testUser.cookie)
			.query({
				"tag": testTags[0]
			})
			.expect(200)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.be.an("array");
				expect(request.body).to.have.length(attendeeCount);
				for (let result of request.body) {
					expect(result).to.have.all.keys(["tag", "name", "emails", "checked_in", "id"]);
					expect(result.tag).to.be.a("string");
					expect(result.name).to.be.a("string");
					expect(result.emails).to.be.an("array");
					expect(result.checked_in).to.be.a("boolean");
					expect(result.checked_in).to.be.false;
					expect(result.id).to.be.a("string");
				}
			})
			.end(done);
	});
	it("POST /api/checkin (unauthenticated)", done => {
		request(app)
			.post("/api/checkin")
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("POST /api/checkin (authenticated)");
});