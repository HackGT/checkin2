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

export interface ITagDetailItem {
	checked_in: boolean;
	checked_in_date: Date;
	checked_in_by: string;
	checkin_success: boolean;
}

export interface ITagItem {
	checkin_success: boolean;
	checked_in: boolean;
	checked_in_date?: Date;
	checked_in_by?: string;
	details: ITagDetailItem[];
}

export interface ITags {
	[key: string]: ITagItem;
}

export interface IAttendee {
	id: string;
	name?: string;
	emails: string[];
	tags: ITags;
}
export type IAttendeeMongoose = IAttendee & mongoose.Document;

export const Attendee = mongoose.model<IAttendeeMongoose>("Attendee", new mongoose.Schema({
	id: {
		type: String,
		required: true,
		unique: true
	},
	name: {
		type: String
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
export interface ITag {
	name: string;
	start?: Date;
	end?: Date;
	warnOnDuplicates: Boolean;
}

export type ITagMongoose = ITag & mongoose.Document;

export const Tag = mongoose.model<ITagMongoose>("Tag", new mongoose.Schema({
	name: {
		type: String,
		required: true,
		unique: true
	},
	start: {
		type: Date
	},
	end: {
		type: Date
	},
	warnOnDuplicates: {
		type: Boolean,
		required: true,
		default: false
	}
}));