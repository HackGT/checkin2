import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import * as http from "http";

import * as express from "express";
import * as serveStatic from "serve-static";
import * as compression from "compression";
import * as bodyParser from "body-parser";
import * as cookieParser from "cookie-parser";
import * as multer from "multer";
import * as Handlebars from "handlebars";
import reEscape = require("escape-string-regexp");
import { Registration } from "./inputs/registration";
import { config } from "./config";
import { authenticateWithReject, authenticateWithRedirect } from "./middleware";
import { setupRoutes as setupGraphQlRoutes } from "./graphql";

let postParser = bodyParser.urlencoded({
	extended: false
});
let uploadHandler = multer({
	"storage": multer.diskStorage({
		destination: function (req, file, cb) {
			cb(null!, os.tmpdir());
		},
		filename: function (req, file, cb) {
			cb(null!, `${file.fieldname}-${Date.now()}.csv`);
		}
	}),
	"limits": {
		"fileSize": 50000000, // 50 MB
		"files": 1
	},
	"fileFilter": function (request, file, callback) {
		callback(null!, !!file.originalname.match("\.csv$"));
	}
});

import * as mongoose from "mongoose";
import * as csvParse from "csv-parse";
import * as json2csv from "json2csv";
import * as WebSocket from "ws";

const PORT = config.server.port;
const MONGO_URL = config.server.mongo;
const STATIC_ROOT = "../client";

const VERSION_NUMBER = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")).version;
const VERSION_HASH = require("git-rev-sync").short();

export let app = express();
app.use(compression());
let cookieParserInstance = cookieParser(undefined, {
	"path": "/",
	"maxAge": 1000 * 60 * 60 * 24 * 30 * 6, // 6 months
	"secure": false,
	"httpOnly": true
} as cookieParser.CookieParseOptions);
app.use(cookieParserInstance);

(mongoose as any).Promise = global.Promise;
mongoose.connect(MONGO_URL, {
	useMongoClient: true
});
export {mongoose};

import {User, IAttendee, IAttendeeMongoose, Attendee, ITags, Tag} from "./schema";

// Promise version of crypto.pbkdf2()
export function pbkdf2Async (...params: any[]) {
	return new Promise<Buffer>((resolve, reject) => {
		params.push(function (err: Error, derivedKey: Buffer) {
			if (err) {
				reject(err);
				return;
			}
			resolve(derivedKey);
		});
		crypto.pbkdf2.apply(null, params);
	});
}
export function readFileAsync (filename: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		fs.readFile(filename, "utf8", (err, data) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(data);
		})
	});
}

// Check for number of users and create default account if none
(async () => {
	// Create default user if there are none.
	if (!(await User.findOne())) {
		let salt = crypto.randomBytes(32);
		let passwordHashed = await pbkdf2Async(config.app.default_admin.password,
											   salt, 500000, 128, "sha256");

		let defaultUser = new User({
			username: config.app.default_admin.username,
			login: {
				hash: passwordHashed.toString("hex"),
				salt: salt.toString("hex")
			},
			auth_keys: []
		});
		await defaultUser.save();
		console.info(`
			Created default user
			Username: ${config.app.default_admin.username}
			Password: ${config.app.default_admin.password}
			**Delete this user after you have used it to set up your account**
		`);
	}

	// Add default list of tags if there are none.
	if (!(await Tag.findOne())) {
		// Add default tag
		let defaultTag = new Tag({
			name: "hackgt"
		});
		await defaultTag.save();
	}
})();

function simplifyAttendee(attendee: IAttendeeMongoose): IAttendee {
	return {
		name: attendee.name,
		emails: attendee.emails,
		id: attendee.id,
		tags: attendee.tags
	};
}

let apiRouter = express.Router();
// User routes
apiRouter.route("/user/update").put(authenticateWithReject, postParser, async (request, response) => {
	let username: string = request.body.username || "";
	let password: string = request.body.password || "";
	username = username.trim();
	if (!username || !password) {
		response.status(400).json({
			"error": "Username or password not specified"
		});
		return;
	}

	let user = await User.findOne({username: username});
	let userCreated: boolean = !user;
	let salt = crypto.randomBytes(32);
	let passwordHashed = await pbkdf2Async(password, salt, 500000, 128, "sha256");
	if (!user) {
		// Create new user
		user = new User({
			username: username,
			login: {
				hash: passwordHashed.toString("hex"),
				salt: salt.toString("hex")
			},
			auth_keys: []
		});
	}
	else {
		// Update password
		user.login.hash = passwordHashed.toString("hex");
		user.login.salt = salt.toString("hex");
		// Logs out active users
		user.auth_keys = [];
	}

	try {
		await user.save();
		response.status(201).json({
			"success": true,
			"reauth": username === response.locals.username,
			"created": userCreated
		});
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			"error": `An error occurred while ${!userCreated ? "updating" : "creating"} the user`
		});
	}
}).delete(authenticateWithReject, postParser, async (request, response) => {
	let username: string = request.body.username || "";
	if (!username) {
		response.status(400).json({
			"error": "Username not specified"
		});
		return;
	}
	try {
		if ((await User.find()).length === 1) {
			response.status(412).json({
				"error": "You cannot delete the only user"
			});
			return;
		}
		await User.remove({ "username": username });
		response.status(201).json({
			"success": true,
			"reauth": username === response.locals.username
		});
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			"error": `An error occurred while deleting the user`
		});
	}
});

apiRouter.route("/user/login").post(postParser, async (request, response) => {
	response.clearCookie("auth");
	let username: string = request.body.username || "";
	let password: string = request.body.password || "";
	username = username.trim();
	if (!username || !password) {
		response.status(400).json({
			"error": "Username or password not specified"
		});
		return;
	}

	let user = await User.findOne({username: username});
	let salt: Buffer;
	if (!user) {
		salt = new Buffer(32);
	}
	else {
		salt = Buffer.from(user.login.salt, "hex");
	}
	// Hash the password in both cases so that requests for non-existant usernames take the same amount of time as existant ones
	let passwordHashed = await pbkdf2Async(password, salt, 500000, 128, "sha256");
	if (!user || user.login.hash !== passwordHashed.toString("hex")) {
		response.status(401).json({
			"error": "Username or password incorrect"
		});
		return;
	}
	let authKey = crypto.randomBytes(32).toString("hex");
	user.auth_keys.push(authKey);

	try {
		await user.save();
		response.cookie("auth", authKey);
		response.status(200).json({
			"success": true
		});
	}
	catch (e) {
		console.error(e);
		response.status(500).json({
			"error": "An error occurred while logging in"
		});
	}
});

// User importing from CSV files
// `import` is the fieldname that should be used to upload the CSV file
apiRouter.route("/data/import").post(authenticateWithReject, uploadHandler.single("import"), (request, response) => {
	let parser = csvParse({ trim: true });
	let attendeeData: IAttendee[] = [];
	let headerParsed: boolean = false;
	let nameIndex: number | null = null;
	let emailIndexes: number[] = [];

	let tag: string = request.body.tag;
	let nameHeader: string = request.body.name;
	let emailHeadersRaw: string = request.body.email;
	if (!tag) {
		response.status(400).json({
			"error": "Missing tag"
		});
		return;
	}
	if (!nameHeader || !emailHeadersRaw) {
		response.status(400).json({
			"error": "Missing CSV headers names to import"
		});
		return;
	}
	let tagNames: string[] = tag.toLowerCase().split(/, */);
	let tags: ITags = {};
	for (let i = 0; i < tagNames.length; i++) {
		tags[tagNames[i]] = {checked_in: false};
	}
	tag = tag.trim().toLowerCase();
	nameHeader = nameHeader.trim();
	let emailHeaders: string[] = emailHeadersRaw.split(",").map((header) => { return header.trim(); });

	parser.on("readable", () => {
		let record: any;
		while (record = parser.read()) {
			if (!headerParsed) {
				// Header row
				for (let i = 0; i < record.length; i++) {
					let label: string = record[i];

					if (label.match(new RegExp(`^${reEscape(nameHeader)}$`, "i"))) {
						nameIndex = i;
					}
					for (let emailHeader of emailHeaders) {
						if (label.match(new RegExp(`^${reEscape(emailHeader)}$`, "i"))) {
							emailIndexes.push(i);
						}
					}
				}
				headerParsed = true;
			}
			else {
				// Content rows
				if (nameIndex === null || emailIndexes.length === 0) {
					throw new Error("Invalid header names");
				}
				// Capitalize names
				let name: string = record[nameIndex] || "";
				name = name.split(" ").map(s => {
					return s.charAt(0).toUpperCase() + s.slice(1)
				}).join(" ");

				let emails: string[] = [];
				for (let emailIndex of emailIndexes) {
					if (record[emailIndex])
						emails.push(record[emailIndex]);
				}

				if (!name || emails.length === 0) {
					console.warn("Skipping due to missing name and/or emails", record);
					continue;
				}

				attendeeData.push({
					name: name,
					emails: emails,
					id: crypto.randomBytes(16).toString("hex"),
					tags: tags
				});
			}
		}
	});
	let hasErrored: boolean = false;
	parser.on("error", (err: Error) => {
		hasErrored = true;
		if (err.message !== "Invalid header names") {
			console.error(err);
		}
		response.status(415).json({
			"error": "Invalid header names or CSV"
		});
	});
	parser.on("finish", async () => {
		if (hasErrored)
			return;
		if (attendeeData.length < 1) {
			response.status(415).json({
				"error": "No entries to import"
			});
			return;
		}
		let attendees: IAttendeeMongoose[] = attendeeData.map((attendee) => {
			return new Attendee(attendee);
		});
		try {
			await Attendee.insertMany(attendees);
			response.status(200).json({
				"success": true
			});
		}
		catch (err) {
			if (err.code === 11000) {
				response.status(409).json({
					"error": "Name duplication detected. Please clear the current attendee list before importing this new list."
				});
				return;
			}
			console.error(err);
			response.status(500).json({
				"error": "An error occurred while saving users to the database"
			});
		}
	});
	if (!request.file) {
		response.status(400).json({
			"error": "No CSV file to process and import"
		});
		return;
	}
	fs.createReadStream(request.file.path).pipe(parser);
});

apiRouter.route("/data/export").get(authenticateWithReject, async (request, response) => {
	try {
		let attendees: IAttendeeMongoose[] = await Attendee.find();
		let attendeesSimplified: {
			id: string;
			name: string;
			emails: string;
			tag: string;
			checked_in: string;
			checked_in_date: string;
		 }[] = [];
		for (let attendee of attendees.map(simplifyAttendee)) {
			let id = attendee.id;
			let emails = attendee.emails.join(", ");
			let name = attendee.name;
			Object.keys(attendee.tags).forEach(tag => {
				let checkedInDate = attendee.tags[tag].checked_in_date;
				attendeesSimplified.push({
					id: id,
					name: name,
					emails: emails,
					tag: tag,
					checked_in: attendee.tags[tag].checked_in ? "Checked in" : "",
					checked_in_date: checkedInDate ? checkedInDate.toISOString() : ""
				});
			});
		}
		if (attendeesSimplified.length === 0) {
			response.status(400).type("text/plain").end("No data to export");
			return;
		}
		response.status(200).type("text/csv").attachment("export.csv");
		response.write(json2csv({ data: attendeesSimplified, fields: Object.keys(attendeesSimplified[0])}));
		response.end();
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			"error": "An error occurred while exporting data"
		});
	}
});

apiRouter.route("/data/tag/:tag").put(authenticateWithReject, postParser, async (request, response) => {
	let tag: string = request.params.tag;
	let name: string = request.body.name;
	let emails: string[] = request.body.email ? request.body.email
		.split(",")
		.map((email: string) => email.trim()) : [];

	if (!name || !name.trim() || emails.length === 0) {
		response.status(400).json({
			"error": "Missing name or emails"
		});
	}

	let tagNames = tag.toLowerCase().split(/, */);
	let tags: ITags = {}
	for (let i = 0; i < tagNames.length; i++) {
		tags[tagNames[i]] = {checked_in: false};
	}

	try {
		await new Attendee({
			name,
			emails,
			id: crypto.randomBytes(16).toString("hex"),
			tags: tags
		}).save();
		response.status(201).json({
			"success": true
		});
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			"error": "An error occurred while adding attendee"
		});
	}
}).delete(authenticateWithReject, async (request, response) => {
	let tag: string = request.params.tag;

	try {
		// Remove tag from the attendees
		await Attendee.update({
			["tags." + tag]: {
				$exists: true
			}
		}, {
			$unset: {
				["tags." + tag]: 1
			}
		}, {
			multi: true
		});
		// Remove attendees that now have no tags
		await Attendee.remove({'tags': {}});
		response.status(200).json({
			"success": true
		});
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			"error": "An error occurred while deleting tag"
		});
	}
});

apiRouter.route("/search").get(authenticateWithReject, async (request, response) => {
	let query: string = request.query.q || "";
	let queryRegExp = new RegExp(query, "i");
	let checkinStatus: string = request.query.checkedin || "";
	let tag: string = request.query.tag || "";
	tag = tag.toLowerCase();
	// Search through name and both emails
	let filteredAttendees: IAttendeeMongoose[];
	try {
		filteredAttendees = await Attendee.find().or([
			{
				"name": { $regex: queryRegExp }
			},
			{
				"emails": { $regex: queryRegExp }
			}
		]).exec();
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			"error": "An error occurred while getting attendee data"
		});
		return;
	}
	// Sort by last name
	filteredAttendees = filteredAttendees.sort((a, b) => {
		var aName = a.name.split(" ");
		var bName = b.name.split(" ");
		var aLastName = aName[aName.length - 1];
		var bLastName = bName[bName.length - 1];
		if (aLastName < bLastName) return -1;
		if (aLastName > bLastName) return 1;
		return 0;
	});
	// Filter by tag specified
	if (tag) {
		filteredAttendees = filteredAttendees.filter(attendee => {
			return attendee.tags.hasOwnProperty(tag);
		});
	}
	// Filter by check in status if specified
	if (tag && checkinStatus) {
		let checkedIn: boolean = checkinStatus === "true";
		filteredAttendees = filteredAttendees.filter(attendee => {
			return attendee.tags[tag].checked_in === checkedIn;
		});
	}
	// Map to remove mongoose attributes
	response.json(filteredAttendees.map(simplifyAttendee));
});

apiRouter.route("/checkin").post(authenticateWithReject, postParser, async (request, response) => {
	let id: string = request.body.id || "";
	let shouldRevert: boolean = request.body.revert === "true";
	let tag: string = request.body.tag;
	if (!id) {
		response.status(400).json({
			"error": "Missing attendee ID"
		});
		return;
	}
	let attendee = await Attendee.findOne({id: id});
	if (!attendee) {
		response.status(400).json({
			"error": "Invalid attendee ID"
		});
		return;
	}
	if (!tag) {
		response.status(400).json({
			"error": "Must specify tag"
		});
		return;
	}
	if (!attendee.tags.hasOwnProperty(tag)) {
		response.status(400).json({
			"error": "Incorrect tag"
		});
		return;
	}
	if (shouldRevert) {
		attendee.tags[tag].checked_in = false;
		attendee.tags[tag].checked_in_by = undefined;
		attendee.tags[tag].checked_in_date = undefined;
	}
	else {
		attendee.tags[tag].checked_in = true;
		attendee.tags[tag].checked_in_by = response.locals.username;
		attendee.tags[tag].checked_in_date = new Date();
	}
	attendee.markModified("tags");
	try {
		await attendee.save();
		let updateData = JSON.stringify({
			...simplifyAttendee(attendee),
			updatedTag: tag,
			reverted: shouldRevert
		});
		wss.clients.forEach(function each(client) {
			if (client.readyState === WebSocket.OPEN) {
				client.send(updateData);
			}
		});
		response.status(200).json({
			"success": true
		});
	}
	catch (e) {
		console.error(e);
		response.status(500).json({
			"error": "An error occurred while processing check in"
		});
	}
});

// Endpoint for adding tags to existing groups of attendees
apiRouter.route("/data/addTag/:tag").put(authenticateWithReject, postParser, async (request, response) => {
	let tag: string = request.params.tag;
	let currentTag: string = request.body.currentTag;
	if (!currentTag) {
		response.status(400).json({
			"error": "Must provide existing tag"
		});
		return;
	}
	try {
		await Attendee.update({
			["tags." + currentTag]: {
				$exists: true
			},
			["tags." + tag]: {
				$exists: false
			},
		}, {
			["tags." + tag]: {
				checked_in: false
			}
		}, {
			multi: true
		});
		response.status(200).json({
			"success": true
		});
	}
	catch (e) {
		console.log(e);
		response.status(500).json({
			"error": "An error occurred while adding tag to attendees"
		});
	}
});

app.use("/api", apiRouter);

const indexTemplate = Handlebars.compile(fs.readFileSync(path.join(__dirname, STATIC_ROOT, "index.html"), "utf8"));
app.route("/").get(authenticateWithRedirect, async (request, response) => {
	let allTags = await Tag.find().sort({ name: "asc" });
	let tags: string[] = allTags.map(t => t.name);
	let users = await User.find().sort({ username: "asc" });
	let userInfo = users.map(user => {
		return {
			username: user.username,
			activeSessions: `${user.auth_keys.length} active session${user.auth_keys.length === 1 ? "" : "s"}`,
			isActiveSession: user.username === response.locals.username
		};
	});

	response.send(indexTemplate({
		username: response.locals.username,
		version: `v${VERSION_NUMBER} @ ${VERSION_HASH}`,
		tags,
		userInfo
	}));
});
app.route("/login").get(async (request, response) => {
	if (request.cookies.auth) {
		let authKey: string = request.cookies.auth;
		await User.update({ "auth_keys": authKey }, { $pull: { "auth_keys": authKey } }).exec();
		response.clearCookie("auth");
	}
	try {
		response.send(await readFileAsync(path.join(__dirname, STATIC_ROOT, "login.html")));
	}
	catch (err) {
		console.error(err);
		response.status(500).send("An internal server error occurred");
	}
});
app.use("/node_modules", serveStatic(path.resolve(__dirname, "../node_modules")));
app.use("/", serveStatic(path.resolve(__dirname, STATIC_ROOT)));

// Test Registration
const registration = new Registration({
	url: config.inputs.registration,
	key: config.secrets.adminKey
});

// Connect GraphQL API
setupGraphQlRoutes(app, registration);

// WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
wss.on("connection", function(rawSocket, _request) {
	let request = _request as express.Request;
	cookieParserInstance(request, null!, async (err) => {
		let authKey = request.cookies.auth;
		let user = await User.findOne({"auth_keys": authKey});
		if (!user) {
			rawSocket.close();
		}
	});
});
server.listen(PORT, () => {
	console.log(`Check in system v${VERSION_NUMBER} @ ${VERSION_HASH} started on port ${PORT}`);
});
