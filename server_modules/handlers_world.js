'use strict';

const { PackId, EntityType, AttrType, CurType, DamageTypes } = require('./opcodes');
const { ByteWriter, ByteReader, toMiniDateTime } = require('./packet');
const { recalcStats } = require('./session_state');

function sendAttrsDiff(ctx) {
  const { sendPacket, st } = ctx;
  const bw = new ByteWriter();
  bw.writeAttrs(st.attrs);
  bw.writeDouble(st.power);
  bw.writeShort(0); // parserAttAdd length = 0
  bw.writeDouble(st.power);
  sendPacket(PackId.Default, 8, bw.toBuffer());
}

function sendCurrencyChange(ctx, curType, newVal, silent = 0) {
  const bw = new ByteWriter();
  bw.writeShort(curType);
  bw.writeDouble(newVal);
  bw.writeUByte(silent);
  ctx.sendPacket(PackId.Default, 5, bw.toBuffer());
}

function sendExpUpdate(ctx, deltaExp, showFly = 1) {
  const { st, sendPacket, configLoader } = ctx;
  const prevLv = st.level;
  st.exp += Math.max(0, Math.floor(deltaExp));
  while (st.exp >= st.totalExp && st.level < 999) {
    st.exp -= st.totalExp;
    st.level += 1;
    st.totalExp = 1000 + st.level * st.level * 120;
  }
  const bw = new ByteWriter();
  bw.writeInt(st.level);
  bw.writeDouble(st.exp);
  bw.writeDouble(Math.max(0, Math.floor(deltaExp)));
  bw.writeDouble(st.totalExp);
  bw.writeUByte(showFly);
  bw.writeShort(0);
  sendPacket(PackId.Default, 7, bw.toBuffer());

  if (st.level > prevLv) {
    recalcStats(configLoader, st);
    sendAttrsDiff(ctx);
  }
}

function sendBloodUpdate(ctx, handle, hp, hpMax, isHeal = false) {
  const bw = new ByteWriter();
  bw.writeDouble(handle);
  bw.writeUByte(0);
  bw.writeDouble(Math.max(0, Math.floor(hp)));
  bw.writeDouble(Math.max(1, Math.floor(hpMax)));
  bw.writeBool(isHeal);
  bw.writeUByte(0);
  ctx.sendPacket(PackId.Default, 9, bw.toBuffer());
}

function sendSkillInit(ctx) {
  const { st, sendPacket } = ctx;

  // 1. Hunqi (2, 70) sets skillMaxLv BEFORE (2, 8)
  const bwHq = new ByteWriter();
  bwHq.writeShort(Math.max(1, st.hunqiAwakeLv));
  bwHq.writeInt(st.hunqiAwakeExp);
  bwHq.writeUByte(st.hunqiList.length);
  for (const h of st.hunqiList) {
    bwHq.writeShort(h.id);
    bwHq.writeShort(h.lv);
  }
  sendPacket(PackId.Skill, 70, bwHq.toBuffer());

  // 2. Active skills (2, 8)
  const bwSk = new ByteWriter();
  bwSk.writeShort(st.skills.length);
  for (const sk of st.skills) {
    bwSk.writeShort(sk.id);
    bwSk.writeShort(sk.lv);
  }
  sendPacket(PackId.Skill, 8, bwSk.toBuffer());

  // 3. Passive skills (2, 60)
  const bwPas = new ByteWriter();
  bwPas.writeShort(st.passiveSkills.size);
  for (const [id, lv] of st.passiveSkills.entries()) {
    bwPas.writeInt(id);
    bwPas.writeShort(lv);
  }
  sendPacket(PackId.Skill, 60, bwPas.toBuffer());
}

function sendGuajiInfo(ctx) {
  const { st, sendPacket } = ctx;
  const g = st.guaji;
  const bw = new ByteWriter();
  bw.writeShort(g.challengeGuanId);
  bw.writeUByte(g.helpCount);
  bw.writeUByte(g.assistCount);
  bw.writeBool(g.isAutoChallenge);
  bw.writeUByte(g.boCount);
  bw.writeShort(g.maxClaimedWorldIdx);
  bw.writeUByte(g.ksgjSdCount);
  bw.writeUByte(g.ksgjBuyCount);
  sendPacket(PackId.Fuben, 0, bw.toBuffer());
}

function writeEntityBase(bw, type, handle, cfgId, masterHandle, x, y, tx = -1, ty = -1) {
  bw.writeShort(type);
  bw.writeDouble(handle);
  bw.writeInt(cfgId);
  bw.writeDouble(masterHandle);
  bw.writeUByte(1); // AppearType.common
  bw.writeInt(Math.round(x));
  bw.writeInt(Math.round(y));
  bw.writeInt(Math.round(tx));
  bw.writeInt(Math.round(ty));
}

function spawnActorAndHeroEntities(ctx) {
  const { st, sendPacket } = ctx;

  // EntityType.ACTOR (0)
  {
    const bw = new ByteWriter();
    writeEntityBase(bw, EntityType.ACTOR, st.handleActor, 0, st.handleActor, st.x, st.y);
    bw.writeDouble(st.handleRole);
    bw.writeInt(st.damon.useId > 0 ? st.damon.useId : 0);
    bw.writeInt(st.damon.moZhenId || 0);
    bw.writeInt(st.meilin.huanHuaId >= 0 ? st.meilin.huanHuaId : -1);
    bw.writeInt(1); // teamId
    sendPacket(PackId.Default, 4, bw.toBuffer());
  }

  // EntityType.ROLE (1)
  {
    const unlocked = st.skills.filter((s) => s.lv > 0);
    const bw = new ByteWriter();
    writeEntityBase(bw, EntityType.ROLE, st.handleRole, 0, st.handleActor, st.x, st.y);
    bw.writeAttrs(st.attrs);
    bw.writeUByte(0); // buffs count
    bw.writeString(st.name);
    bw.writeByte(st.job);
    bw.writeInt(st.level);
    bw.writeInt(st.sz.huanHuaId);
    bw.writeInt(st.shenqi.huanHuaId);
    bw.writeInt(st.wing.huanHuaId);
    bw.writeInt(st.touxian.level);
    bw.writeInt(0); // footId
    bw.writeInt(st.titleShowId);
    bw.writeInt(0); // guildID
    bw.writeString('');
    bw.writeInt(1); // teamId
    bw.writeInt(0); // guildOffice
    bw.writeInt(0); // mozhenId
    bw.writeInt(0); // bianshenId
    bw.writeInt(0); // bianShenCD
    bw.writeInt(0); // shengLingId
    bw.writeByte(-1); // huDunId
    bw.writeUByte(0); // isShowHunduBar
    bw.writeByte(0); // entityScoreType
    bw.writeInt(0); // entityScoreValue
    bw.writeUByte(unlocked.length);
    for (const sk of unlocked) {
      bw.writeInt(sk.id);
    }
    sendPacket(PackId.Default, 4, bw.toBuffer());
  }

  // Optional Mercenary (EntityType.YONGBING = 4) when active
  if (st.yongbing && st.yongbing.useId > 0) {
    const bw = new ByteWriter();
    writeEntityBase(bw, EntityType.YONGBING, st.handleYongbing, 0, st.handleActor, st.x - 70, st.y + 30);
    bw.writeAttrs(st.attrs);
    bw.writeUByte(0);
    bw.writeString(st.name);
    bw.writeInt(st.yongbing.useId);
    bw.writeInt(st.yongbing.moZhenId || 0);
    bw.writeUByte(1);
    bw.writeInt(401); // Yongbing Warlord Arrow skill with actionParam[0]
    sendPacket(PackId.Default, 4, bw.toBuffer());
  }
}

function clearLiveMonsters(ctx) {
  const { st, sendPacket } = ctx;
  for (const h of st.liveEntities.keys()) {
    const bw = new ByteWriter();
    bw.writeDouble(h);
    bw.writeUByte(1);
    sendPacket(PackId.Default, 10, bw.toBuffer());
  }
  st.liveEntities.clear();
  if (ctx._monAiTimer) {
    clearInterval(ctx._monAiTimer);
    ctx._monAiTimer = null;
  }
}

function buildMonsterAttrs(monCfg, isBoss) {
  const arr = new Array(AttrType.atCount).fill(0);
  // Keep starter wave monsters fast & fun to defeat on Lv1 while boss scales naturally
  const hpMax = Math.max(500, Math.floor((monCfg.HpMax || 2000) * (isBoss ? 0.12 : 0.04)));
  arr[AttrType.atHp] = hpMax;
  arr[AttrType.atHpMax] = hpMax;
  arr[AttrType.atAtkMin] = Math.max(12, Math.floor((monCfg.AtkMin || 40) * 0.05));
  arr[AttrType.atAtkMax] = Math.max(20, Math.floor((monCfg.AtkMax || 60) * 0.05));
  arr[AttrType.atDef] = Math.max(0, Math.floor((monCfg.Def || 0) * 0.1));
  arr[AttrType.atAtkSuc] = monCfg.AtkSuc || 500;
  arr[AttrType.atDefSuc] = monCfg.DefSuc || 0;
  arr[AttrType.atMvSpeed] = monCfg.MvSpeed || 2800;
  arr[AttrType.atAtkSpeed] = monCfg.AtkSpeed || 0;
  return { arr, hpMax };
}

function spawnServerMonster(ctx, monCfg, x, y, isBoss = false) {
  const { st, sendPacket } = ctx;
  const handle = st.allocEntityHandle();
  const { arr, hpMax } = buildMonsterAttrs(monCfg, isBoss);

  const entity = {
    handle,
    monId: monCfg.id,
    name: monCfg.name || 'Monster',
    head: monCfg.head || 'monhead100806',
    level: monCfg.level || 1,
    x,
    y,
    hp: hpMax,
    hpMax,
    atkMin: arr[AttrType.atAtkMin],
    atkMax: arr[AttrType.atAtkMax],
    isBoss,
    dead: false,
  };
  st.liveEntities.set(handle, entity);

  const bw = new ByteWriter();
  writeEntityBase(bw, EntityType.MONSTER_SERVER, handle, monCfg.id, handle, x, y);
  bw.writeAttrs(arr);
  bw.writeUByte(0); // buffs
  bw.writeByte(0); // avatarIndex
  bw.writeString(isBoss ? st.name : '');
  bw.writeInt(0); // teamId
  bw.writeByte(0); // scoreType
  bw.writeInt(0); // scoreVal
  sendPacket(PackId.Default, 4, bw.toBuffer());

  if (isBoss) {
    sendBossBlood(ctx, entity);
  }
  return entity;
}

function sendBossBlood(ctx, boss) {
  const { st, sendPacket } = ctx;
  const bwSafe = new ByteWriter();
  bwSafe.writeInt(boss.monId);
  bwSafe.writeDouble(Math.max(0, Math.floor(boss.hp)));
  bwSafe.writeShort(0);
  bwSafe.writeInt(st.fbId);
  bwSafe.writeString(boss.name);
  bwSafe.writeString(boss.head);
  bwSafe.writeInt(boss.level);
  bwSafe.writeDouble(Math.max(1, Math.floor(boss.hpMax)));
  sendPacket(PackId.Fuben, 46, bwSafe.toBuffer());
}

function spawnGuajiWave(ctx) {
  const { st, configLoader } = ctx;
  if (!st || st.guaji.inBossFight) return;
  clearLiveMonsters(ctx);

  const { mapFile } = configLoader.getMapInfo(st.mapId);
  const { mobs } = configLoader.getGuajiMonstersForGuan(st.guaji.challengeGuanId);
  const pool = mobs && mobs.length ? mobs : [{ id: 30001, name: 'Treant', HpMax: 1500, AtkMin: 30, AtkMax: 50, level: 1, MvSpeed: 2800 }];

  const offsets = [
    [-190, -80],
    [180, -60],
    [0, -180],
  ];

  for (let i = 0; i < 3; i++) {
    const monCfg = pool[i % pool.length];
    let tx = st.x + offsets[i][0];
    let ty = st.y + offsets[i][1];
    if (!configLoader.isWalkableTile(mapFile, Math.floor(tx / 64), Math.floor(ty / 64))) {
      tx = st.x + (i - 1) * 90;
      ty = st.y - 90;
    }
    spawnServerMonster(ctx, monCfg, tx, ty, false);
  }

  startMonsterAiLoop(ctx);
}

function startMonsterAiLoop(ctx) {
  if (ctx._monAiTimer) clearInterval(ctx._monAiTimer);
  ctx._monAiTimer = setInterval(() => {
    if (!ctx.ws || ctx.ws.readyState !== 1 || !ctx.st) {
      clearInterval(ctx._monAiTimer);
      ctx._monAiTimer = null;
      return;
    }
    const { st, sendPacket } = ctx;
    for (const m of st.liveEntities.values()) {
      if (m.dead) continue;
      // Monster swings light attack on player so battle feels alive, while player stays healthy
      const dmg = Math.max(5, Math.min(Math.floor(st.hpMax * 0.03), Math.floor(m.atkMin + Math.random() * (m.atkMax - m.atkMin + 1))));
      st.hp = Math.max(Math.floor(st.hpMax * 0.25), st.hp - dmg);
      if (st.hp < Math.floor(st.hpMax * 0.4)) st.hp = st.hpMax;

      const bwDmg = new ByteWriter();
      bwDmg.writeDouble(m.handle);
      bwDmg.writeInt(50000);
      bwDmg.writeUByte(1); // actionIndex (1 => actionIndex - 1 = 0)
      bwDmg.writeDouble(st.handleRole);
      bwDmg.writeShort(1); // 1 range target
      bwDmg.writeDouble(st.handleRole);
      bwDmg.writeByte(DamageTypes.HIT);
      bwDmg.writeByte(0);
      bwDmg.writeDouble(-dmg);
      bwDmg.writeDouble(0);
      sendPacket(PackId.Skill, 1, bwDmg.toBuffer());

      sendBloodUpdate(ctx, st.handleRole, st.hp, st.hpMax, false);
      break; // one monster attack per tick to avoid flooding
    }
  }, 1600);
}

function enterMapScene(ctx, fbId, mapId, x, y) {
  const { st, sendPacket, configLoader } = ctx;
  clearLiveMonsters(ctx);
  st.fbId = fbId;
  st.mapId = mapId;
  st.x = x;
  st.y = y;

  // 1. patchEnterMap (0, 3) MUST arrive before (0, 4)
  const bwMap = new ByteWriter();
  bwMap.writeInt(fbId);
  bwMap.writeInt(mapId);
  bwMap.writeShort(x);
  bwMap.writeShort(y);
  sendPacket(PackId.Default, 3, bwMap.toBuffer());

  // 2. RefreshConfig (75, 4)
  const tileX = Math.floor(x / 64);
  const tileY = Math.floor(y / 64);
  const bwRef = new ByteWriter();
  bwRef.writeInt(fbId);
  bwRef.writeShort(4);
  bwRef.writeShort(2);
  bwRef.writeShort(2);
  bwRef.writeShort(2);
  bwRef.writeShort(tileX);
  bwRef.writeShort(Math.max(1, tileY - 2));
  bwRef.writeShort(Math.max(1, tileX + 2));
  bwRef.writeShort(tileY);
  sendPacket(PackId.Config, 4, bwRef.toBuffer());

  // 3. Create Actor + Role + Yongbing
  spawnActorAndHeroEntities(ctx);

  // 4. Spawn initial Guaji monsters if in Guaji map
  if (fbId >= 10001 && fbId < 20000 && !st.guaji.inBossFight) {
    spawnGuajiWave(ctx);
  }

  // 5. Enter map complete (0, 63) hides black transition veil
  const bwDone = new ByteWriter();
  bwDone.writeUByte(0);
  sendPacket(PackId.Default, 63, bwDone.toBuffer());
}

function handleMonsterDeath(ctx, mon, killerHandle, skillId) {
  const { st, sendPacket, configLoader, handlersSystems } = ctx;
  mon.dead = true;
  st.liveEntities.delete(mon.handle);

  // 1. doEntityDie (0, 40)
  const bwDie = new ByteWriter();
  bwDie.writeDouble(mon.handle);
  bwDie.writeDouble(killerHandle);
  bwDie.writeInt(skillId);
  sendPacket(PackId.Default, 40, bwDie.toBuffer());

  // 2. Grant Exp & Gold drops
  const expGain = mon.isBoss ? 1500 : 250;
  const goldGain = mon.isBoss ? 2500 : 400;
  sendExpUpdate(ctx, expGain, 1);

  const drops = [
    { handle: st.nextDropHandle(), type: 0, id: CurType.gold, count: goldGain },
    { handle: st.nextDropHandle(), type: 1, id: 310001, count: mon.isBoss ? 10 : 2 },
  ];
  for (const d of drops) st.liveDrops.set(d.handle, d);

  const bwDrop = new ByteWriter();
  bwDrop.writeInt(Math.round(mon.x));
  bwDrop.writeInt(Math.round(mon.y));
  bwDrop.writeString(st.name);
  bwDrop.writeInt(drops.length);
  for (const d of drops) {
    bwDrop.writeInt(d.handle);
    bwDrop.writeInt(d.type);
    bwDrop.writeInt(d.id);
    bwDrop.writeInt(d.count);
  }
  sendPacket(PackId.Default, 33, bwDrop.toBuffer());

  if (mon.isBoss) {
    st.guaji.inBossFight = false;
    st.guaji.bossHandle = 0;
    const prevGuan = st.guaji.challengeGuanId;
    st.guaji.challengeGuanId = prevGuan + 1;
    st.guaji.boCount = 0;

    // Grant bonus clear rewards
    st.currencies[CurType.yb] += 50;
    sendCurrencyChange(ctx, CurType.yb, st.currencies[CurType.yb], 1);

    const bwWin = new ByteWriter();
    bwWin.writeUByte(1); // victory!
    bwWin.writeShort(st.guaji.challengeGuanId);
    bwWin.writeUByte(2); // rewards count
    bwWin.writeItemReward2({ type: 0, id: CurType.gold, count: goldGain });
    bwWin.writeItemReward2({ type: 0, id: CurType.yb, count: 50 });
    sendPacket(PackId.Fuben, 1, bwWin.toBuffer());

    // Progress MainTask #2 ("Pass Ethereal Realm F1")
    handlersSystems.onGameEvent(ctx, 'guaji_boss_clear', { guan: prevGuan });
    return;
  }

  // Normal Guaji wave mob killed
  st.guaji.killsInWave += 1;
  const aliveRemaining = [...st.liveEntities.values()].some((e) => !e.dead);
  if (!aliveRemaining) {
    st.guaji.boCount = Math.min(3, st.guaji.boCount + 1);
    const bwBo = new ByteWriter();
    bwBo.writeUByte(st.guaji.boCount);
    sendPacket(PackId.Fuben, 5, bwBo.toBuffer());

    handlersSystems.onGameEvent(ctx, 'wave_clear', { boCount: st.guaji.boCount });

    setTimeout(() => {
      if (ctx.ws && ctx.ws.readyState === 1 && !st.guaji.inBossFight) {
        spawnGuajiWave(ctx);
      }
    }, 1100);
  }
}

function handleDefaultPacket(ctx, msgId, payload) {
  const { st, sendPacket, configLoader, handlersInventory } = ctx;
  if (!st) return;
  const br = new ByteReader(payload);

  if (msgId === 255) {
    // Heartbeat -> (0, 14) doServerTime
    const bw = new ByteWriter();
    bw.writeUInt(toMiniDateTime());
    sendPacket(PackId.Default, 14, bw.toBuffer());
    return;
  }

  if (msgId === 11) {
    // sendMoveEntity: [double handle, int fbId, int destX, int destY, int curX, int curY]
    const handle = br.readDouble();
    br.readInt();
    const destX = br.readInt();
    const destY = br.readInt();
    if (handle === st.handleRole) {
      st.x = destX;
      st.y = destY;
    }
    return;
  }

  if (msgId === 12) {
    const handle = br.readDouble();
    br.readInt();
    const cx = br.readInt();
    const cy = br.readInt();
    if (handle === st.handleRole) {
      st.x = cx;
      st.y = cy;
    }
    return;
  }

  if (msgId === 32) {
    // sendPickUpItem: [int dropHandle]
    const dropHandle = br.readInt();
    const drop = st.liveDrops.get(dropHandle);
    if (drop) {
      st.liveDrops.delete(dropHandle);
      if (drop.type === 0) {
        st.currencies[drop.id] = (st.currencies[drop.id] || 0) + drop.count;
        sendCurrencyChange(ctx, drop.id, st.currencies[drop.id], 0);
      } else {
        handlersInventory.giveItem(ctx, drop.id, drop.count, 1);
      }
    }
    const bw = new ByteWriter();
    bw.writeInt(dropHandle);
    bw.writeShort(0); // picked up ok
    sendPacket(PackId.Default, 32, bw.toBuffer());
    return;
  }

  if (msgId === 22) {
    // sendRename: [str newName]
    const newName = br.readString() || st.name;
    st.name = newName;
    const bw = new ByteWriter();
    bw.writeUByte(0);
    bw.writeString(newName);
    sendPacket(PackId.Default, 22, bw.toBuffer());
    return;
  }

  if (msgId === 30) {
    // sendEnterFb: [int fbId]
    const fbId = br.readInt() || st.fbId;
    const fubenCfg = configLoader.get('cfg_FubenConfig') || {};
    const entry = fubenCfg[fbId];
    const sceneId = entry ? 1001 : st.mapId;
    const sp = configLoader.getSpawnPoint(sceneId);
    enterMapScene(ctx, fbId, sceneId, sp.px, sp.py);
    return;
  }

  if (msgId === 31) {
    // sendQuitFb -> return to Guaji
    st.guaji.inBossFight = false;
    const sp = configLoader.getSpawnPoint(1001);
    enterMapScene(ctx, 10000 + st.guaji.challengeGuanId, 1001, sp.px, sp.py);
    return;
  }

  if (msgId === 16) {
    // sentOtherActor -> ignore silently or return basic info
    return;
  }
}

function handleSkillPacket(ctx, msgId, payload) {
  const { st, sendPacket, configLoader } = ctx;
  if (!st) return;
  const br = new ByteReader(payload);

  if (msgId === 1) {
    // sendUseSkill: [double senderHandle, double castTargetHandle, double targetHandle, int skillId, int elapsed]
    const senderHandle = br.readDouble();
    const castTargetHandle = br.readDouble();
    const targetHandle = br.readDouble();
    const skillId = br.readInt();

    const targets = [];
    const primary = st.liveEntities.get(targetHandle) || [...st.liveEntities.values()].find((m) => !m.dead);
    if (!primary || primary.dead) return;
    targets.push(primary);

    // AoE skills hit nearby live monsters too
    const skCfg = (configLoader.get('cfg_SkillsConfig') || {})[skillId];
    const maxTargets = (skCfg && skCfg.affectCount) || 1;
    if (maxTargets > 1) {
      for (const m of st.liveEntities.values()) {
        if (!m.dead && m.handle !== primary.handle) {
          targets.push(m);
          if (targets.length >= maxTargets) break;
        }
      }
    }

    const baseAtk = Math.max(80, st.attrs[AttrType.atAtkMax] || 300);
    const dmgResults = targets.map((t) => {
      const crit = Math.random() < 0.25;
      const mult = crit ? 1.8 : 1.0 + Math.random() * 0.25;
      const dmg = Math.max(25, Math.floor(baseAtk * mult));
      return {
        target: t,
        dmg,
        type: crit ? DamageTypes.ZMYJ : DamageTypes.HIT,
      };
    });

    const bw = new ByteWriter();
    bw.writeDouble(senderHandle);
    bw.writeInt(skillId);
    bw.writeUByte(1); // actionIndex (1-based => 0)
    bw.writeDouble(primary.handle);
    bw.writeShort(dmgResults.length);
    for (const r of dmgResults) {
      bw.writeDouble(r.target.handle);
      bw.writeByte(r.type);
      bw.writeByte(0); // senderType
      bw.writeDouble(-r.dmg);
      bw.writeDouble(0); // reflect
    }
    sendPacket(PackId.Skill, 1, bw.toBuffer());

    for (const r of dmgResults) {
      const m = r.target;
      m.hp = Math.max(0, m.hp - r.dmg);
      sendBloodUpdate(ctx, m.handle, m.hp, m.hpMax, false);
      if (m.isBoss) sendBossBlood(ctx, m);
      if (m.hp <= 0 && !m.dead) {
        handleMonsterDeath(ctx, m, senderHandle, skillId);
      }
    }
    return;
  }

  if (msgId === 4) {
    // sendSkillUp: [short skillId] -> patchSkillUp: [int skillId, short lv]
    const skillId = br.readShort();
    const sk = st.skills.find((s) => s.id === skillId);
    if (!sk) return;
    const cost = 500 + sk.lv * 100;
    if ((st.currencies[CurType.talentValue] || 0) >= cost) {
      st.currencies[CurType.talentValue] -= cost;
      sendCurrencyChange(ctx, CurType.talentValue, st.currencies[CurType.talentValue], 1);
    }
    sk.lv += 1;
    const bw = new ByteWriter();
    bw.writeInt(sk.id);
    bw.writeShort(sk.lv);
    sendPacket(PackId.Skill, 4, bw.toBuffer());
    recalcStats(configLoader, st);
    sendAttrsDiff(ctx);
    return;
  }

  if (msgId === 5) {
    // sendSkillUpOneKey -> patchSkillUpOneKey: [short count, [short id, short lv]*]
    for (const sk of st.skills) {
      if (sk.lv > 0) sk.lv += 1;
    }
    const bw = new ByteWriter();
    bw.writeShort(st.skills.length);
    for (const sk of st.skills) {
      bw.writeShort(sk.id);
      bw.writeShort(sk.lv);
    }
    sendPacket(PackId.Skill, 5, bw.toBuffer());
    recalcStats(configLoader, st);
    sendAttrsDiff(ctx);
    return;
  }

  if (msgId === 61) {
    // sendSkillPassivityUp: [int id]
    const id = br.readInt();
    const cur = (st.passiveSkills.get(id) || 0) + 1;
    st.passiveSkills.set(id, cur);
    const bw = new ByteWriter();
    bw.writeInt(id);
    bw.writeShort(cur);
    sendPacket(PackId.Skill, 61, bw.toBuffer());
    recalcStats(configLoader, st);
    sendAttrsDiff(ctx);
  }
}

function handleFubenPacket(ctx, msgId, payload) {
  const { st, sendPacket, configLoader } = ctx;
  if (!st) return;
  const br = new ByteReader(payload);

  if (msgId === 1) {
    // sendGuaJiChallenge: start Boss challenge on current challengeGuanId
    clearLiveMonsters(ctx);
    st.guaji.inBossFight = true;

    const bwShow = new ByteWriter();
    bwShow.writeUByte(1);
    bwShow.writeInt(0);
    sendPacket(PackId.Fuben, 223, bwShow.toBuffer());

    const bossPosCfg = configLoader.get('cfg_GuajiFubenBossPosConfig') || {};
    const posEntry = bossPosCfg[st.guaji.challengeGuanId] || bossPosCfg['1'];
    const bx = posEntry && posEntry.position ? (posEntry.position.x + 0.5) * 64 : st.x + 220;
    const by = posEntry && posEntry.position ? (posEntry.position.y + 0.5) * 64 : st.y;

    const monsCfg = configLoader.get('cfg_MonstersConfig') || {};
    const bossCfg = monsCfg[String(30000 + st.guaji.challengeGuanId)] || monsCfg['30001'];

    setTimeout(() => {
      if (!ctx.ws || ctx.ws.readyState !== 1) return;
      const boss = spawnServerMonster(ctx, bossCfg, bx, by, true);
      st.guaji.bossHandle = boss.handle;
      startMonsterAiLoop(ctx);
    }, 650);
    return;
  }

  if (msgId === 226) {
    // sendGuaJiEnterFb: advance into current challengeGuanId map
    st.guaji.inBossFight = false;
    const gCfg = (configLoader.get('cfg_GuajiFubenConfig') || {})[st.guaji.challengeGuanId];
    const nextFbId = (gCfg && gCfg.id) || 10000 + st.guaji.challengeGuanId;
    const sp = configLoader.getSpawnPoint(1001);
    enterMapScene(ctx, nextFbId, 1001, sp.px, sp.py);
    return;
  }

  if (msgId === 7) {
    // sendGuaJiKsgj: [byte type] -> Fast battle sweep rewards
    const type = br.readByte();
    st.guaji.ksgjSdCount += 1;
    st.currencies[CurType.gold] += 50000;
    sendCurrencyChange(ctx, CurType.gold, st.currencies[CurType.gold], 1);
    sendExpUpdate(ctx, 25000, 1);

    const bw = new ByteWriter();
    bw.writeUByte(type || 1);
    bw.writeUByte(st.guaji.ksgjSdCount);
    bw.writeShort(2);
    bw.writeItemReward({ type: 0, id: CurType.gold, count: 50000 });
    bw.writeItemReward({ type: 1, id: 310001, count: 25 });
    sendPacket(PackId.Fuben, 7, bw.toBuffer());
    return;
  }

  if (msgId === 9) {
    // sendGuaJiAutoChallenge: [bool]
    st.guaji.isAutoChallenge = br.readBool();
    const bw = new ByteWriter();
    bw.writeBool(st.guaji.isAutoChallenge);
    sendPacket(PackId.Fuben, 9, bw.toBuffer());
    return;
  }

  if (msgId === 10) {
    // sendGuaJiReward: [short worldMapIdx]
    const idx = br.readShort();
    st.guaji.maxClaimedWorldIdx = Math.max(st.guaji.maxClaimedWorldIdx, idx);
    st.currencies[CurType.yb] += 100;
    sendCurrencyChange(ctx, CurType.yb, st.currencies[CurType.yb], 0);
    const bw = new ByteWriter();
    bw.writeShort(idx);
    sendPacket(PackId.Fuben, 10, bw.toBuffer());
    return;
  }

  if (msgId === 4) {
    // Client VirtualServer sendCreatMonsters fallback
    const { mobs } = configLoader.getGuajiMonstersForGuan(st.guaji.challengeGuanId);
    const m = mobs[0] || { id: 30001 };
    const bw = new ByteWriter();
    bw.writeUByte(0);
    bw.writeInt(1);
    bw.writeInt(m.id);
    bw.writeInt(3);
    bw.writeInt(0);
    sendPacket(PackId.Fuben, 4, bw.toBuffer());
    return;
  }

  if (msgId === 64 || msgId === 63 || msgId === 65) {
    // Daily dungeon Fight/Sweep -> complete immediately with ResultWin (53, 41)
    const groupId = br.readInt();
    st.currencies[CurType.gold] += 25000;
    sendCurrencyChange(ctx, CurType.gold, st.currencies[CurType.gold], 1);
    const bw = new ByteWriter();
    bw.writeBool(true);
    bw.writeByte(1);
    bw.writeInt(10);
    bw.writeShort(1);
    bw.writeByte(0);
    bw.writeInt(CurType.gold);
    bw.writeDouble(25000);
    bw.writeDouble(0);
    bw.writeDouble(0);
    bw.writeDouble(10000);
    sendPacket(PackId.Fuben, 41, bw.toBuffer());
    return;
  }

  if (msgId === 21 || msgId === 22) {
    // JueWang / Despair Boss Info
    const bw = new ByteWriter();
    bw.writeShort(5);
    bw.writeShort(0);
    bw.writeInt(0);
    sendPacket(PackId.Fuben, 21, bw.toBuffer());
    return;
  }
}

function handleConfigPacket(ctx, msgId, payload) {
  const { configLoader, sendPacket } = ctx;
  const br = new ByteReader(payload);
  const monsCfg = configLoader.get('cfg_MonstersConfig') || {};

  if (msgId === 1 || msgId === 5) {
    const count = br.readShort();
    const list = [];
    for (let i = 0; i < count; i++) {
      const id = br.readInt();
      if (monsCfg[id]) list.push(monsCfg[id]);
    }
    const bw = new ByteWriter();
    bw.writeShort(list.length);
    for (const m of list) {
      if (msgId === 1) {
        bw.writeInt(m.id);
        bw.writeString(m.name || 'Monster');
        bw.writeDouble(m.HpMax || 1000);
        bw.writeInt(m.AtkMin || 100);
        bw.writeInt(m.AtkMax || 120);
        bw.writeInt(m.Def || 0);
        bw.writeInt(m.AtkSuc || 500);
        bw.writeInt(m.DefSuc || 0);
        bw.writeInt(m.MvSpeed || 3500);
        bw.writeInt(m.AtkSpeed || 0);
        const av = Array.isArray(m.avatar) ? m.avatar : [15];
        bw.writeUByte(av.length);
        for (const a of av) bw.writeShort(a);
        bw.writeString(m.head || 'monhead100806');
        bw.writeInt(m.ai || 10001);
        bw.writeByte(m.type || 0);
        bw.writeByte(m.hpViewType || 1);
      } else {
        bw.writeInt(m.id);
        bw.writeString(m.name || 'Monster');
        bw.writeString(m.head || 'monhead100806');
        const av = Array.isArray(m.avatar) ? m.avatar : [15];
        bw.writeUByte(av.length);
        for (const a of av) bw.writeShort(a);
        bw.writeByte(m.type || 0);
      }
    }
    sendPacket(PackId.Config, msgId, bw.toBuffer());
  }
}

module.exports = {
  sendAttrsDiff,
  sendCurrencyChange,
  sendExpUpdate,
  sendSkillInit,
  sendGuajiInfo,
  enterMapScene,
  handleDefaultPacket,
  handleSkillPacket,
  handleFubenPacket,
  handleConfigPacket,
};
