// server.js
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');

// 1) Grab the URI from env
const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('ERROR: Define MONGO_URI in your environment');
  process.exit(1);
}

async function start() {
  // 2) Connect (no more useUnifiedTopology)
  const client = new MongoClient(uri);
  await client.connect();
  console.log('✅ Connected to MongoDB Atlas');

  const db = client.db('myClickerApp');       // make sure this matches your URI
  const coll = db.collection('counters');

  // 3) Ensure our counter document exists
  let doc = await coll.findOne({ _id: 'globalClicks' });
  if (!doc) {
    await coll.insertOne({ _id: 'globalClicks', total: 0 });
    doc = { total: 0 };
  }
  let totalClicks = doc.total;

  // 4) Setup Express + Socket.io
  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  const server = http.createServer(app);
  const io = new Server(server);

  io.on('connection', socket => {
    // Send the current count
    socket.emit('count updated', totalClicks);

    socket.on('click', async () => {
      // Atomically increment in Mongo and get the new value
      const result = await coll.findOneAndUpdate(
        { _id: 'globalClicks' },
        { $inc: { total: 1 } },
        { returnDocument: 'after' }
      );
      totalClicks = result.value.total;

      // Broadcast
      io.emit('count updated', totalClicks);
    });
  });

  // 5) Start the server
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`🚀 Listening on port ${PORT}`);
  });
}

start().catch(err => {
  console.error(err);
  process.exit(1);
});
