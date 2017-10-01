/// <reference path="../../apis/registration.d.ts" />
import * as request from "request-promise-native";

interface IRegistrationOpts {
	url: string;
	key: string;
}

export class Registration {
	url: string;
	key: string;

	constructor(opts: IRegistrationOpts) {
		this.url = opts.url;
		this.key = new Buffer(opts.key).toString("base64");
	}

	async user(id: string, selection_set: string[]) {
		let vars: string = selection_set.join(' ');

		const result = await this.query(`{
			user(id: "${id}") {
				${vars}
			}
		}`);
		return result.user;
	}
	
	async question_branches() {
		const result = await this.query(`{ question_branches }`);
		return result.question_branches;
	}

	async question_names(branch?: string) {
		let result;
		if (branch) {
			result = await this.query(`{
				question_names(branch: $branch)
			}`, {
				branch
			});
		}
		else {
			result = await this.query(`{ question_names }`);
		}
	}

	async searchUsers(query: string) {
		let result; 
		query = query.trim()

		if (query.length > 0) {
			result = await this.query(`{
				search(search: $query, n: 25, offset: 0) {
					id
					name
					email
				}
			}`)
			return result.search_user;
		} else {
			// Empty query will return all users
			result = await this.query(`{ 
				users(n: 25) {
					id
					name
					email
				}
			}`);
			return result.users;
		}
	}

	async query(query: string, variables?: { [name: string]: string }): Promise<GQL.IQuery> {
		const response: GQL.IGraphQLResponseRoot = await request({
			uri: this.url,
			method: "POST",
			json: true,
			headers: {
				Authorization: `Basic ${this.key}`
			},
			body: {
				query,
				variables: variables || {}
			}
		});
		if (response.data) {
			return response.data;
		}
		else {
			throw new Error(JSON.stringify(response.errors));
		}
	}
}
