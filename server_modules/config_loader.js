'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * Pure-Node minimal PKZIP central directory parser supporting stored (0) and deflate (8) entries.
 */
function readZipJsonEntries(zipPath) {
  const buf = fs.readFileSync(zipPath);
  let eocdOffset = -1;
  const minOff = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= minOff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error(`Invalid ZIP (missing EOCD): ${zipPath}`);
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  let cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const entries = Object.create(null);

  for (let idx = 0; idx < totalEntries; idx++) {
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) break;
    const method = buf.readUInt16LE(cdOffset + 10);
    const compSize = buf.readUInt32LE(cdOffset + 20);
    const nameLen = buf.readUInt16LE(cdOffset + 28);
    const extraLen = buf.readUInt16LE(cdOffset + 30);
    const commentLen = buf.readUInt16LE(cdOffset + 32);
    const localHdrOff = buf.readUInt32LE(cdOffset + 42);
    const name = buf.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen);

    cdOffset += 46 + nameLen + extraLen + commentLen;

    if (!name.endsWith('.json')) continue;
    const localNameLen = buf.readUInt16LE(localHdrOff + 26);
    const localExtraLen = buf.readUInt16LE(localHdrOff + 28);
    const dataStart = localHdrOff + 30 + localNameLen + localExtraLen;
    const compData = buf.subarray(dataStart, dataStart + compSize);

    let raw;
    if (method === 0) raw = compData;
    else if (method === 8) raw = zlib.inflateRawSync(compData);
    else continue;

    try {
      entries[name] = JSON.parse(raw.toString('utf8'));
    } catch (_) {}
  }

  return entries;
}

class ConfigLoader {
  constructor(cdnRootDir) {
    this.cdnRootDir = cdnRootDir;
    this.cfgs = Object.create(null);
    this.maps = Object.create(null);
    this.verManifest = Object.create(null);
    this._walkableCache = Object.create(null);
  }

  loadAll() {
    const cfgZipPath = path.join(this.cdnRootDir, 'ver/545/resource/cfg/cfg.zip');
    this.cfgs = readZipJsonEntries(cfgZipPath);

    const verZipPath = path.join(this.cdnRootDir, 'ver/545/545.zip');
    if (fs.existsSync(verZipPath)) {
      const verEntries = readZipJsonEntries(verZipPath);
      this.verManifest = verEntries['545.json'] || Object.create(null);
    }

    const mapsPath = path.join(this.cdnRootDir, 'ver/406/resource/cfg/maps.json');
    if (fs.existsSync(mapsPath)) {
      this.maps = JSON.parse(fs.readFileSync(mapsPath, 'utf8'));
    }

    return this;
  }

  get(cfgName) {
    const key = cfgName.endsWith('.json') ? cfgName : `${cfgName}.json`;
    return this.cfgs[key] || this.cfgs[`cfg_${key}`] || null;
  }

  getMapInfo(sceneId) {
    const scenes = this.get('cfg_ScenesConfig');
    const sc = scenes && scenes[String(sceneId)];
    const mapFile = sc ? sc.mapfilename : 'map001';
    return {
      mapFile,
      scene: sc || null,
      gridData: this.maps[mapFile] || null,
    };
  }

  isWalkableTile(mapFile, tileX, tileY) {
    const m = this.maps[mapFile];
    if (!m || !Array.isArray(m.grids)) return false;
    const row = m.maxY;
    const col = m.maxX || Math.floor(m.pixWidth / (m.title_wh || 64));
    if (tileX < 0 || tileX >= col || tileY < 0 || tileY >= row) return false;
    const flags = m.grids[tileX * row + tileY] || 0;
    return (flags & 1) > 0;
  }

  getWalkableTiles(mapFile) {
    if (this._walkableCache[mapFile]) return this._walkableCache[mapFile];
    const m = this.maps[mapFile];
    if (!m || !Array.isArray(m.grids)) return [];
    const tileSize = m.title_wh || 64;
    const row = m.maxY;
    const col = m.maxX || Math.floor(m.pixWidth / tileSize);
    const list = [];
    for (let x = 0; x < col; x++) {
      for (let y = 0; y < row; y++) {
        const flags = m.grids[x * row + y] || 0;
        if ((flags & 1) > 0) {
          list.push({
            tileX: x,
            tileY: y,
            px: Math.floor((x + 0.5) * tileSize),
            py: Math.floor((y + 0.5) * tileSize),
          });
        }
      }
    }
    this._walkableCache[mapFile] = list;
    return list;
  }

  getSpawnPoint(sceneId) {
    const { mapFile } = this.getMapInfo(sceneId);
    const m = this.maps[mapFile];
    const tileSize = (m && m.title_wh) || 64;
    // Try Guaji boss pos 1 neighbor or central walkable tile
    const preferred = [
      [27, 23],
      [24, 21],
      [18, 12],
      [35, 16],
    ];
    for (const [tx, ty] of preferred) {
      if (this.isWalkableTile(mapFile, tx, ty)) {
        return {
          mapFile,
          tileX: tx,
          tileY: ty,
          px: Math.floor((tx + 0.5) * tileSize),
          py: Math.floor((ty + 0.5) * tileSize),
        };
      }
    }
    const list = this.getWalkableTiles(mapFile);
    if (list.length > 0) {
      const mid = list[Math.floor(list.length / 2)];
      return { mapFile, ...mid };
    }
    return { mapFile, tileX: 20, tileY: 15, px: 1312, py: 992 };
  }

  getGuajiMonstersForGuan(guanId) {
    const monsters = this.get('cfg_MonstersConfig') || {};
    const m1 = monsters[String(30000 + Math.max(1, guanId))];
    const normalPool = [];
    // Use non-boss starter monster if found, or fallback to Treant / Gargoyle
    for (const idStr of ['30001', '30002', '30003', '10000']) {
      if (monsters[idStr]) normalPool.push(monsters[idStr]);
    }
    return {
      boss: m1 || normalPool[0],
      mobs: normalPool,
    };
  }
}

module.exports = {
  readZipJsonEntries,
  ConfigLoader,
};
