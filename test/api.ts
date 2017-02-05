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
	it("Authenticated PUT /api/user/update (no data)", done => {
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
	it("Authenticated PUT /api/user/update (update current user)", async function () {
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
	it("Authenticated PUT /api/user/update (update different user)", async function () {
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
	it("Authenticated PUT /api/user/update (add new user)", async function () {
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