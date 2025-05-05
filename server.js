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

	// Ensure our boss document exists
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

		// Send the latest boss state on connect
		coll.findOne({ _id: 'slugBoss' })
			.then(doc => socket.emit('boss state', doc))
			.catch(err => console.error('Error fetching boss state:', err));

		socket.on('hit', async () => {
			console.log(`🖱️ Hit from ${socket.id}`);
			try {
				// Decrement health by 1 if above zero
				await coll.updateOne(
					{ _id: 'slugBoss', currentHP: { $gt: 0 } },
					{ $inc: { currentHP: -1 } }
				);

				// Fetch updated state
				let doc = await coll.findOne({ _id: 'slugBoss' });

				// If boss is dead or below, reset HP
				if (doc.currentHP <= 0) {
					doc.currentHP = doc.maxHP;
					await coll.updateOne(
						{ _id: 'slugBoss' },
						{ $set: { currentHP: doc.maxHP } }
					);
				}

				console.log(`→ new HP: ${doc.currentHP}/${doc.maxHP}`);
				io.emit('boss state', doc);
			} catch (err) {
				console.error('Hit handler error:', err);
			}
		});

		socket.on('disconnect', () => {
			console.log(`🔴 ${socket.id} disconnected`);
		});
	});

	const PORT = process.env.PORT || 3000;
	server.listen(PORT, () => console.log(`🚀 Listening on port ${PORT}`));
}

start().catch(err => {
	console.error('Startup error:', err);
	process.exit(1);
});
