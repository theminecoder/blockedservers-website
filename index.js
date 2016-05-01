var crypto = require('crypto'),
	http = require('http'),
	path = require('path'),
	jethro = require('jethro'),
	bodyParser = require('body-parser'),
	express = require('express'),
	app = express(),
	mongoose = require('mongoose');
	
function log(severity, message, service) {
    if(!service) service = "app";
    jethro(severity, service, message);
}

function sha1(str) {
	return crypto.createHash('sha1').update(str).digest('hex');
}

var Server = mongoose.model('Server', {
		_id: String,
		hostname: String,
		currentlyBlocked: Boolean,
		lastBlocked: Date
	}),
	IPHash = mongoose.model('IPHash', {
		_id: String,
		hostname: String
	});
	
app.use(jethro.express);
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, 'public')));

app.get('/check', function(req, res) {
	res.json({
		success: false,
		message: "Missing query!"
	}).status(500).end();
});

app.get('/check/:query', function(req, res) {
	if(!/^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3})$|^((([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9]))$/.test(req.params.query.toLowerCase())) {
		res.json({
			success: false,
			message: "Invalid query!"
		}).status(500).end();
		return;
	}
	new IPHash({
		_id: sha1(req.params.query.toLowerCase()),
		hostname: req.params.query.toLowerCase()
	}).save();
	Server.findOne({_id: sha1(req.params.query.toLowerCase())}, function(err, server) {
		if(err) {
			res.json({
				success: false,
				message: "Database error!"
			}).status(500).end();
			log('error', err, "mongoose");
			return;
		}
		if(server==null) {
			res.json({
				success: true,
				blocked: false,
				lastBlocked: null
			}).end()
		} else {
			if(server.hostname==null) {
				server.hostname = req.params.query.toLowerCase();
				server.save();
			}
			res.json({
				success: true,
				blocked: server.currentlyBlocked,
				lastBlocked: server.lastBlocked
			}).end();
		}
	});
});

mongoose.connect(process.env.MONGO_URL||'mongodb://localhost/test', function(err){
	if(err) {
		console.log(err);
		process.exit(1);
	}
});
var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {
	http.createServer(app).listen(process.env.PORT||3000, process.env.HOST||"0.0.0.0")
	log("debug", "Spawned Express on "+(process.env.HOST||"0.0.0.0")+":"+(process.env.PORT||3000), "express");
});
