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
		hostnameFound: Boolean,
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
	res.status(400).json({
		success: false,
		message: "Missing query!"
	}).end();
});

app.get('/check/:query', function(req, res) {
	if(!/^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3})$|^((([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9]))$/.test(req.params.query.toLowerCase())) {
		res.status(400).json({
			success: false,
			message: "Invalid query!"
		}).end();
		return;
	}
	var ipSplit = req.params.query.toLowerCase().split(".");
	var isIp = ipSplit.length == 4;
	var smallIp;
	if(isIp) {
		ipSplit.map(function(part) {
			try {
				new Number(part);
			} catch (ex) {
				isIp = false;
			}
		});
	}
	if(!isIp && ipSplit.length>=2) {
		smallIp = ipSplit[ipSplit.length-2]+"."+ipSplit[ipSplit.length-1];
	}
	new IPHash({
		_id: sha1(req.params.query.toLowerCase()),
		hostname: req.params.query.toLowerCase()
	}).save();
	if(smallIp) {
		new IPHash({
			_id: sha1(smallIp.toLowerCase()),
			hostname: smallIp.toLowerCase()
		}).save();
	}
	Server.findOne((smallIp ? {_id: sha1(req.params.query.toLowerCase())} : {$or: [{_id: sha1(req.params.query.toLowerCase())}, {_id: sha1(smallIp)}]}), function(err, server) {
		if(err) {
			res.status(500).json({
				success: false,
				message: "Database error!"
			}).end();
			log('error', err, "mongoose");
			return;
		}
		if(server===null) {
			res.json({
				success: true,
				blocked: false,
				lastBlocked: null
			}).end();
		} else {
			if(server.hostname===null) {
				server.hostname = req.params.query.toLowerCase();
				server.hostnameFound = true;
				server.save();
			}
			res.status(200).json({
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
	http.createServer(app).listen(process.env.PORT||3000, process.env.HOST||"0.0.0.0");
	log("debug", "Spawned Express on "+(process.env.HOST||"0.0.0.0")+":"+(process.env.PORT||3000), "express");
});
