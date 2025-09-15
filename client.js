const netC = require('net');

const HOST = process.env.HOST || process.argv[2] || '127.0.0.1';
const PORT_C = Number(process.env.PORT || process.argv[3] || 3000);

const sock = netC.createConnection({ host: HOST, port: PORT_C }, () => {
console.log(`[client] connected to ${HOST}:${PORT_C}`);
});

sock.setEncoding('utf8');

// Print any messages from the server
sock.on('data', (data) => {
// Data may contain multiple lines
const lines = String(data).replace(/\r\n?/g, '\n').split('\n').filter(Boolean);
for (const line of lines) {
console.log(line);
}
});

sock.on('end', () => {
console.log('[client] server ended the connection');
});

sock.on('close', () => {
console.log('[client] connection closed');
process.exit(0);
});

sock.on('error', (err) => {
console.error('[client] error:', err.message);
});

// Forward stdin to the server
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
// Send as-is; server trims
try { sock.write(chunk); } catch (e) {}
});

// Handle CTRL+C gracefully
process.on('SIGINT', () => {
console.log('\n[client] disconnecting...');
try { sock.end(); } catch (_) {}
process.exit(0);
});