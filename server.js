// server.js
const path        = require('path');
const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI;
if (!uri) {
	console.error('❌ missing MONGO_URI');
	process.exit(1);
}

async function start() {
	const client = new MongoClient(uri);
	await client.connect();
	console.log('✅ Connected to MongoDB');

	const db   = client.db('myClickerApp');
	const coll = db.collection('bosses');

	// Ensure our boss doc exists
	await coll.updateOne(
		{ _id: 'slugBoss' },
		{ $setOnInsert: { name: 'Slug', maxHP: 10, currentHP: 10 } },
		{ upsert: true }
	);

	const app = express();
	app.use(express.static(path.join(__dirname, 'public')));
	app.get('/', (req, res) =>
		res.sendFile(path.join(__dirname, 'public', 'index.html'))
	);

	const server = http.createServer(app);
	const io     = new Server(server);

	io.on('connection', socket => {
		console.log(`🟢 ${socket.id} connected`);

		// Send the latest boss state
		coll.findOne({ _id: 'slugBoss' })
			.then(doc => socket.emit('boss state', doc))
			.catch(console.error);

		// Handle “hit” events
		socket.on('hit', async () => {
			// Atomically decrement currentHP, but don’t go below 0
			const { value } = await coll.findOneAndUpdate(
				{ _id: 'slugBoss', currentHP: { $gt: 0 } },
				{ $inc: { currentHP: -1 } },
				{ returnDocument: 'after' }
			);

			// If we just killed the boss, reset it
			if (value.currentHP <= 0) {
				await coll.updateOne(
					{ _id: 'slugBoss' },
					{ $set: { currentHP: value.maxHP } }
				);
				value.currentHP = value.maxHP;
			}

			// Broadcast the new state to everyone
			io.emit('boss state', value);
		});
	});

	const PORT = process.env.PORT || 3000;
	server.listen(PORT, () => console.log(`🚀 Listening on ${PORT}`));
}

start().catch(err => {
	console.error(err);
	process.exit(1);
});
