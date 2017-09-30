/// <reference path="../../apis/registration.d.ts" />
import * as request from "request-promise-native";
import * as express from "express";
import * as graphql from "graphql";

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
		const vars = selection_set.join(' ');

		const result = await this.query(`{
			user(id: "${id}") {
				${vars}
			}
		}`);
		return result.user;
	}

	async question_branches() {
		return (await this.query(`{ question_branches }`)).question_branches;
	}

	async question_names(branch?: string) {
		let result;
		if (branch) {
			result = await this.query(`query Branch($branch: String!) {
				question_names(branch: $branch)
			}`, {
				branch
			});
		}
		else {
			result = await this.query(`{ question_names }`);
		}
		return result.question_names;
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

	/**
	 * Utility
	 */
	forward<Q>(child?: string, appendId = true): Q {
		const findChild = (queue: graphql.SelectionNode[]) => {
			while (queue.length > 0) {
				const field = queue.pop();
				if (field && field.kind === "Field") {
					if (field.name.value === child) {
						return field;
					}
					if (field.selectionSet) {
						queue.unshift(...field.selectionSet.selections);
					}
				}
			}
			return false;
		};
		const stichChild = (query: string, root: graphql.FieldNode, found: graphql.FieldNode) => {
			if (!found.loc) {
				throw new Error(`Cannot find location info on ${child}.`);
			}
			if (!found.selectionSet) {
				return query.slice(found.loc.start, found.loc.end);
			}
			if (!root.selectionSet || !found.selectionSet || !found.selectionSet.loc
				|| !root.loc || !root.selectionSet.loc)
			{
				throw new Error(`Cannot find location info on root or found selection.`);
			}
			const head = query.slice(root.loc.start, root.selectionSet.loc.start);
			const select = query.slice(found.selectionSet.loc.start, found.selectionSet.loc.end);
			return `${head} ${select}`;
		};

		const inner_forward = async (
			prev: {}, args: {}, req: express.Request, schema: graphql.GraphQLResolveInfo
		) => {
			if (schema.fieldNodes.length > 1) {
				console.warn("More than one field node");
				console.warn(JSON.stringify(schema));
			}
			const field = schema.fieldNodes[0];
			const selections = (field && field.selectionSet && field.selectionSet.selections) || [];
			const query = req.body.query;

			let todo;
			if (child) {
				const found = findChild(selections.slice());
				if (!found) {
					throw new Error(`Cannot find child selection ${child}.`);
				}
				todo = stichChild(query, field, found);
			}
			else {
				if (!field.loc) {
					console.error(child, JSON.stringify(schema));
					throw new Error("No location info on field.");
				}
				todo = query.slice(field.loc.start, field.loc.end);
			}

			const result: {[key: string]: any} = await this.query(`{ ${todo} }`);

			if (child && result[schema.fieldName] instanceof Array) {
				return result[schema.fieldName].map((item: any) => {
					return {
						[child]: item,
					};
				});
			}
			else if (child) {
				return {
					[child]: (result as {[key: string]: any})[child],
				};
			}
			else {
				return result[schema.fieldName];
			}
		};
		return inner_forward as any as Q;
	}
}
