import * as express from "express";
import * as compression from "compression";
import * as mongoose from "mongoose";
//let Q = require("q");

let app = express();
app.use(compression());

const PORT = 3000;
const DATABASE = "test";
mongoose.connect(`mongodb://localhost/${DATABASE}`);

const Attendee = mongoose.model("Attendee", new mongoose.Schema({
	name: String,
	email: String,
	checked_in: Boolean,
	date: { type: Date, default: Date.now }
}));

app.post("/addattendee", function (req, res) {
	let attendee = new Attendee({
		name: req.param("name"),
		email: req.param("email"),
		checked_in: false
	});
	return Q.ninvoke(attendee, "save").catch(function(err) {
		console.err(err)
	});
});


app.post("/checkin", function (req, res) {
	Attendee.
	findOne({ email: req.param("email") }).
	select("name email").
	exec().then(function(err, hacker) {
		// TODO: handle error better
		if (err) return res.sendStatus(404);
		return res.send(JSON.stringify(hacker))
	}).catch(function(err) {
		return res.sendStatus(500);
	});
})

app.get("/", function (req, res) {
	// TODO: implement UI
  	res.send("Hello World!");
});

app.listen(PORT, function () {
	console.log(`Check in system started on port ${PORT}`);
});