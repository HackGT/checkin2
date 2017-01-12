var express = require('express');
var app = express();
var mongoose = require('mongoose');
mongoose.connect('mongodb://localhost/test');
var Q = require('q');

var Attendee = mongoose.model('Attendee', {
	name: String,
	email: String,
	checked_in: Boolean,
	date: { type: Date, default: Date.now }
});

app.post('/addattendee', function (req, res) {
	var attendee = new Attendee({
		name: req.param('name'),
		email: req.param('email'),
		checked_in: false
	});
	return Q.ninvoke(attendee, "save").catch(function(err) {
		console.err(err)
	});
});


app.post('/checkin', function (req, res) {
	Attendee.
	findOne({ email: req.param('email') }).
	select('name email').
	exec().then(function(err, hacker) {
		// TODO: handle error better
		if (err) return res.sendStatus(404);
		return res.send(JSON.stringify(hacker))
	}).catch(function(err) {
		return res.sendStatus(500);
	});
})

app.get('/', function (req, res) {
	// TODO: implement UI
  	res.send('Hello World!');
});

app.listen(3000, function () {
  console.log('Checkin system started on port 3000');
});