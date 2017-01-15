import * as crypto from "crypto";

import * as express from "express";
import * as compression from "compression";
import * as bodyParser from "body-parser";
import * as cookieParser from "cookie-parser";
let postParser = bodyParser.json();

import * as mongoose from "mongoose";
import * as bluebird from "bluebird";

let app = express();
app.use(compression());
app.use(cookieParser(undefined, {
	"path": "/",
	"maxAge": 1000 * 60 * 60 * 24 * 30 * 6, // 6 months
	"secure": false,
	"httpOnly": true
}));

const PORT = 3000;
const DATABASE = "test";

(<any>mongoose).Promise = global.Promise;
mongoose.connect(`mongodb://localhost/${DATABASE}`);

interface IUser extends mongoose.Document {
	username: string;
	login: {
		hash: string;
		salt: string;
	};
	auth_keys: string[];
}

const User = mongoose.model<IUser>("User", new mongoose.Schema({
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
interface IAttendee extends mongoose.Document {
	name: string;
	email: string;
	checked_in: boolean;
	date: Date;
}
const Attendee = mongoose.model<IAttendee>("Attendee", new mongoose.Schema({
	name: {
		type: String,
		required: true,
		unique: true
	},
	email: {
		type: String,
		required: true,
		unique: true
	},
	checked_in: {
		type: Boolean,
		required: true,
	},
	date: { type: Date, default: Date.now }
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

// User routes
app.route("/user/signup").post(postParser, async (request, response) => {
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

	let salt = crypto.randomBytes(32);
	let passwordHashed = await pbkdf2Async(password, salt, 500000, 128, "sha256");
	let authKey = crypto.randomBytes(32).toString("hex");

	let user = new User({
		username: username,
		login: {
			hash: passwordHashed.toString("hex"),
			salt: salt.toString("hex")
		},
		auth_keys: [authKey]
	});
	try {
		await user.save();
		response.cookie("auth", authKey);
		response.status(201).json({
			"success": true
		});
	}
	catch (e) {
		if (e.code === 11000) {
			response.status(400).json({
				"error": "That username is already in use"
			});
			return;
		}
		console.error(e);
		response.status(500).json({
			"error": "An error occurred while saving the new user"
		});
	}
});
app.route("/user/login").post(postParser, async function (request, response) {
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

/*app.post("/addattendee", function (req, res) {
	let attendee = new Attendee({
		name: req.param("name"),
		email: req.param("email"),
		checked_in: false
	});
	return Q.ninvoke(attendee, "save").catch(function(err) {
		console.err(err)
	});
});


app.post("/checkin", function (req, res) {
	Attendee.
	findOne({ email: req.param("email") }).
	select("name email").
	exec().then(function(err, hacker) {
		// TODO: handle error better
		if (err) return res.sendStatus(404);
		return res.send(JSON.stringify(hacker))
	}).catch(function(err) {
		return res.sendStatus(500);
	});
})*/

app.get("/", (request, response) => {
	// TODO: implement UI
  	response.send("Hello World!");
});

app.listen(PORT, () => {
	console.log(`Check in system started on port ${PORT}`);
});