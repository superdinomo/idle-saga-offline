'use strict';

const crypto = require('crypto');

const PACKET_TAG = 56831; // 0xDDFF
const HEAD_SIZE = 8;
const CRC_POLYNOMIAL = 4129;
const DROP_BITS = [
  4294967295, 4294967294, 4294967292, 4294967288,
  4294967280, 4294967264, 4294967232, 4294967168,
  4294967040, 4294966784, 4294966272, 4294965248,
  4294963200, 4294959104, 4294950912, 4294934528,
];

function crcBitReflect(val, bits) {
  let out = 0;
  let v = val | 0;
  const maxBit = bits - 1;
  for (let s = 0; s <= maxBit; ++s) {
    const a = maxBit - s;
    if (1 & v) {
      out |= (1 << a) & DROP_BITS[a];
    }
    v = (v >> 1) & 2147483647;
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Array(256);
  for (let n = 0; n < 256; ++n) {
    let e = (n << 8) & 4294967040;
    for (let a = 0; a < 8; ++a) {
      e = (32768 & e)
        ? ((e << 1) & 4294967294) ^ CRC_POLYNOMIAL
        : (e << 1) & 4294967294;
    }
    table[n] = e >>> 0;
  }
  return table;
})();

function crc16Update(buf, start = 0, len = 0) {
  let a = 0;
  const end = len === 0 ? buf.length : len;
  for (let pos = start; pos < end; ++pos) {
    const signedByte = buf.readInt8(pos);
    const reflected = crcBitReflect(signedByte, 8);
    const s = ((255 & reflected) ^ ((a >> 8) & 16777215)) & 255;
    a = CRC_TABLE[s] ^ ((a << 8) & 4294967040);
  }
  return 65535 & crcBitReflect(a, 16);
}

function makeTargetSalt() {
  return crypto.randomBytes(4).readUInt32LE(0);
}

function deriveKey(selfSalt, targetSalt) {
  // Match Encrypt.makeKey:
  // sKey = (sSelfSalt ^ sTargetSalt) + 8254;
  // sKeyBuff[e] = (sKey & (255 << (e << 3))) >> (e << 3);
  const sKeySigned = ((selfSalt | 0) ^ (targetSalt | 0)) + 8254;
  const keyBuff = Buffer.allocUnsafe(4);
  for (let e = 0; e < 4; ++e) {
    const val = (sKeySigned & (255 << (e << 3))) >> (e << 3);
    keyBuff[e] = val & 0xff;
  }
  const sKeyU32 = sKeySigned >>> 0;
  const keyBytes = Buffer.allocUnsafe(4);
  keyBytes.writeUInt32LE(sKeyU32, 0);
  const expectedCheck = crc16Update(keyBytes, 0, 4);
  const expectedCheckSigned = (expectedCheck << 16) >> 16;
  return { sKey: sKeyU32, keyBuff, expectedCheck, expectedCheckSigned };
}

function xorSlice(buf, start, len, keyBuff) {
  const end = Math.min(buf.length, start + len);
  for (let s = start; s < end; ++s) {
    buf[s] = (buf[s] ^ keyBuff[s % 4]) & 0xff;
  }
}

/**
 * Parses and decrypts client-to-server packets from an incoming buffer stream.
 * Returns { packets: [{ counter, sysId, msgId, payload }], rest: Buffer }.
 */
function parseClientFrames(streamBuf, keyBuff) {
  const packets = [];
  let offset = 0;

  while (streamBuf.length - offset >= HEAD_SIZE) {
    const tag = streamBuf.readUInt16LE(offset);
    if (tag !== PACKET_TAG) {
      offset += 1;
      continue;
    }

    const hdrCopy = Buffer.from(streamBuf.subarray(offset, offset + HEAD_SIZE));
    const bodyLen = hdrCopy.readUInt16LE(2);
    if (streamBuf.length - offset < HEAD_SIZE + bodyLen) {
      break;
    }

    if (keyBuff) {
      xorSlice(hdrCopy, 4, 4, keyBuff);
    }

    const fullFrame = Buffer.from(streamBuf.subarray(offset, offset + HEAD_SIZE + bodyLen));
    hdrCopy.copy(fullFrame, 0, 0, HEAD_SIZE);

    // Body starts with uint32LE counter + uint8 sysId + uint8 msgId
    if (bodyLen >= 6) {
      const bodyStart = HEAD_SIZE;
      const counter = fullFrame.readUInt32LE(bodyStart);
      const sysId = fullFrame.readUInt8(bodyStart + 4);
      const msgId = fullFrame.readUInt8(bodyStart + 5);
      const payload = fullFrame.subarray(bodyStart + 6);
      packets.push({ counter, sysId, msgId, payload });
    }

    offset += HEAD_SIZE + bodyLen;
  }

  return {
    packets,
    rest: offset < streamBuf.length ? Buffer.from(streamBuf.subarray(offset)) : Buffer.alloc(0),
  };
}

/**
 * Builds an unencrypted Server -> Client packet matching Socket.readBytes / delBytes:
 * [uint16LE 56831][uint16LE bodyLen][4 zero bytes][uint8 sysId][uint8 msgId][...payload]
 */
function buildServerFrame(sysId, msgId, payload) {
  const body = payload ? (Buffer.isBuffer(payload) ? payload : Buffer.from(payload)) : Buffer.alloc(0);
  const bodyLen = 2 + body.length;
  const out = Buffer.allocUnsafe(HEAD_SIZE + bodyLen);
  out.writeUInt16LE(PACKET_TAG, 0);
  out.writeUInt16LE(bodyLen, 2);
  out.writeUInt32LE(0, 4);
  out.writeUInt8(sysId & 0xff, 8);
  out.writeUInt8(msgId & 0xff, 9);
  if (body.length > 0) {
    body.copy(out, 10);
  }
  return out;
}

module.exports = {
  PACKET_TAG,
  HEAD_SIZE,
  crc16Update,
  makeTargetSalt,
  deriveKey,
  xorSlice,
  parseClientFrames,
  buildServerFrame,
};
