import * as assert from "assert";
import * as crypto from "crypto";
import * as path from "path";

import * as mocha from "mocha";
import {expect} from "chai";
import * as request from "supertest";
import * as cheerio from "cheerio";
import * as WebSocket from "ws";

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

		let user = await User.findOne({"username": testUser.username}) as IUserMongoose;
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
				expect(request.body).to.have.all.keys("success", "reauth", "created");
				expect(request.body.success).to.be.true;
				expect(request.body.reauth).to.be.true;
				expect(request.body.created).to.be.false;

				let updatedUser = await User.findOne({"username": testUser.username}) as IUserMongoose;
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
				expect(request.body).to.have.all.keys("success", "reauth", "created");
				expect(request.body.success).to.be.true;
				expect(request.body.reauth).to.be.false;
				expect(request.body.created).to.be.false;

				let updatedUser = await User.findOne({"username": newUsername}) as IUserMongoose;
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
				expect(request.body).to.have.all.keys("success", "reauth", "created");
				expect(request.body.success).to.be.true;
				expect(request.body.reauth).to.be.false;
				expect(request.body.created).to.be.true;

				let user = await User.findOne({"username": newUsername}) as IUserMongoose;
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
				expect(request.body).to.have.all.keys("success", "reauth");
				expect(request.body.success).to.be.true;
				expect(request.body.reauth).to.be.true;
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
				expect(request.body).to.have.all.keys("success", "reauth");
				expect(request.body.success).to.be.true;
				expect(request.body.reauth).to.be.false;
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
		let tagQuery = {};
		tagQuery["tags." + tag] = {$exists: true};

		expect(await Attendee.find(tagQuery)).to.have.length(0);

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

				let importedAttendees = await Attendee.find(tagQuery);
				expect(importedAttendees).to.have.length(5);
				for (let attendee of importedAttendees) {
					expect(attendee.name).to.match(/^Test \d$/);
					expect(attendee.emails).to.have.length(1);
					expect(attendee.emails[0]).to.match(/^test\d@example\.com$/);
				}
				await Attendee.find(tagQuery).remove();
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
	it("GET /api/data/export (no data)", done => {
		request(app)
			.get("/api/data/export")
			.set("Cookie", testUser.cookie)
			.expect(400)
			.expect("Content-Type", /text\/plain/)
			.end(done);
	});
	it("GET /api/data/export (with users)", async () => {
		let tag = crypto.randomBytes(16).toString("hex");
		let tagQuery = {};
		tagQuery["tags." + tag] = {$exists: true};
		expect(await Attendee.find(tagQuery)).to.have.length(0);

		const testAttendeeNumber = 25;
		let testAttendees: IAttendeeMongoose[] = [];
		for (let i = 0; i < testAttendeeNumber; i++) {
			let tagObj: ITags = {};
			tagObj[tag] = {checked_in: Math.random() > 0.5};
			testAttendees.push(new Attendee({
				name: crypto.randomBytes(16).toString("hex"),
				emails: crypto.randomBytes(16).toString("hex"),
				tags: tagObj,
				id: crypto.randomBytes(16).toString("hex")
			}));
		}
		await Attendee.insertMany(testAttendees);
		expect(await Attendee.find(tagQuery)).to.have.length(testAttendeeNumber);

		return request(app)
			.get("/api/data/export")
			.set("Cookie", testUser.cookie)
			.expect(200)
			.expect("Content-Type", /text\/csv/)
			.expect("Content-Disposition", "attachment; filename=\"export.csv\"")
			.expect(request => {
				expect(request.text.replace(/\n/g, ",").replace(/"/g, "").split(",")).to.include.members(["tag","name","emails","id", "checked_in", "checked_in_date"]);
			})
			.then(async request => {
				await Attendee.remove(tagQuery);
				expect(await Attendee.find(tagQuery)).to.have.length(0);
			});
	});
	it("PUT /api/data/tag/:tag (unauthenticated)", done => {
		request(app)
			.put("/api/data/tag/test")
			.expect(401)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("PUT /api/data/tag/:tag (authenticated)", async () => {
		let tag: string = crypto.randomBytes(32).toString("hex");
		let tagObj: ITags = {};
		let tagQuery = {};
		tagObj["tags." + tag] = { 
			checked_in: false,
			checked_in_date: undefined,
			checked_in_by: undefined 
		};
		tagQuery["tags." + tag] = {$exists: true};
		let testAttendee: IAttendee = {
			tags: tagObj,
			id: "", // Generated server-side
			name: crypto.randomBytes(32).toString("hex"),
			emails: [crypto.randomBytes(32).toString("hex") + "@example.com"],
		};
		expect(await Attendee.find(tagQuery)).to.have.length(0);

		return request(app)
			.put(`/api/data/tag/${tag}`)
			.set("Cookie", testUser.cookie)
			.type("form")
			.send({
				"name": testAttendee.name,
				"email": testAttendee.emails.join(",")
			})
			.expect(201)
			.expect("Content-Type", /json/)
			.then(async request => {
				expect(request.body).to.have.property("success");
				expect(request.body.success).to.be.true;

				let importedAttendees = await Attendee.find(tagQuery);
				expect(importedAttendees).to.have.length(1);
				expect(importedAttendees[0].name).to.equal(testAttendee.name);
				expect(importedAttendees[0].emails).to.have.length(1);
				expect(importedAttendees[0].emails[0]).to.equal(testAttendee.emails[0]);
				await Attendee.find(tagQuery).remove();
			});
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
			let tagObj: ITags = {};
			tagObj[(i < testAttendeeNumber ? tag : tag2)] = { checked_in: false };
			testAttendees.push(new Attendee({
				tags: tagObj,
				name: crypto.randomBytes(16).toString("hex"),
				emails: crypto.randomBytes(16).toString("hex"),
				id: crypto.randomBytes(16).toString("hex")
			}));
		}
		await Attendee.insertMany(testAttendees);
		let tagQuery = {};
		tagQuery["tags." + tag] = {$exists: true};
		let tag2Query = {};
		tag2Query["tags." + tag2] = {$exists: true};
		expect(await Attendee.find(tagQuery)).to.have.length(testAttendeeNumber);
		expect(await Attendee.find(tag2Query)).to.have.length(testAttendeeNumber);

		return request(app)
			.delete(`/api/data/tag/${tag}`)
			.set("Cookie", testUser.cookie)
			.expect(200)
			.expect("Content-Type", /json/)
			.then(async request => {
				expect(request.body).to.have.property("success");
				expect(request.body.success).to.be.true;

				expect(await Attendee.find(tagQuery)).to.have.length(0);
				expect(await Attendee.find(tag2Query)).to.have.length(testAttendeeNumber);

				await Attendee.remove(tag2Query);
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

		let tagObj: ITags = {};
		for (let tagIndex = 0; tagIndex < testTags.length; tagIndex++) {
			tagObj[testTags[tagIndex]] = {checked_in: false};
		}

		for (let i = 0; i < attendeeCount; i++) {
			attendees.push(new Attendee({
				tags: tagObj,
				name: crypto.randomBytes(16).toString("hex"),
				emails: crypto.randomBytes(16).toString("hex"),
				id: crypto.randomBytes(16).toString("hex")
			}));
		}

		await Attendee.insertMany(attendees);

		let tagQuery = {};
		for (let i = 0; i < testTags.length; i++) {
			tagQuery["tags." + testTags[i]] = {$exists: true};
		}
		expect(await Attendee.find(tagQuery)).to.have.length(attendeeCount);
	});
	after(async function() {
		this.timeout(1000 * 30);

		await removeTestUser();
		let ids = attendees.map(attendee => {
			return attendee.id;
		});
		await Attendee.remove({"id": ids});
		let tagQuery = {};
		for (let i = 0; i < testTags.length; i++) {
			tagQuery["tags." + testTags[i]] = {$exists: true};
		}
		expect(await Attendee.find(tagQuery)).to.have.length(0);
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
				expect(request.body).to.have.length.of.at.least(attendeeCount);
				for (let result of request.body) {
					expect(result).to.contain.all.keys(["tags", "name", "emails", "id"]);
					expect(result.tags).to.be.a("object");
					expect(result.name).to.be.a("string");
					expect(result.emails).to.be.an("array");
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
				expect(result).to.have.all.keys(["tags", "name", "emails", "id"]);
				expect(result.tags).to.be.a("object");
				expect(result.tags).to.deep.equal(attendees[0].tags);
				expect(result.name).to.be.a("string");
				expect(result.name).to.equal(attendees[0].name);
				expect(result.emails).to.be.an("array");
				expect(result.emails).to.have.members(attendees[0].emails);
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
				expect(result).to.have.all.keys(["tags", "name", "emails", "id"]);
				expect(result.tags).to.be.a("object");
				expect(result.tags).to.deep.equal(attendees[0].tags);
				expect(result.name).to.be.a("string");
				expect(result.name).to.equal(attendees[0].name);
				expect(result.emails).to.be.an("array");
				expect(result.emails).to.have.members(attendees[0].emails);
				expect(result.id).to.be.a("string");
				expect(result.id).to.equal(attendees[0].id);
			})
			.end(done);
	});
	it("GET /api/search (check in status)", async () => {
		let checkedInAttendee = await Attendee.findOne({"id": attendees[0].id}) as IAttendeeMongoose;
		let testTag = Object.keys(checkedInAttendee.tags)[0];
		checkedInAttendee.tags[testTag] = {
			checked_in: true,
			checked_in_by: testUser.username,
			checked_in_date: new Date()
		}
		checkedInAttendee.markModified('tags');
		await checkedInAttendee.save();

		return request(app)
			.get("/api/search")
			.set("Cookie", testUser.cookie)
			.query({
				"tag": testTag,
				"checkedin": "true"
			})
			.expect(200)
			.expect("Content-Type", /json/)
			.then(async request => {
				expect(request.body).to.be.an("array");
				expect(request.body).to.have.length.of.at.least(1);
				let checkedInAttendeeFound = false;
				for (let attendee of request.body) {
					expect(attendee).to.contain.all.keys(["tags", "name", "emails", "id"]);
					expect(attendee.tags).to.be.a("object");
					expect(attendee.name).to.be.a("string");
					expect(attendee.emails).to.be.an("array");
					if (attendee.tags[testTag].checked_in) {
						expect(attendee.tags[testTag]).to.have.contain.keys(["checked_in_date", "checked_in_by"]);
						expect(attendee.tags[testTag].checked_in_date).to.be.a("string");
						expect(attendee.tags[testTag].checked_in_by).to.be.a("string");
					}
					expect(attendee.id).to.be.a("string");

					if (attendee.id === attendees[0].id) {
						checkedInAttendeeFound = true;
						expect(attendee.tags[testTag].checked_in).to.equal(true);
						expect(attendee.tags[testTag].checked_in_by).to.equal(testUser.username);
						expect(attendee.name).to.equal(attendees[0].name);
						expect(attendee.emails).to.have.members(attendees[0].emails);
					}
				}
				expect(checkedInAttendeeFound).to.be.true;
				
				// Reset state
				checkedInAttendee = await Attendee.findOne({"id": attendees[0].id}) as IAttendeeMongoose;
				checkedInAttendee.tags[testTag].checked_in = false;
				checkedInAttendee.tags[testTag].checked_in_by = undefined;
				checkedInAttendee.tags[testTag].checked_in_date = undefined;
				checkedInAttendee.markModified('tags');
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
					expect(result).to.have.all.keys(["tags", "name", "emails", "id"]);
					expect(result.tags).to.be.a("object");
					expect(result.tags).to.include.all.keys([testTags[0]]);
					expect(result.name).to.be.a("string");
					expect(result.emails).to.be.an("array");
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
	it("POST /api/checkin (missing ID)", done => {
		request(app)
			.post("/api/checkin")
			.set("Cookie", testUser.cookie)
			.type("form")
			.send({
				id: "",
				revert: ""
			})
			.expect(400)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("POST /api/checkin (invalid ID)", done => {
		request(app)
			.post("/api/checkin")
			.set("Cookie", testUser.cookie)
			.type("form")
			.send({
				id: crypto.randomBytes(16).toString("hex"),
				revert: ""
			})
			.expect(400)
			.expect("Content-Type", /json/)
			.expect(request => {
				expect(request.body).to.have.property("error");
			})
			.end(done);
	});
	it("POST /api/checkin (check in)", async () => {
		let attendee = await Attendee.findOne({"id": attendees[0].id}) as IAttendeeMongoose;
		expect(attendee).to.exist;
		let testTag = Object.keys(attendee.tags)[0];
		expect(attendee.tags[testTag].checked_in).to.be.false;
		expect(attendee.tags[testTag].checked_in_by).to.not.exist;
		expect(attendee.tags[testTag].checked_in_date).to.not.exist;

		return request(app)
			.post("/api/checkin")
			.set("Cookie", testUser.cookie)
			.type("form")
			.send({
				id: attendees[0].id,
				revert: "",
				tag: testTag
			})
			.expect(200)
			.expect("Content-Type", /json/)
			.then(async request => {
				expect(request.body).to.have.property("success");
				expect(request.body.success).to.be.true;

				attendee = await Attendee.findOne({"id": attendees[0].id}) as IAttendeeMongoose;
				expect(attendee).to.exist;
				expect(attendee.tags[testTag].checked_in).to.be.true;
				expect(attendee.tags[testTag].checked_in_by).to.be.a("string");
				expect(attendee.tags[testTag].checked_in_by).to.equal(testUser.username);
				expect(attendee.tags[testTag].checked_in_date).to.be.an.instanceOf(Date);

				attendee.tags[testTag].checked_in = false;
				attendee.tags[testTag].checked_in_by = undefined;
				attendee.tags[testTag].checked_in_date = undefined;
				attendee.markModified('tags');
				await attendee.save();
			});
	});
	it("POST /api/checkin (revert check in)", async () => {
		let attendee = await Attendee.findOne({"id": attendees[0].id}) as IAttendeeMongoose;
		expect(attendee).to.exist;
		let testTag = Object.keys(attendee.tags)[0];
		attendee.tags[testTag].checked_in = true;
		attendee.tags[testTag].checked_in_by = testUser.username;
		attendee.tags[testTag].checked_in_date = new Date();
		attendee.markModified('tags');
		await attendee.save();

		return request(app)
			.post("/api/checkin")
			.set("Cookie", testUser.cookie)
			.type("form")
			.send({
				id: attendees[0].id,
				revert: "true",
				tag: testTag
			})
			.expect(200)
			.expect("Content-Type", /json/)
			.then(async request => {
				expect(request.body).to.have.property("success");
				expect(request.body.success).to.be.true;

				attendee = await Attendee.findOne({"id": attendees[0].id}) as IAttendeeMongoose;
				expect(attendee).to.exist;
				expect(attendee.tags[testTag].checked_in).to.be.false;
				expect(attendee.tags[testTag].checked_in_by).to.not.exist;
				expect(attendee.tags[testTag].checked_in_date).to.not.exist;
			});
	});
	it("POST /api/checkin (WebSockets notifications)", async () => {
		return new Promise<void>((resolve, reject) => {
			const ws = new WebSocket("ws://localhost:3000", {
				headers: { "Cookie": testUser.cookie }
			});
			let shouldReceiveMessage: boolean = false;
			ws.on("open", async () => {
				// Initiate check in request
				let attendee = await Attendee.findOne({"id": attendees[0].id}) as IAttendeeMongoose;
				expect(attendee).to.exist;
				let testTag: string = testTags[0];
				expect(attendee.tags[testTag].checked_in).to.be.false;
				expect(attendee.tags[testTag].checked_in_by).to.not.exist;
				expect(attendee.tags[testTag].checked_in_date).to.not.exist;
				shouldReceiveMessage = true;
				request(app)
					.post("/api/checkin")
					.set("Cookie", testUser.cookie)
					.type("form")
					.send({
						id: attendees[0].id,
						revert: "",
						tag: testTag
					})
					.then(async request => {
						expect(request.body).to.have.property("success");
						expect(request.body.success).to.be.true;

						attendee = await Attendee.findOne({"id": attendees[0].id}) as IAttendeeMongoose;
						attendee.tags[testTag].checked_in = false;
						attendee.tags[testTag].checked_in_by = undefined;
						attendee.tags[testTag].checked_in_date = undefined;
						attendee.markModified('tags');
						await attendee.save();
					})
					.catch(reason => {
						reject({ "message": "Check in request failed. Are you authenticated correctly?", "raw": reason });
					});
			});
			ws.on("close", (code, message) => {
				reject({ "message": "Connection was closed. Are you authenticated correctly?" });
			});
			ws.on("message", data => {
				if (!shouldReceiveMessage) {
					reject({ "message": "Got unexpected message before sending request", "data": data });
					return;
				}
				let testTag: string = testTags[0];
				let parsedData = JSON.parse(data as string);
				expect(parsedData).to.be.an("object");
				expect(parsedData.tags).to.be.a("object");
				expect(parsedData.tags).to.include.all.keys([testTag]);
				expect(parsedData.tags[testTag].checked_in).to.equal(true);
				expect(parsedData.tags[testTag].checked_in_by).to.be.a("string");
				expect(parsedData.tags[testTag].checked_in_by).to.equal(testUser.username);
				expect(parsedData.tags[testTag].checked_in_date).to.be.a("string");
				expect(parsedData.name).to.be.a("string");
				expect(parsedData.name).to.equal(attendees[0].name);
				expect(parsedData.emails).to.be.an("array");
				expect(parsedData.emails).to.have.members(attendees[0].emails);
				expect(parsedData.id).to.be.a("string");
				expect(parsedData.id).to.equal(attendees[0].id);
				expect(parsedData.reverted).to.be.false;
				resolve();
			});
		});
	});
});
