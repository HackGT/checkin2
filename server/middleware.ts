import * as express from "express";
import { config } from "./config";
import { User, IUser } from "./schema";

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

