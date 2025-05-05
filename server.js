const path          = require('path');
const express       = require('express');
const http          = require('http');
const { Server }    = require('socket.io');
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

  const app    = express();
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/', (req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
  );

  const server = http.createServer(app);
  const io     = new Server(server);

  io.on('connection', socket => {
    console.log(`🟢 ${socket.id} connected`);

    // Send the latest boss state to this client
    coll.findOne({ _id: 'slugBoss' })
      .then(doc => socket.emit('boss state', doc))
      .catch(err => console.error('Error fetching boss state:', err));

    // Handle “hit” events; payload = damage amount
    socket.on('hit', async damage => {
      console.log(`🖱️ Hit from ${socket.id} for ${damage} damage`);
      const dmg = parseInt(damage, 10);
      if (isNaN(dmg) || dmg < 1 || dmg > 100) return;  // basic validation

      // Decrement health atomically
      await coll.updateOne(
        { _id: 'slugBoss', currentHP: { $gt: 0 } },
        { $inc: { currentHP: -dmg } }
      );

      // Read back, reset if dead
      let doc = await coll.findOne({ _id: 'slugBoss' });
      if (doc.currentHP <= 0) {
        doc.currentHP = doc.maxHP;
        await coll.updateOne(
          { _id: 'slugBoss' },
          { $set: { currentHP: doc.maxHP } }
        );
      }

      console.log(`→ new HP: ${doc.currentHP}/${doc.maxHP}`);
      io.emit('boss state', doc);
    });

    socket.on('disconnect', () => {
      console.log(`🔴 ${socket.id} disconnected`);
    });
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`🚀 Listening on ${PORT}`));
}

start().catch(err => {
  console.error('Startup error:', err);
  process.exit(1);
});
