'use strict';

const crypto = require('crypto');

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function buildWsFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '');
  const len = data.length;
  let hdr;
  if (len < 126) {
    hdr = Buffer.allocUnsafe(2);
    hdr[0] = 0x80 | (opcode & 0x0f);
    hdr[1] = len;
  } else if (len <= 0xffff) {
    hdr = Buffer.allocUnsafe(4);
    hdr[0] = 0x80 | (opcode & 0x0f);
    hdr[1] = 126;
    hdr.writeUInt16BE(len, 2);
  } else {
    hdr = Buffer.allocUnsafe(10);
    hdr[0] = 0x80 | (opcode & 0x0f);
    hdr[1] = 127;
    hdr.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([hdr, data]);
}

class PureWsClient {
  constructor(socket, req) {
    this.socket = socket;
    this.req = req;
    this.readyState = 1;
    this._buffer = Buffer.alloc(0);
    this._fragments = [];
    this._fragmentOpcode = null;
    this._listeners = { message: [], close: [], error: [] };

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => {
      if (this.readyState !== 3) {
        this.readyState = 3;
        this._emit('close');
      }
    });
    socket.on('error', (err) => {
      this._emit('error', err);
      if (this.readyState !== 3) {
        this.readyState = 3;
        this._emit('close');
      }
    });
  }

  on(ev, fn) {
    if (!this._listeners[ev]) this._listeners[ev] = [];
    this._listeners[ev].push(fn);
    return this;
  }

  _emit(ev, ...args) {
    const list = this._listeners[ev];
    if (!list) return;
    for (const fn of list) {
      try {
        fn(...args);
      } catch (e) {
        console.error('[WS listener error]', e);
      }
    }
  }

  send(data) {
    if (this.readyState !== 1 || this.socket.destroyed) return false;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.socket.write(buildWsFrame(0x2, buf));
    return true;
  }

  close(code = 1000) {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    try {
      const b = Buffer.alloc(2);
      b.writeUInt16BE(code, 0);
      this.socket.write(buildWsFrame(0x8, b));
    } catch (_) {}
    try {
      this.socket.end();
    } catch (_) {}
    this.readyState = 3;
  }

  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    while (this._buffer.length >= 2) {
      const b0 = this._buffer[0];
      const b1 = this._buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this._buffer.length < offset + 2) return;
        payloadLen = this._buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (this._buffer.length < offset + 8) return;
        const big = this._buffer.readBigUInt64BE(offset);
        if (big > BigInt(16 * 1024 * 1024)) {
          this.close(1009);
          return;
        }
        payloadLen = Number(big);
        offset += 8;
      }

      const maskLen = masked ? 4 : 0;
      if (this._buffer.length < offset + maskLen + payloadLen) return;

      let maskKey = null;
      if (masked) {
        maskKey = this._buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      const raw = this._buffer.subarray(offset, offset + payloadLen);
      const payload = Buffer.allocUnsafe(payloadLen);
      if (masked) {
        for (let i = 0; i < payloadLen; i++) {
          payload[i] = raw[i] ^ maskKey[i & 3];
        }
      } else {
        raw.copy(payload);
      }

      this._buffer = this._buffer.subarray(offset + payloadLen);

      if (opcode === 0x8) {
        this.close();
        return;
      }
      if (opcode === 0x9) {
        if (this.readyState === 1 && !this.socket.destroyed) {
          this.socket.write(buildWsFrame(0xA, payload));
        }
        continue;
      }
      if (opcode === 0xA) continue;

      if (opcode === 0x0) {
        this._fragments.push(payload);
        if (fin) {
          const full = Buffer.concat(this._fragments);
          this._fragments = [];
          this._fragmentOpcode = null;
          this._emit('message', full);
        }
      } else {
        if (fin) {
          this._emit('message', payload);
        } else {
          this._fragmentOpcode = opcode;
          this._fragments = [payload];
        }
      }
    }
  }
}

class PureWebSocketServer {
  constructor(onConnection) {
    this.clients = new Set();
    this.onConnection = onConnection;
  }

  attach(httpServer) {
    httpServer.on('upgrade', (req, socket, head) => {
      const key = req.headers['sec-websocket-key'];
      if (!key) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      const accept = crypto
        .createHash('sha1')
        .update(key + WS_MAGIC)
        .digest('base64');

      const headers = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
      ];
      if (req.headers['sec-websocket-protocol']) {
        const firstProto = String(req.headers['sec-websocket-protocol']).split(',')[0].trim();
        if (firstProto) headers.push(`Sec-WebSocket-Protocol: ${firstProto}`);
      }
      socket.write(headers.join('\r\n') + '\r\n\r\n');

      const client = new PureWsClient(socket, req);
      this.clients.add(client);
      client.on('close', () => this.clients.delete(client));
      if (head && head.length) {
        client._onData(head);
      }
      if (this.onConnection) {
        this.onConnection(client, req);
      }
    });
  }
}

module.exports = { PureWebSocketServer, PureWsClient };
