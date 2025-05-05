const path      = require('path');
const express   = require('express');
const http      = require('http');
const { Server }= require('socket.io');
const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI;
if (!uri) {
    console.error('❌ Define MONGO_URI in your environment');
    process.exit(1);
}

async function start() {
    const client = new MongoClient(uri);
    await client.connect();
    console.log('✅ Connected to MongoDB Atlas');

    const db   = client.db('myClickerApp');
    const coll = db.collection('counters');

    // Ensure doc exists
    await coll.updateOne(
      { _id: 'globalClicks' },
      { $setOnInsert: { total: 0 } },
      { upsert: true }
    );

    const app    = express();
    app.use(express.static(path.join(__dirname, 'public')));
    app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

    const server = http.createServer(app);
    const io     = new Server(server);

    io.on('connection', socket => {
        console.log(`🟢 Client connected: ${socket.id}`);

        // When the client asks, fetch & send the current count
        socket.on('getCount', async () => {
            const doc = await coll.findOne({ _id: 'globalClicks' });
            console.log(`→ sending total ${doc.total} to ${socket.id}`);
            socket.emit('count updated', doc.total);
        });

        socket.on('click', async () => {
            console.log(`🖱️ Click from ${socket.id}`);
            const { value } = await coll.findOneAndUpdate(
                { _id: 'globalClicks' },
                { $inc: { total: 1 } },
                { upsert: true, returnDocument: 'after' }
            );
            console.log(`→ new DB total: ${value.total}, broadcasting`);
            io.emit('count updated', value.total);
        });

        socket.on('disconnect', () => {
            console.log(`🔴 Client disconnected: ${socket.id}`);
        });
    });

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => console.log(`🚀 Listening on port ${PORT}`));
}

start().catch(err => {
    console.error('Failed to start:', err);
    process.exit(1);
});
