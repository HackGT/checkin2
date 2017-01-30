import * as mongoose from "mongoose";

export interface IUser {
	username: string;
	login: {
		hash: string;
		salt: string;
	};
	auth_keys: string[];
}
export interface IUserMongoose extends IUser, mongoose.Document {}

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

export interface IAttendee {
	id: string;
	tag: string;
	name: string;
	emails: string[];
	checked_in: boolean;
	checked_in_date?: Date;
	checked_in_by?: string;
}
export interface IAttendeeMongoose extends IAttendee, mongoose.Document {}

export const Attendee = mongoose.model<IAttendeeMongoose>("Attendee", new mongoose.Schema({
	id: {
		type: String,
		required: true,
		unique: true
	},
	tag: {
		type: String,
		required: true
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
	checked_in: {
		type: Boolean,
		required: true,
	},
	checked_in_date: {
		type: Date
	},
	checked_in_by: {
		type: String
	}
}));