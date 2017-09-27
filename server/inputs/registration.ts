/// <reference path="../../apis/registration.d.ts" />
import * as qwest from "qwest";

export class Registration {
	uri: string;

	constructor(uri: string) {
		this.uri = uri;
	}

	async user(id: string, selection_set: string[]) {
		const vars = selection_set.map((_, i) => `$select_${i}`).join(" ");
		const var_map: {[selection: string]: string} = {};

		selection_set.forEach((selection, i, _) => {
			var_map[`$select_${i}`] = selection;
		}, {});

		const result = await this.query(`{
			user(id: $id) {
				${vars}
			}
		}`, var_map);
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

	async query(query: string, variables?: { [name: string]: string }): Promise<GQL.IQuery> {
		const response: GQL.IGraphQLResponseRoot = await qwest.post(this.uri, {
			query,
			variables: variables || {}
		});
		if (response.data) {
			return response.data;
		}
		else {
			throw new Error(JSON.stringify(response.errors));
		}
	}
}
