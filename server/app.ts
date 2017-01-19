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
import * as WebSocket from "ws";
import * as cheerio from "cheerio";

const PORT = parseInt(process.env.PORT) || 3000;
const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost";
const UNIQUE_APP_ID = process.env.UNIQUE_APP_ID || "ultimate-checkin";
const STATIC_ROOT = "../client";

const VERSION_NUMBER = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version;
const VERSION_HASH = process.env.VERSION_HASH || require("git-rev-sync").short();

let app = express();
app.use(compression());
let cookieParserInstance = cookieParser(undefined, {
	"path": "/",
	"maxAge": 1000 * 60 * 60 * 24 * 30 * 6, // 6 months
	"secure": false,
	"httpOnly": true
});
app.use(cookieParserInstance);

(<any>mongoose).Promise = global.Promise;
mongoose.connect(`${MONGO_URL}/${UNIQUE_APP_ID}`);

interface IUser {
	username: string;
	login: {
		hash: string;
		salt: string;
	};
	auth_keys: string[];
}
interface IUserMongoose extends IUser, mongoose.Document {}

const User = mongoose.model<IUserMongoose>("User", new mongoose.Schema({
	username: {
		type: String,
		required: true,
		unique: true
	},
	login: {
		hash: {
			type: String,
			required: true,
		},
		salt: {
			type: String,
			required: true,
		}
	},
	auth_keys: [String]
}));
interface IAttendee {
	id: string;
	tag: string;
	name: string;
	emails: string[];
	checked_in: boolean;
	checked_in_date?: Date;
	checked_in_by?: string;
}
interface IAttendeeMongoose extends IAttendee, mongoose.Document {}
const Attendee = mongoose.model<IAttendeeMongoose>("Attendee", new mongoose.Schema({
	id: {
		type: String,
		required: true,
		unique: true
	},
	tag: {
		type: String,
		required: true
	},
	name: {
		type: String,
		required: true,
		//unique: true
	},
	emails: {
		type: [String],
		required: true
	},
	checked_in: {
		type: Boolean,
		required: true,
	},
	checked_in_date: {
		type: Date
	},
	checked_in_by: {
		type: String
	}
}));

// Promise version of crypto.pbkdf2()
function pbkdf2Async (...params: any[]) {
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

// Check for number of users and create default account if none
const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin";
(async () => {
	let users = await User.find();
	if (users.length !== 0)
		return;

	let salt = crypto.randomBytes(32);
	let passwordHashed = await pbkdf2Async(DEFAULT_PASSWORD, salt, 500000, 128, "sha256");

	let defaultUser = new User({
		username: DEFAULT_USERNAME,
		login: {
			hash: passwordHashed.toString("hex"),
			salt: salt.toString("hex")
		},
		auth_keys: []
	});
	await defaultUser.save();
	console.info(`
Created default user
	Username: ${DEFAULT_USERNAME}
	Password: ${DEFAULT_PASSWORD}
**Delete this user after you have used it to set up your account**
	`);
})();

let authenticateWithReject = async function (request: express.Request, response: express.Response, next: express.NextFunction) {
	let authKey = request.cookies.auth;
	let user = await User.findOne({"auth_keys": authKey});
	if (!user) {
		response.status(401).json({
			"error": "You must log in to access this endpoint"
		});
	}
	else {
		response.locals.username = user.username;
		next();
	}
};
let authenticateWithRedirect = async function (request: express.Request, response: express.Response, next: express.NextFunction) {
	let authKey = request.cookies.auth;
	let user = await User.findOne({"auth_keys": authKey});
	if (!user) {
		response.redirect("/login");
	}
	else {
		response.locals.username = user.username;
		next();
	}
};

function generateUserList (currentUserName: string): Promise<string> {
	return new Promise<string>(async (resolve, reject) => {
		let users = await User.find().sort({ username: "asc" });
		resolve(users.map((user) => {
			let username = user.username.replace("&", "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
			return `
				<li class="mdc-list-item">
					<i class="mdc-list-item__start-detail material-icons" aria-hidden="true">account_box</i>
					<span class="mdc-list-item__text">
						<span class="mdc-list-item__text__primary mdc-typography--title username">${user.username}</span>
						<span class="mdc-list-item__text__primary mdc-typography--body1">${user.auth_keys.length} active session${user.auth_keys.length === 1 ? "": "s"}</span>
					</span>
					<div class="actions">
						<span class="mdc-typography--body2 status">${user.username === currentUserName ? "Active session" : ""}</span>
						<button class="mdc-button mdc-button--primary mdc-ripple-surface mdc-button--raised danger" data-mdc-auto-init="MDCRipple">
							Delete
						</button>
					</div>
				</li>
			`;
		}).join("\n"));
	});
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
			"created": userCreated,
			"userlist": await generateUserList(response.locals.username)
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
			"reauth": username === response.locals.username,
			"userlist": await generateUserList(response.locals.username)
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

					if (label.match(new RegExp(`^${nameHeader}$`, "i"))) {
						nameIndex = i;
					}
					for (let emailHeader of emailHeaders) {
						if (label.match(new RegExp(`^${emailHeader}$`, "i"))) {
							emailIndexes.push(i);
						}
					}
				}
				headerParsed = true;
			}
			else {
				// Content rows
				if (!nameIndex || emailIndexes.length === 0) {
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
					tag: tag,
					name: name,
					emails: emails,
					checked_in: false,
					id: crypto.randomBytes(16).toString("hex")
				});
			}
		}
	});
	let hasErrored: boolean = false;
	parser.on("error", err => {
		hasErrored = true;
		console.error(err);
		response.status(500).json({
			"error": "Invalid header names or CSV"
		});
	});
	parser.on("finish", async () => {
		if (hasErrored)
			return;
		if (attendeeData.length < 1) {
			response.status(400).json({
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

apiRouter.route("/data/tag/:tag").delete(authenticateWithReject, async (request, response) => {
	let tag: string = request.params.tag;

	try {
		await Attendee.find({"tag": tag}).remove();
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
	// Filter by check in status if specified
	if (checkinStatus) {
		let checkedIn: boolean = checkinStatus === "true";
		filteredAttendees = filteredAttendees.filter(attendee => {
			return attendee.checked_in === checkedIn;
		});
	}
	// Filter by tag if specified
	if (tag) {
		filteredAttendees = filteredAttendees.filter(attendee => {
			return attendee.tag === tag;
		});
	}
	// Map to remove mongoose attributes
	response.json(filteredAttendees.map((attendee): IAttendee => {
		return {
			tag: attendee.tag,
			name: attendee.name,
			emails: attendee.emails,
			checked_in: attendee.checked_in,
			checked_in_date: attendee.checked_in_date,
			checked_in_by: attendee.checked_in_by,
			id: attendee.id
		};
	}));
});

apiRouter.route("/checkin").post(authenticateWithReject, postParser, async (request, response) => {
	let id: string = request.body.id || "";
	let shouldRevert: boolean = request.body.revert === "true";
	if (!id) {
		response.status(400).json({
			"error": "Missing attendee ID"
		});
		return;
	}
	let attendee = await Attendee.findOne({id: id});
	if (shouldRevert) {
		attendee.checked_in = false;
		attendee.checked_in_by = undefined;
		attendee.checked_in_date = undefined;
	}
	else {
		attendee.checked_in = true;
		attendee.checked_in_by = response.locals.username;
		attendee.checked_in_date = new Date();
	}

	try {
		await attendee.save();
		let updateData = JSON.stringify({
			reverted: shouldRevert,
			tag: attendee.tag,
			name: attendee.name,
			emails: attendee.emails,
			checked_in: attendee.checked_in,
			checked_in_date: attendee.checked_in_date,
			checked_in_by: attendee.checked_in_by,
			id: attendee.id
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

app.use("/api", apiRouter);

app.route("/").get(authenticateWithRedirect, (request, response) => {
	fs.readFile(path.join(__dirname, STATIC_ROOT, "index.html"), { encoding: "utf8" }, async (err, html) => {
		if (err) {
			console.error(err);
			response.status(500).send("An internal server error occurred");
			return;
		}
		let attendees = await Attendee.find().sort({ tag: "asc" });
		let tags: string[] = attendees.reduce((prev, current) => {
			if (prev.indexOf(current.tag) === -1) {
				// Escape possible HTML in tags
				let tag: string = current.tag.replace("&", "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
				prev.push(tag);
			}
			return prev;
		}, <string[]> []);

		let $ = cheerio.load(html);
		$("#username").text(response.locals.username);
		$("#version").text(`v${VERSION_NUMBER} @ ${VERSION_HASH}`);
		for (let tag of tags) {
			$(".tags").append(`<option>${tag}</option>`);
		}
		let userListHTML: string = await generateUserList(response.locals.username);
		$("#users").append(userListHTML);

		response.send($.html());
	});
});
app.route("/login").get(async (request, response) => {
	if (request.cookies.auth) {
		let authKey: string = request.cookies.auth;
		await User.update({ "auth_keys": authKey }, { $pull: { "auth_keys": authKey } }).exec();
		response.clearCookie("auth");
	}
	fs.readFile(path.join(__dirname, STATIC_ROOT, "login.html"), { encoding: "utf8" }, (err, html) => {
		if (err) {
			console.error(err);
			response.status(500).send("An internal server error occurred");
			return;
		}
		response.send(html);
	});
});
app.use("/node_modules", serveStatic(path.resolve(__dirname, "node_modules")));
app.use("/", serveStatic(path.resolve(__dirname, STATIC_ROOT)));

// WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
wss.on("connection", function(rawSocket) {
	let request = (<express.Request> rawSocket.upgradeReq);
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
