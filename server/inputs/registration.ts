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
		const reduceSelections = <M>(
			field: graphql.FieldNode | undefined,
			schema: graphql.GraphQLResolveInfo,
			memo: M,
			f: (obj: M, node: graphql.SelectionNode) => M
		): M => {
			if (!field || !field.selectionSet) {
				return memo;
			}
			const nodes: graphql.SelectionNode[] = [field];
			nodes.push(...field.selectionSet.selections);

			for (let node of nodes) {
				memo = f(memo, node);
				if (node.kind === "FragmentSpread") {
					const fragment = schema.fragments[node.name.value].selectionSet;
					if (fragment) {
						nodes.push(...fragment.selections);
					}

				}
				else if (node.kind === "Field" && node.selectionSet) {
					nodes.push(...node.selectionSet.selections);
				}
			}

			return memo;
		}

		const findBody = (
			query: string,
			nodes: graphql.SelectionNode[],
			schema: graphql.GraphQLResolveInfo
		): {
			query?: string;
			field?: graphql.FieldNode;
		} => {
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
						else if (node.kind === "FragmentSpread") {
							const fragment = schema.fragments[node.name.value].selectionSet;
							if (fragment) {
								nodes.push(...fragment.selections);
							}
						}
					}
				}
			}
			else {
				field = nodes.find(f => f.kind === "Field") as graphql.FieldNode;
			}

			if (!field || !field.selectionSet || !field.selectionSet.loc) {
				return {};
			}

			return {
				query: query.slice(field.selectionSet.loc.start, field.selectionSet.loc.end),
				field
			};
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

		const findUsedFragments = (
			field: graphql.FieldNode | undefined,
			schema: graphql.GraphQLResolveInfo
		) => {
			return reduceSelections(field, schema, new Set(), (obj, node) => {
				if (node.kind === "FragmentSpread") {
					obj.add(node.name.value);
				}
				return obj;
			});
		};

		const findUsedVariables = (
			head: graphql.FieldNode | undefined,
			field: graphql.FieldNode | undefined,
			schema: graphql.GraphQLResolveInfo
		) => {
			const used = new Set();
			const appendUsed = (obj: Set<string>, node: graphql.SelectionNode) => {
				if (node.kind === "Field" && node.arguments) {
					node.arguments.forEach(arg => {
						if (arg.value.kind === "Variable") {
							obj.add(arg.value.name.value);
						}
					})
				}
				return obj;
			};
			if (head) {
				appendUsed(used, head);
			}
			return reduceSelections(field, schema, used, appendUsed);
		};

		const findSignature = (
			query: string,
			usedVars: Set<string>,
			defs: graphql.VariableDefinitionNode[] | undefined,
			vals: {[name: string]: any}
		) => {
			const declaration = (defs || [])
				.filter(def => {
					// variables must be used to be included in signature
					return usedVars.has(def.variable.name.value);
				})
				.map(def => {
					if (def.loc) {
						return query.slice(def.loc.start, def.loc.end);
					}
					return false;
				})
				.filter(d => !!d)
				.join(", ");

			if (declaration.length === 0) {
				return "";
			}
			return `ForwardQuery(${declaration})`;
		};

		const findFragments = (
			query: string,
			fragments: {[name: string]: graphql.FragmentDefinitionNode},
			usedFragments: Set<string>
		) => {
			return Object.keys(fragments)
				.filter(name => usedFragments.has(name))
				.map(name => {
					const fragment = fragments[name];
					if (fragment.loc) {
						return query.slice(fragment.loc.start, fragment.loc.end);
					}
					return false;
				})
				.filter(d => !!d)
				.join("\n");
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

			const found = findBody(query, schema.fieldNodes.slice(), schema);
			let body = found.query;
			if (!body && opts.path) {
				// NOTE: __typename is always a valid query
				body = "{ __typename }";
			}
			if (!body) {
				body = "";
			}
			body = augmentBody(body);
			const head = findHead(query, schema.fieldNodes[0]);
			const headNode = opts.head ? undefined : schema.fieldNodes[0];
			const usedVars = findUsedVariables(headNode, found.field, schema);
			const signature = findSignature(query, usedVars, schema.operation.variableDefinitions, schema.variableValues);
			const usedFragments = findUsedFragments(found.field, schema);
			const fragments = findFragments(query, schema.fragments, usedFragments);
			const todo = `query ${signature} { ${head} ${body} }\n${fragments}`;

			const result: {[key: string]: any} = await this.query(todo, schema.variableValues);
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
