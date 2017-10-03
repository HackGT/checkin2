import * as fs from "fs";
import * as path from "path";

import * as bodyParser from "body-parser";
import * as express from "express";
import { graphqlExpress, graphiqlExpress } from "graphql-server-express";
import { makeExecutableSchema } from "graphql-tools";
import { Attendee, Tag } from "./schema";
import { authenticateWithRedirect, authenticateWithReject } from "./middleware";
import { schema as types } from "./graphql.types";
import { Registration } from "./inputs/registration";

const typeDefs = fs.readFileSync(path.resolve(__dirname, "../api.graphql"), "utf8");

type Ctx = express.Request;

interface IResolver {
	Query: types.Query<Ctx>;
	UserAndTags: {
		tags: types.GraphqlField<{}, types.TagState<Ctx>[], Ctx>;
		user: types.GraphqlField<{}, types.UserInfo<Ctx>, Ctx>;
	};
	Mutation: types.Mutation<Ctx>;
}

/**
 * GraphQL API
 */
function resolver(registration: Registration): IResolver {
	return {
		Query: {
			/**
			 * Get a list of unique tags currently available to set.
			 */
			tags: async (prev, args, ctx) => {
				return Tag.find();
			},
			/**
			 * Retrieve user through a user ID or through the token passed to
			 * Query. Leave id empty if you'd like to view the currently logged in
			 * user.
			 */
			user: registration.forward<types.UserAndTags<Ctx>>({
				path: "user.user",
				include: ["id"]
			}),
			/**
			 * Search through a user's name and email through regex
			 */
			search_user: registration.forward<types.UserAndTags<Ctx>[]>({
				path: "search_user.user",
				include: ["id"]
			}),
			/**
			 * All possible question branches
			 */
			question_branches: registration.forward<string[]>({}),
			/**
			 * All possible question names, or names of question in a branch
			 */
			question_names: registration.forward<string[] | undefined>({})
		},
		UserAndTags: {
			user: (prev, args, ctx) => {
				return prev.user;
			},
			/**
			 * Tags associated with a user
			 */
			tags: async (prev, args, ctx) => {
				// TODO: index users by registration's ID or create a UUID field
				if (prev.tags) {
					return prev.tags;
				}

				const attendee = await Attendee.findOne({
					id: prev.user.id
				});
				if (!attendee) {
					return [];
				}
				return Object.keys(attendee.tags).map(tag => {
					return {
						tag: {
							name: tag
						},
						checked_in: attendee.tags[tag].checked_in
					};
				});
			}
		},
		Mutation: {
			/**
			 * Check-in a user by specifying the tag name
			 */
			check_in: async (prev, args, ctx, schema) => {
				// Return none if tag doesn't exist
				if (!(await Tag.findOne({ name: args.tag }))) {
					return null as any;
				}

                let attendee = await Attendee.findOne({
                    id: args.user
                });

                if (!schema) {
                	return null as any;
                }

                let userInfo = await (registration.forward<types.UserAndTags<Ctx>>({
                    path: "check_in.user",
                    include: ["id"],
                    head: `user(id: "${args.user}")`
                }))(prev, args, ctx, schema);

                // Create attendee if it doesn't already exist
                if (!attendee) {
                    attendee = new Attendee({
                        id: args.user, 
                        name: userInfo.user.name,
                        emails: userInfo.user.email,
                        tags: {}
                    });
                }
                attendee.tags[args.tag] = {
                    checked_in: true,
                    checked_in_date: new Date()
                }
                attendee.markModified('tags');
                await attendee.save();

                return userInfo;
			},
			/**
			 * Check-out a user by specifying the tag name
			 */
			check_out: async (prev, args, ctx) => {
				return null as any; // TODO: Implement
			}
		}
	};
}

/**
 * Routes
 */
export function setupRoutes(app: express.Express, registration: Registration) {
	const schema = makeExecutableSchema({
		typeDefs,
		// XXX: The types are javascript equivalent, but unreachable from the graphql-tools library
		resolvers: resolver(registration) as any
	});

	// Set up graphql and graphiql routes
	app.use(
		"/graphql",
		bodyParser.json(),
		authenticateWithReject,
		(request, response, next) => {
			graphqlExpress({
				schema,
				context: request
			})(request, response, next);
		}
	);
	app.use(
		"/graphiql",
		authenticateWithRedirect,
		graphiqlExpress({
			endpointURL: "/graphql"
		})
	);
}
