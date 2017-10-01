import * as mongoose from "mongoose";

export interface IUser {
	username: string;
	login: {
		hash: string;
		salt: string;
	};
	auth_keys: string[];
}
export type IUserMongoose = IUser & mongoose.Document;

export const User = mongoose.model<IUserMongoose>("User", new mongoose.Schema({
	username: {
		type: String,
		required: true,
		unique: true
	},
	login: {
		hash: {
			type: String,
			required: true,
		},
		salt: {
			type: String,
			required: true,
		}
	},
	auth_keys: [String]
}));

export interface ITagItem {
	checked_in: boolean;
	checked_in_date?: Date;
	checked_in_by?: string;
}

export interface ITags {
	[key: string]: ITagItem;
}

export interface IAttendee {
	id: string;
	name: string;
	emails: string[];
	tags: ITags;
}
export type IAttendeeMongoose = IAttendee & mongoose.Document;

export const Attendee = mongoose.model<IAttendeeMongoose>("Attendee", new mongoose.Schema({
	id: {
		type: String,
		required: true,
		//unique: true
	},
	name: {
		type: String,
		required: true,
		//unique: true
	},
	emails: {
		type: [String],
		required: true
	},
	tags: {
		type: mongoose.Schema.Types.Mixed,
		required: true
	}
}));

// Master list of available tags
export interface ITagsList {
	tags: string[]
}

export type ITagsListMongoose = ITagsList & mongoose.Document;

export const TagsList = mongoose.model<ITagsListMongoose>("TagsList", new mongoose.Schema({
	tags: {
		type: [String],
		required: true
	}
}));