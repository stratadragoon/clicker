// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// 1) Setup Express to serve your client files
const app = express();
app.use(express.static('../'));  
//  Assumes your index.html lives one level up. Adjust path if different.

// 2) Create an HTTP server & bind Socket.io to it
const server = http.createServer(app);
const io = new Server(server);

// 3) In-memory counter
let totalClicks = 0;

io.on('connection', socket => {
  console.log(`Client connected [id=${socket.id}]`);
  
  // Send the current count whenever someone connects
  socket.emit('count updated', totalClicks);

  // Listen for click events from clients
  socket.on('click', () => {
    totalClicks++;
    // Broadcast the new count to **all** clients
    io.emit('count updated', totalClicks);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected [id=${socket.id}]`);
  });
});

// 4) Start listening
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
