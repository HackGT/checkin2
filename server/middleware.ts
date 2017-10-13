import * as express from "express";
import * as http from "http";
import * as https from "https";
import * as crypto from "crypto";
import { config } from "./config";
import { User, IUser } from "./schema";
import { createLink } from "./util";

export async function authenticateWithReject(
	request: express.Request,
	response: express.Response,
	next: express.NextFunction
) {
	response.setHeader("Cache-Control", "private");
	const perms = await getLoggedInUser(request);
	if (!perms.admin) {
		response.status(401).json({
			"error": "You must log in to access this endpoint"
		});
	}
	else {
		if (perms.user) {
			response.locals.username = perms.user.username;
		}
		next();
	}
};

export async function authenticateWithRedirect(
	request: express.Request,
	response: express.Response,
	next: express.NextFunction
) {
	response.setHeader("Cache-Control", "private");
	const perms = await getLoggedInUser(request);
	if (!perms.admin) {
		response.redirect("/login");
	}
	else {
		if (perms.user) {
			response.locals.username = perms.user.username;
		}
		next();
	}
};

export async function getLoggedInUser(request: express.Request): Promise<{
	admin: boolean;
	user?: IUser;
}> {
	const authKey = request.cookies.auth;
	const user = await User.findOne({"auth_keys": authKey});

	if (user) {
		return {
			admin: true,
			user: user
		};
	}

	const auth = request.headers.authorization;

	if (auth && typeof auth === "string" && auth.indexOf(" ") > -1) {
		const key = new Buffer(auth.split(" ")[1], "base64").toString();
		if (key === config.secrets.adminKey) {
			return {
				admin: true,
			};
		}
	}
	return {
		admin: false,
	};
}

// const validatedHostNames: string[] = [];
const validateHostNameChallenge = crypto.randomBytes(64).toString("hex");

// export function validateAndCacheHostName(
// 	request: express.Request,
// 	response: express.Response,
// 	next: express.NextFunction
// ) {
// 	// Basically checks to see if the server behind the hostname has the same
// 	// session key by HMACing a random nonce
// 	if (validatedHostNames.find(hostname => hostname === request.hostname)) {
// 		next();
// 		return;
// 	}

// 	let nonce = crypto.randomBytes(64).toString("hex");
// 	const callback = (message: http.IncomingMessage) => {
// 		if (message.statusCode !== 200) {
// 			console.error(`Got non-OK status code when validating hostname: ${request.hostname}`);
// 			message.resume();
// 			return;
// 		}
// 		message.setEncoding("utf8");
// 		let data = "";
// 		message.on("data", (chunk) => data += chunk);
// 		message.on("end", () => {
// 			let localHMAC = crypto
// 				.createHmac("sha256", validateHostNameChallenge)
// 				.update(nonce)
// 				.digest()
// 				.toString("hex");
// 			if (localHMAC === data) {
// 				validatedHostNames.push(request.hostname);
// 				next();
// 			}
// 			else {
// 				console.error(`Got invalid HMAC when validating hostname: ${request.hostname}`);
// 			}
// 		});
// 	};
// 	const onError = (err: Error) => {
// 		console.error(`Error when validating hostname: ${request.hostname}`, err);
// 	};
// 	const link = createLink(request, `/auth/validatehost/${nonce}`);
// 	if (request.protocol === "http") {
// 		http.get(link, callback).on("error", onError);
// 	}
// 	else {
// 		https.get(link, callback).on("error", onError);
// 	}
// }

export function validateHostCallback(
	request: express.Request,
	response: express.Response,
) {
	const nonce: string = request.params.nonce || "";
	const message = crypto.createHmac("sha256", validateHostNameChallenge)
		.update(nonce)
		.digest()
		.toString("hex");
	response.send(message);
}
