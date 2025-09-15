const net = require('net');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || process.argv[2] || 3000);
const LOG_PATH = path.resolve(process.env.CHAT_LOG || 'chat.log');

// Maintain connected clients and assign incremental names
let nextId = 1;
const clients = new Map(); // socket -> { name }

function timestamp() {
  return new Date().toISOString();
}

function log(line) {
  const entry = `[${timestamp()}] ${line}\n`;
  fs.appendFile(LOG_PATH, entry, (err) => {
    if (err) console.error('Failed to write to log:', err);
  });
}

function broadcast(message, excludeSocket = null) {
  for (const [sock] of clients) {
    if (sock !== excludeSocket) {
    try 
      { sock.write(message + '\n'); } 
    catch 
      (_) {}
    }
  }
}

const server = net.createServer((socket) => {
socket.setEncoding('utf8');

// Assign a unique name
const name = `Client${nextId++}`;
clients.set(socket, { name });

// Log and notify
log(`${name} connected`);
socket.write(`Welcome, ${name}! You are connected to the chat server.` + '\n');
broadcast(`${name} has joined the chat.`, socket);

// Handle inbound messages
socket.on('data', (data) => {
// Normalize input: split in case multiple lines arrive
  const lines = String(data).replace(/\r\n?/g, '\n').split('\n').filter(Boolean);
  for (const line of lines) {
// If the client sends just whitespace, ignore
  const msg = line.trim();
    if (!msg) continue;
      const { name } = clients.get(socket) || { name: 'Unknown' };
      const wire = `${name}: ${msg}`;
      log(wire);
      broadcast(wire, socket); // exclude sender
  }
});

function handleDisconnect(reason = 'disconnected') {
  const info = clients.get(socket);
  if (!info) return; // already handled
    const { name } = info;
    clients.delete(socket);
    log(`${name} ${reason}`);
    broadcast(`${name} has left the chat.` , socket);
}

socket.on('error', (err) => {
// Log error and treat as disconnect if socket closes
  log(`${name} error: ${err.message}`);
});

socket.on('close', () => handleDisconnect('disconnected'));
socket.on('end', () => handleDisconnect('ended'));
});

server.on('listening', () => {
console.log(`[server] listening on port ${PORT}`);
console.log(`[server] logging to ${LOG_PATH}`);
});

server.on('error', (err) => {
console.error('[server] error:', err);
});

server.listen(PORT);

// Graceful shutdown
process.on('SIGINT', () => {
console.log('\n[server] shutting down...');
  for (const [sock] of clients) {
    try { sock.end('Server is shutting down. Goodbye!\n'); } catch (_) {}
  }
  server.close(() => process.exit(0));
})