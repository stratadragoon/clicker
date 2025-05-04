// server.js
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();

// Tell Express “any request for static assets should look in public/”
app.use(express.static(path.join(__dirname, 'public')));

// If someone hits “/” specifically, serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server);

let totalClicks = 0;

io.on('connection', socket => {
  socket.emit('count updated', totalClicks);
  socket.on('click', () => {
    totalClicks++;
    io.emit('count updated', totalClicks);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
