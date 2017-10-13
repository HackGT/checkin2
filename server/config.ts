export interface IConfig {
	server: {
		port: number;
		mongo: string;
		production: boolean;
	},
	inputs: {
		registration: string;
	},
	app: {
		default_admin: {
			username: string;
			password: string;
		}
	}
	secrets: {
		adminKey: string;
	}
}

export const config: IConfig = {
	server: {
		port: envOrDefaultMap("PORT", 3000, parseInt),
		mongo: envOrDefault("MONGO_URL", "mongodb://localhost/checkin"),
		production: envOrDefault("PRODUCTION", "false").toLowerCase() === "true",
	},
	inputs: {
		registration: envOrDefault("REGISTRATION_GRAPHQL", "https://registration.dev.hack.gt/graphql")
	},
	app: {
		default_admin: {
			username: envOrDefault("DEFAULT_ADMIN_USER", "admin"),
			password: envOrDefault("DEFAULT_ADMIN_PASS", "admin"),
		}
	},
	secrets: {
		adminKey: env("ADMIN_KEY_SECRET")
	}
};

function env(name: string): string {
	if (!process.env[name]) {
		throw new Error(`Env var ${name} must be set.`);
	}
	return process.env[name]!;
}

function envOrDefault(env: string, or: string): string {
	return process.env[env] ? process.env[env]! : or;
}

function envOrDefaultMap<V>(env: string, or: V, map: (a: string) => V): V {
	return process.env[env] ? map(process.env[env]!) : or;
}
