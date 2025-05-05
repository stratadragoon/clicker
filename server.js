// server.js
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');

// Load MongoDB connection string from environment variable
const uri = process.env.MONGO_URI;
if (!uri) {
	console.error('ERROR: Define MONGO_URI in your environment');
	process.exit(1);
}

async function start() {
	// Connect to MongoDB Atlas
	const client = new MongoClient(uri);
	await client.connect();
	console.log('✅ Connected to MongoDB Atlas');

	// Select database & collection
	const db = client.db('myClickerApp');
	const coll = db.collection('counters');

	// Ensure the globalClicks document exists
	const existing = await coll.findOne({ _id: 'globalClicks' });
	if (!existing) {
		await coll.insertOne({ _id: 'globalClicks', total: 0 });
		console.log('Initialized globalClicks document');
	}

	// Set up Express to serve static files
	const app = express();
	app.use(express.static(path.join(__dirname, 'public')));
	app.get('/', (req, res) => {
		res.sendFile(path.join(__dirname, 'public', 'index.html'));
	});

	// Create HTTP server & bind Socket.io
	const server = http.createServer(app);
	const io = new Server(server);

	io.on('connection', socket => {
		console.log(`🟢 Client connected: ${socket.id}`);

		// Send current count on connect
		coll.findOne({ _id: 'globalClicks' })
			.then(doc => {
				console.log(`→ sending initial total ${doc.total} to ${socket.id}`);
				socket.emit('count updated', doc.total);
			})
			.catch(err => console.error('Error fetching initial count:', err));

		// Handle click events
		socket.on('click', async () => {
			try {
				console.log(`🖱️  Click received from ${socket.id}`);
				const result = await coll.findOneAndUpdate(
					{ _id: 'globalClicks' },
					{ $inc: { total: 1 } },
					{ returnDocument: 'after', upsert: true }
				);
				if (!result.value) {
					console.error('No document returned after update:', result);
					return;
				}
				const newTotal = result.value.total;
				console.log(`→ new DB total: ${newTotal}, broadcasting to all`);
				io.emit('count updated', newTotal);
			} catch (err) {
				console.error('Click handler error:', err);
			}
		});

		socket.on('disconnect', () => {
			console.log(`🔴 Client disconnected: ${socket.id}`);
		});
	});

	// Start the server
	const PORT = process.env.PORT || 3000;
	server.listen(PORT, () => {
		console.log(`🚀 Listening on port ${PORT}`);
	});
}

// Launch
start().catch(err => {
	console.error('Failed to start server:', err);
	process.exit(1);
});
