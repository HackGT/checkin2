import * as fs from "fs";
import * as path from "path";

import * as bodyParser from "body-parser";
import * as express from "express";
import {graphiqlExpress, graphqlExpress} from "graphql-server-express";
import {makeExecutableSchema} from "graphql-tools";
import {Attendee, ITagDetailItem, ITagItem, Tag} from "./schema";
import {authenticateWithRedirect, authenticateWithReject, getLoggedInUser} from "./middleware";
import {schema as types} from "./graphql.types";
import {Registration} from "./inputs/registration";
import {printHackGTMetricsEvent} from "./app";
import {createLink} from "./util";
import {PubSub} from 'graphql-subscriptions';
import {GraphQLError} from "graphql";

const typeDefs = fs.readFileSync(path.resolve(__dirname, "../api.graphql"), "utf8");

export const pubsub = new PubSub();

type Ctx = express.Request;

interface ISubscription<Args> {
    subscribe: types.GraphqlField<Args, AsyncIterator<any>, Ctx>;
}

interface IResolver {
    Query: types.Query<Ctx>;
    UserAndTags: {
        tags: types.GraphqlField<{}, types.TagState<Ctx>[], Ctx>;
        user: types.GraphqlField<{}, types.User<Ctx>, Ctx>;
    };
    Mutation: types.Mutation<Ctx>;
    Subscription: {
        tag_change: ISubscription<undefined>;
    }
}

const TAG_CHANGE = "tag_change";


function validateCheckin(pastCheckins: ITagItem, checkIn: boolean): boolean {
    if (pastCheckins && pastCheckins.details) {
        if (pastCheckins.details.length === 0) {
            return checkIn; // if there are no prior check in/out events, then return false for check outs (can't check out if not checked in)
        } else {
            const details = pastCheckins.details[pastCheckins.details.length - 1]; // get the most recent check in/out event
            // This is a duplicate check in/out
            // Ends up being true when checkIn and details.checked_in are not the same (i.e., the old check in/out state
            //   does not match the new check in/out state)
            return checkIn != details.checked_in;
        }
    }
    return checkIn; // same logic as for above with pastCheckins.details.length === 0
}

function getLastSuccessfulCheckin(pastCheckins: ITagItem, checkIn: boolean): ITagDetailItem | null {
    if (!pastCheckins || !pastCheckins.details) {
        return null;
    }
    let {details} = pastCheckins; // ES6 destructuring, so this is equivalent to let details = pastCheckins.details

    for (let i = details.length - 1; i >= 0; i--) { // start at the end b/c later check-in/out events will be at the end of the array
        const event = details[i];
        if (event.checked_in === checkIn && event.checkin_success) {
            return event;
        }
    }

    return null;
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
                const curr = new Date();
                const query = args.only_current ? {
                    $and: [
                        {start: {$lte: curr}},
                        {end: {$gte: curr}}
                    ]
                } : {};
                const results = await Tag.find(query);

                return results.map(elem => ({
                    name: elem.name,
                    start: elem.start ? elem.start.toISOString() : "",
                    end: elem.end ? elem.end.toISOString() : "",
                }));
            },
            /**
             * Retrieve user through a user ID or through the token passed to
             * Query. Leave id empty if you'd like to view the currently logged in
             * user.
             */
            user: registration.forward({
                path: "user.user",
                include: ["id"]
            }),
            /**
             * All the users in the database, useful for polling for new user information.
             * This is paginated, n is the number of results, and pagination_token is the last ID
             * seen from the latest page retrieved, if you want the first page leave this out.
             */
            users: registration.forward({
                path: "users.user",
                include: ["id"]
            }),
            /**
             * Search through a user's name and email through regex
             */
            search_user_simple: registration.forward({
                path: "search_user_simple.user",
                include: ["id"]
            }),
            /**
             * All possible application question branches
             */
            application_branches: registration.forward({}),
            /**
             * All possible confirmation question branches
             */
            confirmation_branches: registration.forward({}),
            /**
             * All possible question branches
             */
            question_branches: registration.forward({}),
            /**
             * All possible question names, or names of question in a branch
             */
            question_names: registration.forward({}),
            /**
             * Counts of checked in users per tag
             */
            tag_counts: async (prev, args, ctx) => {
                const tagsQuery = args.tags ? {
                    "tags.k": {$in: args.tags}
                } : {};

                const counts = await Attendee.aggregate([
                    {
                        $project: {
                            tags: {
                                $objectToArray: "$tags"
                            }
                        }
                    },
                    {
                        $unwind: "$tags"
                    },
                    {
                        $match: {
                            "tags.v.checked_in": true,
                            ...tagsQuery
                        }
                    },
                    {
                        $group: {
                            _id: "$tags.k",
                            count: {
                                $sum: 1
                            }
                        }
                    }
                ]);

                return counts.map(elem => ({
                    name: elem._id,
                    count: elem.count
                }));
            }

        },
        UserAndTags: {
            user: (prev, args, ctx) => {
                return prev && prev.user;
            },
            /**
             * Tags associated with a user
             */
            tags: async (prev, args, ctx) => {
                // TODO: index users by registration's ID or create a UUID field
                if (prev.tags) {
                    return prev.tags;
                }
                // Registration API did not find a user.
                if (!prev || !prev.user || !prev.user.id) {
                    return [];
                }

                const attendee = await Attendee.findOne({
                    id: prev.user.id
                });
                // Checkin API did not find a user.
                if (!attendee) {
                    return [];
                }
                return Object.keys(attendee.tags).map(tag => {
                    const date = attendee.tags[tag].checked_in_date;
                    const lastSuccess = attendee.tags[tag].last_successful_checkin;

                    return {
                        tag: {
                            name: tag
                        },
                        checkin_success: (attendee.tags[tag].checkin_success == null)
                            ? true : attendee.tags[tag].checkin_success,
                        checked_in: attendee.tags[tag].checked_in,
                        checked_in_date: date ? date.toISOString() : "",
                        checked_in_by: attendee.tags[tag].checked_in_by || "",
                        last_successful_checkin: lastSuccess ? {
                            checked_in: lastSuccess.checked_in,
                            checked_in_date: lastSuccess.checked_in_date.toISOString(),
                            checked_in_by: lastSuccess.checked_in_by,
                            checkin_success: (lastSuccess.checkin_success == null) ? true : lastSuccess.checkin_success
                        } : null,
                        details: attendee.tags[tag].details.map((elem) => {
                            return {
                                checked_in: elem.checked_in,
                                checked_in_date: elem.checked_in_date.toISOString(),
                                checked_in_by: elem.checked_in_by,
                                checkin_success: (elem.checkin_success == null) ? true : elem.checkin_success
                            }
                        })
                    };
                });
            }
        },
        Mutation: {
            /**
             * Check in/out a user by specifying the tag name
             */
            check_in: async (prev, args, ctx, schema) => {
                // Return none if tag doesn't exist
                const tagDetails = await Tag.findOne({name: args.tag});
                if (!tagDetails || !schema) {
                    return null;
                }

                // If warnOnDuplicates is not set for this tag, set it to true (most restrictive option)
                // console.log here to better identify what's happening here in prod
                console.log("tagDetails.warnOnDuplicates", tagDetails.warnOnDuplicates);
                if (tagDetails.warnOnDuplicates == null) {
                    tagDetails.warnOnDuplicates = true;
                    await tagDetails.save();
                }

                let attendee = await Attendee.findOne({
                    id: args.user
                });

                const forwarder = registration.forward({
                    path: `check_in.user`,
                    include: [
                        "id",
                        "email",
                        "name"
                    ],
                    head: `user(id: "${args.user}")`
                });
                const userInfo = await forwarder(prev, args, ctx, schema);
                if (!userInfo.user) {
                    return null;
                }

                // Create attendee if it doesn't already exist
                if (!attendee) {
                    attendee = new Attendee({
                        id: args.user,
                        name: userInfo.user.name,
                        emails: userInfo.user.email,
                        tags: {}
                    });
                }
                const loggedInUser = await getLoggedInUser(ctx);
                const date = new Date();
                const username = loggedInUser.user ? loggedInUser.user.username : "";

                const pastCheckins = attendee.tags[args.tag];


                const validCheckin = validateCheckin(pastCheckins, args.checkin);
                let success = !tagDetails.warnOnDuplicates ? true : validCheckin;

                attendee.tags[args.tag] = {
                    checkin_success: success,
                    checked_in: args.checkin,
                    checked_in_date: date,
                    checked_in_by: username,
                    last_successful_checkin: null,
                    details: attendee.tags[args.tag] ? attendee.tags[args.tag].details : []
                };

                attendee.tags[args.tag].details.push({
                    checked_in: args.checkin,
                    checked_in_date: date,
                    checked_in_by: username,
                    checkin_success: success
                });

                // Make sure we include the latest details element for last_successful_checkin
                attendee.tags[args.tag].last_successful_checkin = getLastSuccessfulCheckin(attendee.tags[args.tag], args.checkin);

                attendee.markModified('tags');
                await attendee.save();

                pubsub.publish(TAG_CHANGE, {[TAG_CHANGE]: userInfo});

                // validCheckin indicates duplicate check in/out events regardless of warnOnDuplicates,
                //    which means we can still get accurate metrics for tags with warnOnDuplicates = false
                printHackGTMetricsEvent(args, userInfo, loggedInUser, args.checkin, validCheckin);
                return userInfo;
            },

            /**
             * Add tag
             */
            add_tag: async (prev, args, ctx, schema) => {
                // Return none if the tag already exists (prevent duplicates)
                if (await Tag.findOne({name: args.tag})) {
                    return null;
                }

                let tag = new Tag({name: args.tag});
                if (args.start) tag.start = new Date(args.start);
                if (args.end) tag.end = new Date(args.end);
                if (tag.start && tag.end && tag.start >= tag.end) {
                    throw new GraphQLError("Invalid dates: the tag's end date must be after its start date");
                }
                if (!tag.start && tag.end) {
                    throw new GraphQLError("If a tag has an end date defined, it must also have a start date defined");
                }
                if (tag.start && !tag.end) {
                    throw new GraphQLError("If a tag has a start date defined, it must also have an end date defined");
                }
                tag.warnOnDuplicates = args.warnOnDuplicates;
                await tag.save();

                return {
                    name: args.tag,
                    start: args.start ? args.start : "",
                    end: args.end ? args.end : "",
                    warnOnDuplicates: args.warnOnDuplicates
                };
            }
        },
        Subscription: {
            tag_change: {
                subscribe: () => pubsub.asyncIterator(TAG_CHANGE)
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
        (request, response, next) => {
            graphiqlExpress({
                endpointURL: "/graphql",
                subscriptionsEndpoint: createLink(request, "graphql", "ws")
            })(request, response, next);
        }
    );

    return schema;
}
