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
	forward(opts: {
		path?: string;
		include?: string[];
		head?: string;
	}) {
		const findBody = (query: string, nodes: graphql.SelectionNode[]) => {
			let field;

			if (opts.path) {
				const components = opts.path.split(".");
				let found = true;

				while (components.length > 0 && found) {
					found = false;
					for (let node of nodes) {
						if (node.kind === "Field"
							&& node.name.value === components[0]
						   ) {
							if (node.selectionSet) {
								found = true;
								if (components.length === 1) {
									field = node;
								}
								components.shift();
								nodes = node.selectionSet.selections;
							}
						}
					}
				}
			}
			else {
				field = nodes.find(f => f.kind === "Field") as graphql.FieldNode;
			}

			if (!field || !field.selectionSet || !field.selectionSet.loc) {
				return null;
			}

			return query.slice(field.selectionSet.loc.start, field.selectionSet.loc.end);
		};

		const augmentBody = (body: string) => {
			if (opts.include) {
				return body.replace(/\s*?\{/, "$& " + opts.include.join(" ") + " ");
			}
			return body;
		}

		const pathToObject = (components: string[], item: any) => {
			const reduced: any = {};
			components.reduce((obj, component, i) => {
				if (i + 1 === components.length) {
					obj[component] = item;
				}
				else {
					obj[component] = {};
				}
				return obj[component];
			}, reduced);
			return reduced;
		};

		const findHead = (query: string, head: graphql.SelectionNode) => {
			if (opts.head) {
				return opts.head;
			}
			else if (head.kind === "Field" && head.loc
					 && head.selectionSet && head.selectionSet.loc
					) {
				return query.slice(head.loc.start, head.selectionSet.loc.start);
			}
			else if (head.kind === "Field" && head.loc) {
				return query.slice(head.loc.start, head.loc.end);
			}
			else {
				throw new Error(`Cannot find location info on root: ${JSON.stringify(head)}.`);
			}
		};

		const inner_forward = async (
			prev: any, args: any, req: express.Request, schema: graphql.GraphQLResolveInfo
		) => {
			if (schema.fieldNodes.length > 1) {
				console.warn("More than one field node");
				console.warn(JSON.stringify(schema));
			}
			const query = req.body.query;
			if (!query) {
				console.warn("No query detected for schema " + JSON.stringify(schema));
				return null;
			}

			let body = findBody(query, schema.fieldNodes);
			if (!body && opts.path) {
				// NOTE: __typename is always a valid query
				body = "{ __typename }";
			}
			if (!body) {
				body = "";
			}
			body = augmentBody(body);
			const head = findHead(query, schema.fieldNodes[0]);
			const todo = `${head} ${body}`;

			const result: {[key: string]: any} = await this.query(`{ ${todo} }`);
			const data = result[Object.keys(result)[0]];

			if (opts.path) {
				const components = opts.path.split(".");
				components.shift();

				if (data instanceof Array) {
					return data.map((item: any) => {
						return pathToObject(components, item);
					});
				}
				else {
					return pathToObject(components, data);
				}
			}
			else {
				return data;
			}
		};
		return inner_forward;
	}
}
