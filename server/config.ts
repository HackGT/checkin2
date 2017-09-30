export interface IConfig {
	server: {
		port: number;
		mongo: string;
	},
	secrets: {
		adminKey: string;
	}
}

export const config: IConfig = {
	server: {
		port: envOrDefault("PORT", 3000, parseInt),
		mongo: envOrDefault("MONGO_URL", "mongodb://localhost/checkin")
	},
	secrets: {
		adminKey: env("ADMIN_KEY_SECRET")
	}
};

function env(name: string): string {
	if (!process.env[name]) {
		throw new Error(`Env var ${name} must be set.`);
	}
	return process.env[name];
}

function envOrDefault<V>(env: string, or: V, map?: (a: string) => V): V {
	if (process.env[env] && map) {
		return map(process.env[env]);
	}
	return process.env[env] || or;
}
