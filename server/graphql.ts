import * as fs from "fs";
import * as path from "path";

import * as bodyParser from "body-parser";
import * as express from "express";
import { graphqlExpress, graphiqlExpress } from "graphql-server-express";
import { makeExecutableSchema } from "graphql-tools";
import { PubSub } from "graphql-subscriptions";
import { Attendee, Tag } from "./schema";
import { authenticateWithRedirect, authenticateWithReject } from "./middleware";
import { schema as types } from "./graphql.types";
import { Registration } from "./inputs/registration";

const typeDefs = fs.readFileSync(path.resolve(__dirname, "../api.graphql"), "utf8");

const pubsub = new PubSub();

export enum Events {
	TAG_CHANGE
}

type Ctx = express.Request;

interface ISubscription<Args> {
	subscribe: types.GraphqlField<Args, AsyncIterator<any>, Ctx>;
}

interface IResolver {
	Query: types.Query<Ctx>;
	UserAndTags: {
		tags: types.GraphqlField<{}, types.TagState<Ctx>[], Ctx>;
		user: types.GraphqlField<{}, types.UserInfo<Ctx>, Ctx>;
	};
	Mutation: types.Mutation<Ctx>;
	Subscription: {
		tag_change: ISubscription<undefined>;
	}
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
			user: registration.forward<types.UserAndTags<Ctx>>("user"),
			/**
			 * Search through a user's name and email through regex
			 */
			search_user: registration.forward<types.UserAndTags<Ctx>[]>("user"),
			/**
			 * All possible question branches
			 */
			question_branches: registration.forward<string[]>(),
			/**
			 * All possible question names, or names of question in a branch
			 */
			question_names: registration.forward<string[] | undefined>()
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
				// TODO: change `forward` to always query for the ID
				const attendee = await Attendee.findOne({
					id: prev.id
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
			check_in: async (prev, args, ctx) => {
				return null as any; // TODO: Implement
			},
			/**
			 * Check-out a user by specifying the tag name
			 */
			check_out: async (prev, args, ctx) => {
				return null as any; // TODO: Implement
			}
		},
		Subscription: {
			tag_change: {
				subscribe: () => {
					return pubsub.asyncIterator(Events[Events.TAG_CHANGE]);
				}
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
