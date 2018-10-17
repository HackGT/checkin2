import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as morgan from "morgan";
import chalk from "chalk";
import * as urlib from "url";

import * as express from "express";
import * as serveStatic from "serve-static";
import * as compression from "compression";
import * as bodyParser from "body-parser";
import * as cookieParser from "cookie-parser";
import * as Handlebars from "handlebars";
import { Registration } from "./inputs/registration";
import { config } from "./config";
import { authenticateWithReject, authenticateWithRedirect, validateHostCallback } from "./middleware";
import { setupRoutes as setupGraphQlRoutes } from "./graphql";
import { IUser } from "./schema";

import { createServer } from "http";
import { SubscriptionServer } from "subscriptions-transport-ws";
import { execute, subscribe } from "graphql";

let postParser = bodyParser.urlencoded({
	extended: false
});

import * as mongoose from "mongoose";
import * as json2csv from "json2csv";

const PORT = config.server.port;
const MONGO_URL = config.server.mongo;
const STATIC_ROOT = "../client";

const VERSION_NUMBER = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")).version;

export let app = express();

if (config.server.production) {
	app.enable("trust proxy");
}

app.use(compression());
let cookieParserInstance = cookieParser(undefined, {
	"path": "/",
	"maxAge": 1000 * 60 * 60 * 24 * 30 * 6, // 6 months
	"secure": false,
	"httpOnly": true
} as cookieParser.CookieParseOptions);
app.use(cookieParserInstance);

morgan.format("hackgt", (tokens : any, request : any, response : any) => {
        let statusColorizer: (input: string) => string = input => input; // Default passthrough function
        if (response.statusCode >= 500) {
                statusColorizer = chalk.red;
        }
        else if (response.statusCode >= 400) {
                statusColorizer = chalk.yellow;
        }
        else if (response.statusCode >= 300) {
                statusColorizer = chalk.cyan;
        }
        else if (response.statusCode >= 200) {
                statusColorizer = chalk.green;
        }

        return [
                tokens.date(request, response, "iso"),
                tokens["remote-addr"](request, response),
                tokens.method(request, response),
                tokens.url(request, response),
                statusColorizer(tokens.status(request, response)),
                tokens["response-time"](request, response), "ms", "-",
                tokens.res(request, response, "content-length")
        ].join(" ");
});
app.use(morgan("hackgt"));


(mongoose as any).Promise = global.Promise;
mongoose.connect(MONGO_URL, {
	useNewUrlParser: true
});
export {mongoose};

import {User, IAttendee, IAttendeeMongoose, Attendee, Tag} from "./schema";

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

/**
 * Helper to print HackGT Metrics formatted event
 * @param args GraphQL args to checkin/checkout mutation
 * @param userInfo User object
 * @param loggedInUser Logged in CheckIn admin
 * @param checkinStatus Truthy to indicate if user was checked in or out of the given tag
 */
export function printHackGTMetricsEvent(args: {user: string, tag: string}, userInfo: any, loggedInUser :{admin: boolean; user?: IUser;} , checkinStatus: boolean) {
	console.log(JSON.stringify({
		hackgtmetricsversion: 1,
		serviceName: process.env.ROOT_URL,
		values: {
			value: 1,
			user: args.user,
			name: userInfo.user.name,
			email: userInfo.user.email
		},
		tags: {
			checkinTag: args.tag,
			check_in: checkinStatus,
			checked_in_by: loggedInUser.user ? loggedInUser.user.username : ""
		}
	}));
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
					name: name || "",
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

app.use("/api", apiRouter);

// TODO: fix, you must be logged into registration to view this.
app.route("/uploads").get(authenticateWithReject, async (request, response) => {
	const url = urlib.parse(config.inputs.registration);
	response.redirect(`${url.protocol}//${url.host}/${request.query.file}`);
});

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
		version: `v${VERSION_NUMBER}`,
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
app.get("/auth/validatehost/:nonce", validateHostCallback);

// Test Registration
const registration = new Registration({
	url: config.inputs.registration,
	key: config.secrets.adminKey
});

// Connect GraphQL API
const schema = setupGraphQlRoutes(app, registration);

// WebSocket server
const server = createServer(app);

server.listen(PORT, () => {
	console.log(`Check in system v${VERSION_NUMBER} started on port ${PORT}`);

	new SubscriptionServer({
		execute,
		subscribe,
		schema
	}, {
		server,
		path: '/graphql'
	});
});
