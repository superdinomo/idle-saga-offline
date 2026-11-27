'use strict';

const { AttrType } = require('./opcodes');

const MINI_DATE_TIME_BASE = new Date(2010, 0, 1, 0, 0, 0, 0).getTime();

function toMiniDateTime(ms = Date.now()) {
  const sec = Math.floor((ms - MINI_DATE_TIME_BASE) / 1000);
  return Math.max(0, sec & 2147483647);
}

class ByteWriter {
  constructor(initialSize = 128) {
    this.buf = Buffer.allocUnsafe(initialSize);
    this.pos = 0;
  }

  _ensure(extra) {
    if (this.pos + extra <= this.buf.length) return;
    let nextLen = this.buf.length * 2;
    while (nextLen < this.pos + extra) nextLen *= 2;
    const next = Buffer.allocUnsafe(nextLen);
    this.buf.copy(next, 0, 0, this.pos);
    this.buf = next;
  }

  writeByte(v) {
    this._ensure(1);
    this.buf.writeInt8((v | 0) << 24 >> 24, this.pos);
    this.pos += 1;
    return this;
  }

  writeUByte(v) {
    this._ensure(1);
    this.buf.writeUInt8((v >>> 0) & 0xff, this.pos);
    this.pos += 1;
    return this;
  }

  writeBool(v) {
    return this.writeUByte(v ? 1 : 0);
  }

  writeShort(v) {
    this._ensure(2);
    this.buf.writeInt16LE((v | 0) << 16 >> 16, this.pos);
    this.pos += 2;
    return this;
  }

  writeUShort(v) {
    this._ensure(2);
    this.buf.writeUInt16LE((v >>> 0) & 0xffff, this.pos);
    this.pos += 2;
    return this;
  }

  writeInt(v) {
    this._ensure(4);
    this.buf.writeInt32LE(v | 0, this.pos);
    this.pos += 4;
    return this;
  }

  writeUInt(v) {
    this._ensure(4);
    this.buf.writeUInt32LE(v >>> 0, this.pos);
    this.pos += 4;
    return this;
  }

  writeDouble(v) {
    this._ensure(8);
    this.buf.writeDoubleLE(Number(v) || 0, this.pos);
    this.pos += 8;
    return this;
  }

  writeString(str) {
    const s = str == null ? '' : String(str);
    const bytes = Buffer.from(s, 'utf8');
    this._ensure(2 + bytes.length + 1);
    this.buf.writeUInt16LE(bytes.length, this.pos);
    this.pos += 2;
    if (bytes.length > 0) {
      bytes.copy(this.buf, this.pos);
      this.pos += bytes.length;
    }
    this.buf.writeUInt8(0, this.pos);
    this.pos += 1;
    return this;
  }

  writeAttrs(attrsObj) {
    const count = AttrType.atCount;
    this.writeUShort(count);
    for (let i = 0; i < count; i++) {
      this.writeDouble(attrsObj && attrsObj[i] ? attrsObj[i] : 0);
    }
    return this;
  }

  writeItemData(item) {
    this.writeDouble(item.handle);
    this.writeInt(item.id);
    this.writeInt(item.count);
    this.writeInt(item.miniKeepTime || 0);
    this.writeUShort(0);
    return this;
  }

  writeItemReward(reward) {
    // ItemDataReward.parser: int32 type, int32 id, int32 count
    this.writeInt(reward.type || 0);
    this.writeInt(reward.id || 0);
    this.writeInt(reward.count || 0);
    return this;
  }

  writeItemReward2(reward) {
    // ItemDataReward.parser2: int32 id, int32 count (no type field!)
    this.writeInt(reward.id || 0);
    this.writeInt(reward.count || 0);
    return this;
  }

  toBuffer() {
    return Buffer.from(this.buf.subarray(0, this.pos));
  }
}

class ByteReader {
  constructor(buf) {
    this.buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
    this.pos = 0;
  }

  get remaining() {
    return Math.max(0, this.buf.length - this.pos);
  }

  readByte() {
    if (this.pos + 1 > this.buf.length) return 0;
    const v = this.buf.readInt8(this.pos);
    this.pos += 1;
    return v;
  }

  readUByte() {
    if (this.pos + 1 > this.buf.length) return 0;
    const v = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }

  readBool() {
    return this.readUByte() !== 0;
  }

  readShort() {
    if (this.pos + 2 > this.buf.length) return 0;
    const v = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  readUShort() {
    if (this.pos + 2 > this.buf.length) return 0;
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  readInt() {
    if (this.pos + 4 > this.buf.length) return 0;
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  readUInt() {
    if (this.pos + 4 > this.buf.length) return 0;
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  readDouble() {
    if (this.pos + 8 > this.buf.length) return 0;
    const v = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }

  readString() {
    if (this.pos + 2 > this.buf.length) return '';
    const len = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    if (this.pos + len > this.buf.length) return '';
    const str = this.buf.toString('utf8', this.pos, this.pos + len);
    this.pos += len;
    if (this.pos < this.buf.length && this.buf[this.pos] === 0) {
      this.pos += 1;
    }
    return str;
  }
}

module.exports = {
  MINI_DATE_TIME_BASE,
  toMiniDateTime,
  ByteWriter,
  ByteReader,
};
