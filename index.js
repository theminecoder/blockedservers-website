const crypto = require('crypto'),
    http = require('http'),
    path = require('path'),
    jethro = require('jethro'),
    bodyParser = require('body-parser'),
    express = require('express'),
    app = express(),
    mongoose = require('mongoose');

function log(severity, message, service) {
    if (!service) service = "app";
    jethro(severity, service, message);
}

function sha1(str) {
    return crypto.createHash('sha1').update(str).digest('hex');
}

const Server = mongoose.model('Server', {
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

app.get('/count', function (req, res) {
    IPHash.count({}, function (err, count) {
        if (err) {
            res.status(500).json({
                success: false,
                message: "Database error!"
            }).end();
            log('error', err, "mongoose");
        }

        res.status(200).json({
            success: true,
            count: count
        }).end();
    })
});

app.get('/check', function (req, res) {
    res.status(400).json({
        success: false,
        message: "Missing query!"
    }).end();
});

function validateQuery(server) {
    if (!/^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3})$|^((([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9]))$/.test(server.toLowerCase())) {
        return {
            success: false,
            message: "Invalid query!"
        }
    }
    return null;
}

async function doCheck(server) {
    const validation = validateQuery(server);
    if (validation) {
        return validation;
    }

    const ipSplit = server.toLowerCase().split(".");
    let isIp = ipSplit.length === 4;
    let smallIp, starIp;
    let otherStars = [];
    if (isIp) {
        ipSplit.map(function (part) {
            try {
                Number(part);
            } catch (ex) {
                isIp = false;
            }
        });
    }
    if (!isIp && ipSplit.length >= 2) {
        smallIp = ipSplit[ipSplit.length - 2] + "." + ipSplit[ipSplit.length - 1];
        starIp = "*." + ipSplit[ipSplit.length - 2] + "." + ipSplit[ipSplit.length - 1];
        while (ipSplit.length > 3) {
            ipSplit[0] = "*";
            otherStars.push(ipSplit.join("."))
            ipSplit.shift()
        }
    }
    await IPHash.findOneAndUpdate({
        _id: sha1(server.toLowerCase())
    }, {
        hostname: server.toLowerCase()
    }, {upsert: true});
    if (smallIp != null) {
        await IPHash.findOneAndUpdate({
            _id: sha1(smallIp.toLowerCase())
        }, {
            hostname: smallIp.toLowerCase()
        }, {upsert: true});
        await IPHash.findOneAndUpdate({
            _id: sha1(starIp.toLowerCase())
        }, {
            hostname: starIp.toLowerCase()
        }, {upsert: true});
        await Promise.all(otherStars.map(async function (star) {
            await IPHash.findOneAndUpdate({
                _id: sha1(star.toLowerCase())
            }, {
                hostname: star.toLowerCase()
            }, {upsert: true});
        }));
    }
    const query = (smallIp == null ? {_id: sha1(server.toLowerCase())} : {$or: [{_id: sha1(server.toLowerCase())}, {_id: sha1(smallIp)}, {_id: sha1(starIp)}]});
    const serverDoc = await Server.findOne(query)
    if (serverDoc === null) {
        return {
            success: true,
            blocked: false,
            lastBlocked: null
        }
    }

    if (serverDoc.hostname == null) {
        const hashDoc = IPHash.find({_id: serverDoc._id})
        console.log(hashDoc);
        serverDoc.hostname = (hashDoc == null || hashDoc.hostname == null ? server.toLowerCase() : hashDoc.hostname);
        serverDoc.hostnameFound = true;
        await serverDoc.save();
    }

    return {
        success: true,
        blocked: serverDoc.currentlyBlocked,
        lastBlocked: serverDoc.lastBlocked
    }
}

async function doPing(server) {
    const validation = validateQuery(server);
    if (validation) {
        return validation;
    }
    return new Promise(resolve => {
        const mc = require('minecraft-protocol');
        const client = mc.createClient({
            host: server,
            username: "Dinnerbone", // some random exisiting account
            profilesFolder: false
        });
        // disconnect packet, assume we got kicked for not auth'd
        client.on('disconnect', (packet) => {
            client.end();
            resolve({
                success: true,
                offlineMode: false,
                reason: packet.reason
            });
        });
        // login success -> offline server
        client.on('success', (packet) => {
            client.end();
            resolve({
                success: true,
                offlineMode: true
            });
        });
        // error? -> error
        client.on('error', (error) => {
            resolve({
                success: false,
                error: error
            })
        });
        client.on('end', (error) => {
            resolve({
                success: false,
                error: error
            })
        });
    });
}

app.get('/check/:query', async function (req, res) {
    res.json(await doCheck(req.params.query))
});

app.post('/check-bulk', async function (req, res) {
    res.json(await Promise.all(req.body.map(async server => {
        return {input: server, result: await doCheck(server)};
    })))
})

app.get('/ping/:query', async function (req, res) {
    res.json(await doPing(req.params.query))
});

mongoose.connect(process.env.MONGO_URL || 'mongodb://localhost/test', function (err) {
    if (err) {
        console.log(err);
        process.exit(1);
    }
});
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function () {
    http.createServer(app).listen(process.env.PORT || 3000, process.env.HOST || "0.0.0.0");
    log("debug", "Spawned Express on " + (process.env.HOST || "0.0.0.0") + ":" + (process.env.PORT || 3000), "express");
});
