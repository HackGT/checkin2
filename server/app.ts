import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";

import * as express from "express";
import * as compression from "compression";
import * as bodyParser from "body-parser";
import * as cookieParser from "cookie-parser";
import * as multer from "multer";
let postParser = bodyParser.json();
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
		"files": 1,
		"fields": 0
	},
	"fileFilter": function (request, file, callback) {
		callback(null!, !!file.originalname.match("\.csv$"));
	}
});

import * as mongoose from "mongoose";
import * as csvParse from "csv-parse";

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
	name: string;
	communication_email: string;
	gatech_email: string;
	checked_in: boolean;
	checked_in_date?: Date;
}
interface IAttendeeMongoose extends IAttendee, mongoose.Document {}
const Attendee = mongoose.model<IAttendeeMongoose>("Attendee", new mongoose.Schema({
	name: {
		type: String,
		required: true,
		//unique: true
	},
	communication_email: {
		type: String,
		required: true
	},
	gatech_email: {
		type: String,
		required: true
	},
	checked_in: {
		type: Boolean,
		required: true,
	},
	checked_in_date: {
		type: Date
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

let authenticateMiddleware = async function (request: express.Request, response: express.Response, next: express.NextFunction) {
	let authKey = request.cookies.auth;
	let user = await User.findOne({"auth_keys": authKey});
	if (!user) {
		response.status(401).json({
			"error": "You must log in to access this endpoint"
		});
	}
	else {
		next();
	}
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
app.route("/user/login").post(postParser, async (request, response) => {
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
app.route("/data/import").post(authenticateMiddleware, uploadHandler.single("import"), (request, response) => {
	let parser = csvParse({ trim: true });
	let attendeeData: IAttendee[] = [];
	let headerParsed: boolean = false;
	let nameIndex: number = 0;
	let emailIndex: number = 0;
	let gatechEmailIndex: number = 0;

	parser.on("readable", () => {
		let record: any;
		while (record = parser.read()) {
			if (!headerParsed) {
				// Header row
				for (let i = 0; i < record.length; i++) {
					let label = record[i];
					if (label.match(/^email address$/i)) {
						emailIndex = i;
					}
					else if (label.match(/^gt email address$/i)) {
						gatechEmailIndex = i;
					}
					else if (label.match(/^name$/i)) {
						nameIndex = i;
					}
				}
				headerParsed = true;
			}
			else {
				// Content rows
				if (!record[nameIndex] || !record[emailIndex] || !record[gatechEmailIndex]) {
					console.warn("Skipping due to missing required parameters", record);
					continue;
				}
				// Capitalize names
				let name: string = record[nameIndex];
				name = name.split(" ").map(s => {
					return s.charAt(0).toUpperCase() + s.slice(1)
				}).join(" ");
				attendeeData.push({
					name: name,
					communication_email: record[emailIndex].toLowerCase(),
					gatech_email: record[gatechEmailIndex].toLowerCase(),
					checked_in: false
				});
			}
		}
	});
	let hasErrored: boolean = false;
	parser.on("error", err => {
		hasErrored = true;
		console.error(err);
		response.status(500).json({
			"error": "Invalid CSV uploaded"
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
				response.status(400).json({
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
	fs.createReadStream(request.file.path).pipe(parser);
});

/*
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