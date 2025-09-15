const net = require('net');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || process.argv[2] || 3000);
const CHAT_LOG_PATH = path.resolve(process.env.CHAT_LOG || 'chat.log');
const SERVER_LOG_PATH = path.resolve(process.env.SERVER_LOG || 'server.log');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'supersecretpw';

// socket -> { name }
const clients = new Map();
// name -> socket
const byName = new Map();
let nextId = 1;

const ts = () => new Date().toISOString();
const append = (file, line) =>
  fs.appendFile(file, `[${ts()}] ${line}\n`, (err) => err && console.error('log error', file, err));
const logChat = (line) => append(CHAT_LOG_PATH, line);
const logServer = (line) => append(SERVER_LOG_PATH, line);

const send = (sock, msg) => { try { sock.write(msg + '\n'); } catch {} };
const broadcast = (msg, exclude = null) => { for (const [s] of clients) if (s !== exclude) send(s, msg); };

const nameInUse = (name) => byName.has(name);
const nextGuest = () => `Guest${nextId++}`;

function setClientName(sock, newName) {
  const info = clients.get(sock);
  if (!info) return false;
  if (info.name && byName.get(info.name) === sock) byName.delete(info.name);
  info.name = newName;
  clients.set(sock, info);
  byName.set(newName, sock);
  return true;
}

function parseCommand(line) {
  if (!line.startsWith('/')) return null;
  const parts = line.trim().split(/\s+/);
  return { cmd: parts[0].toLowerCase(), args: parts.slice(1) };
}

// ----- Command handlers -----------------------------------------------------

function handleWhisper(sock, args) {
  const from = clients.get(sock)?.name || 'Unknown';
  if (args.length < 2) {
    const m = 'Usage: /w <username> <message>';
    send(sock, m); logServer(`${from} /w ERROR: ${m}`); return;
  }
  const targetName = args[0];
  const targetSock = byName.get(targetName);
  if (!targetSock) { const m = `No such user: ${targetName}`; send(sock, m); logServer(`${from} /w ERROR: ${m}`); return; }
  if (targetSock === sock) { const m = 'You cannot whisper to yourself'; send(sock, m); logServer(`${from} /w ERROR: ${m}`); return; }
  const message = args.slice(1).join(' ').trim();
  if (!message) { const m = 'Whisper message cannot be empty'; send(sock, m); logServer(`${from} /w ERROR: ${m}`); return; }
  send(targetSock, `(whisper) ${from}: ${message}`);
  send(sock, `(whisper to ${targetName}) ${from}: ${message}`);
  logServer(`${from} /w OK -> ${targetName}: ${message}`);
}

const validUsername = (n) => /^[A-Za-z0-9_-]{3,20}$/.test(n);

function handleUsername(sock, args) {
  const oldName = clients.get(sock)?.name || 'Unknown';
  if (args.length !== 1) { const m='Usage: /username <newName>'; send(sock,m); logServer(`${oldName} /username ERROR: ${m}`); return; }
  const newName = args[0];
  if (!validUsername(newName)) { const m='Invalid username. Use 3-20 chars: letters, numbers, _ or -'; send(sock,m); logServer(`${oldName} /username ERROR: ${m}`); return; }
  if (newName === oldName) { const m='New username must be different from current username'; send(sock,m); logServer(`${oldName} /username ERROR: ${m}`); return; }
  if (nameInUse(newName)) { const m='That username is already in use'; send(sock,m); logServer(`${oldName} /username ERROR: ${m}`); return; }
  setClientName(sock, newName);
  broadcast(`${oldName} is now known as ${newName}`, sock);
  send(sock, `You successfully changed your username to ${newName}`);
  logServer(`${oldName} /username OK -> ${newName}`);
}

function handleKick(sock, args) {
  const by = clients.get(sock)?.name || 'Unknown';
  if (args.length !== 2) { const m='Usage: /kick <username> <adminPassword>'; send(sock,m); logServer(`${by} /kick ERROR: ${m}`); return; }
  const [targetName, pw] = args;
  if (pw !== ADMIN_PASSWORD) { const m='Incorrect admin password'; send(sock,m); logServer(`${by} /kick ERROR: ${m}`); return; }
  const targetSock = byName.get(targetName);
  if (!targetSock) { const m=`No such user: ${targetName}`; send(sock,m); logServer(`${by} /kick ERROR: ${m}`); return; }
  if (targetSock === sock) { const m='You cannot kick yourself'; send(sock,m); logServer(`${by} /kick ERROR: ${m}`); return; }
  send(targetSock, 'You have been kicked from the chat by an administrator.');
  const kickedName = clients.get(targetSock)?.name || targetName;
  try { targetSock.end(); } catch {}
  logServer(`${by} /kick OK -> ${kickedName}`);
}

function handleClientList(sock) {
  const list = Array.from(byName.keys()).sort();
  send(sock, `Connected clients (${list.length}): ${list.join(', ')}`);
  const from = clients.get(sock)?.name || 'Unknown';
  logServer(`${from} /clientlist OK (${list.length} users)`);
}

function handleCommand(sock, parsed) {
  switch (parsed.cmd) {
    case '/w':
    case '/whisper':   return handleWhisper(sock, parsed.args);
    case '/username':  return handleUsername(sock, parsed.args);
    case '/kick':      return handleKick(sock, parsed.args);
    case '/clientlist':return handleClientList(sock);
    default:
      const from = clients.get(sock)?.name || 'Unknown';
      send(sock, `Unknown command: ${parsed.cmd}`);
      logServer(`${from} ${parsed.cmd} ERROR: unknown command`);
  }
}

// ----- Server lifecycle ------------------------------------------------------

const server = net.createServer((socket) => {
  socket.setEncoding('utf8');

  // assign unique GuestN
  let name = nextGuest();
  while (nameInUse(name)) name = nextGuest();
  clients.set(socket, { name });
  byName.set(name, socket);

  // greet + notify
  logChat(`${name} connected`);
  send(socket, `Welcome, ${name}! You are connected to the chat server.`);
  broadcast(`${name} has joined the chat.`, socket);

  socket.on('data', (data) => {
    const lines = String(data).replace(/\r\n?/g, '\n').split('\n').filter(Boolean);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const parsed = parseCommand(line);
      if (parsed) {
        handleCommand(socket, parsed);
      } else {
        const wire = `${name}: ${line}`;
        logChat(wire);
        broadcast(wire, socket);
      }
    }
  });

  function cleanup(reason = 'disconnected') {
    const info = clients.get(socket);
    if (!info) return;
    const currentName = info.name;
    clients.delete(socket);
    if (byName.get(currentName) === socket) byName.delete(currentName);
    logChat(`${currentName} ${reason}`);
    broadcast(`${currentName} has left the chat.`, socket);
  }

  socket.on('error', (err) => logChat(`${name} error: ${err.message}`));
  socket.on('end',   () => cleanup('ended'));
  socket.on('close', () => cleanup('disconnected'));
});

server.on('listening', () => {
  console.log(`[server] listening on port ${PORT}`);
  console.log(`[server] chat log: ${CHAT_LOG_PATH}`);
  console.log(`[server] server log: ${SERVER_LOG_PATH}`);
});
server.on('error', (err) => console.error('[server] error:', err));
server.listen(PORT);

process.on('SIGINT', () => {
  console.log('\n[server] shutting down...');
  for (const [s] of clients) { try { s.end('Server is shutting down. Goodbye!\n'); } catch {} }
  server.close(() => process.exit(0));
});