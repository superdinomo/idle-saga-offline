'use strict';

const { PackId, CurType } = require('./opcodes');
const { ByteWriter, ByteReader } = require('./packet');
const { recalcStats } = require('./session_state');

function sendVipInit(ctx) {
  const { st, sendPacket } = ctx;
  const bw = new ByteWriter();
  bw.writeUByte(st.sVipLv);
  bw.writeInt(st.sVipExp);
  bw.writeInt(0); // sVipAwardStates bitmask
  bw.writeInt(0); // sVipGiftState bitmask
  bw.writeUByte(st.vipLv);
  bw.writeInt(0); // vipAwardStates bitmask
  bw.writeInt(0); // sVipEveryDayAwardState bitmask
  sendPacket(PackId.Vip, 1, bw.toBuffer());
}

function writeSqXyModel(bw, model) {
  bw.writeInt(model.huanHuaId);
  bw.writeShort(Math.max(1, model.level));
  bw.writeUByte(0); // huanHua count
  bw.writeUByte(0); // fuHun count
  bw.writeUByte(0); // gm count
}

function writeDamonBaseModel(bw, model) {
  bw.writeInt(model.useId || 0);
  bw.writeShort(model.moZhenId || 0);
  bw.writeShort(Math.max(1, model.level));
  bw.writeInt(model.levelExp || 0);
  bw.writeShort(model.stageLevel || 0);
  bw.writeInt(model.stageExp || 0);
  bw.writeUByte(0); // huanHua count
  bw.writeUByte(0); // yinJi count
  bw.writeUByte(0); // moZhen count
  bw.writeUByte(0); // gm count
}

function sendMainTaskUpdate(ctx, showGuide = true) {
  const { st, sendPacket } = ctx;
  const bw = new ByteWriter();
  bw.writeInt(st.mainTask.id);
  bw.writeInt(st.mainTask.status);
  bw.writeInt(st.mainTask.value);
  bw.writeBool(showGuide);
  sendPacket(PackId.Task, 1, bw.toBuffer());
}

function sendMailList(ctx) {
  const { st, sendPacket } = ctx;
  const bw = new ByteWriter();
  bw.writeInt(st.mails.length);
  for (const m of st.mails) {
    bw.writeInt(m.handle);
    bw.writeString(m.title);
    bw.writeInt(m.times);
    bw.writeInt(m.type);
    bw.writeInt(m.receive);
  }
  sendPacket(PackId.Mail, 1, bw.toBuffer());
}

function sendAllSysDataInit(ctx) {
  const { st, sendPacket, configLoader } = ctx;

  // SQXY (49): ShenQi(1), Wing(11), Sz(21), Meilin(31)
  {
    const bw1 = new ByteWriter(); writeSqXyModel(bw1, st.shenqi); sendPacket(PackId.SQXY, 1, bw1.toBuffer());
    const bw2 = new ByteWriter(); writeSqXyModel(bw2, st.wing); sendPacket(PackId.SQXY, 11, bw2.toBuffer());
    const bw3 = new ByteWriter(); writeSqXyModel(bw3, st.sz); sendPacket(PackId.SQXY, 21, bw3.toBuffer());
    const bw4 = new ByteWriter(); writeSqXyModel(bw4, st.meilin); sendPacket(PackId.SQXY, 31, bw4.toBuffer());
  }

  // JingLing (57): Damon(1), Yongbing(11), Shenmo(31)
  {
    const bw1 = new ByteWriter(); writeDamonBaseModel(bw1, st.damon); sendPacket(PackId.JingLing, 1, bw1.toBuffer());
    const bw2 = new ByteWriter(); writeDamonBaseModel(bw2, st.yongbing); sendPacket(PackId.JingLing, 11, bw2.toBuffer());
    const bw3 = new ByteWriter(); writeDamonBaseModel(bw3, st.shenmo); sendPacket(PackId.JingLing, 31, bw3.toBuffer());
  }

  // JobSys (55): QiJizl(31), Gnyg(33), WordLevel(65), ZSData(70)
  {
    const bwQ = new ByteWriter();
    bwQ.writeUByte(st.qijiOpenIdxs.length);
    for (const idx of st.qijiOpenIdxs) bwQ.writeUByte(idx);
    sendPacket(PackId.AttrAdd, 31, bwQ.toBuffer());

    const bwG = new ByteWriter();
    bwG.writeUByte(st.gnygOpenIdxs.length);
    for (const idx of st.gnygOpenIdxs) bwG.writeUByte(idx);
    sendPacket(PackId.AttrAdd, 33, bwG.toBuffer());

    const bwW = new ByteWriter();
    bwW.writeInt(st.level);
    sendPacket(PackId.AttrAdd, 65, bwW.toBuffer());

    const bwZ = new ByteWriter();
    bwZ.writeInt(st.zsId);
    bwZ.writeUByte(st.zsTasks.length);
    for (const t of st.zsTasks) {
      bwZ.writeInt(t.value);
      bwZ.writeByte(t.state);
    }
    sendPacket(PackId.AttrAdd, 70, bwZ.toBuffer());
  }

  // TouXian (70, 1)
  {
    const bw = new ByteWriter();
    bw.writeShort(Math.max(1, st.touxian.level));
    bw.writeInt(st.touxian.value);
    bw.writeShort(10);
    for (let i = 0; i < 10; i++) bw.writeByte(0);
    bw.writeUByte(0); // tasks count
    sendPacket(PackId.TouXian, 1, bw.toBuffer());
  }

  // Task (58): MainTask(1), Chengjiu(31), LiLian(50)
  sendMainTaskUpdate(ctx, false);
  {
    const bwC = new ByteWriter();
    bwC.writeInt(0);
    sendPacket(PackId.Task, 31, bwC.toBuffer());

    const bwL = new ByteWriter();
    bwL.writeShort(Math.max(1, st.lilian.id));
    bwL.writeInt(st.lilian.value);
    bwL.writeUByte(st.lilian.rewardIndex);
    bwL.writeShort(st.lilian.dailyValue);
    bwL.writeUByte(0);
    sendPacket(PackId.Task, 50, bwL.toBuffer());
  }

  // FuLi (36): Signin(24), DailyOnline(30), DLHL(40)
  {
    const bwS = new ByteWriter();
    bwS.writeShort(st.signin.states.length);
    for (const v of st.signin.states) bwS.writeByte(v);
    bwS.writeInt(st.signin.record);
    bwS.writeShort(st.signin.curDay);
    sendPacket(PackId.moneyTree, 24, bwS.toBuffer());

    const elapsedSec = Math.floor((Date.now() - st.dailyOnline.startMs) / 1000);
    const bwO = new ByteWriter();
    bwO.writeInt(st.dailyOnline.mask);
    bwO.writeInt(elapsedSec);
    bwO.writeUByte(st.dailyOnline.type);
    bwO.writeInt(st.dailyOnline.day);
    sendPacket(PackId.moneyTree, 30, bwO.toBuffer());

    const bwD = new ByteWriter();
    bwD.writeByte(1);
    bwD.writeByte(1);
    bwD.writeInt(0);
    sendPacket(PackId.moneyTree, 40, bwD.toBuffer());
  }

  // Mail (8, 1), Notice (20, 6), JJC (73, 1), Rank (72, 7 & 72, 4), Title (77, 1)
  sendMailList(ctx);
  {
    const bwN = new ByteWriter();
    bwN.writeShort(1);
    bwN.writeShort(0);
    bwN.writeString('Welcome to Idle Saga Offline! Progress, skills, gear and dungeons run locally.');
    bwN.writeUByte(0);
    bwN.writeByte(0);
    bwN.writeInt(0);
    sendPacket(PackId.Notice, 6, bwN.toBuffer());

    const bwJ = new ByteWriter();
    bwJ.writeShort(st.jjc.myRank);
    bwJ.writeShort(st.jjc.fightCount);
    bwJ.writeShort(st.jjc.buyCount);
    bwJ.writeInt(st.jjc.cdSec);
    bwJ.writeShort(st.jjc.bestRank);
    sendPacket(PackId.JJC, 1, bwJ.toBuffer());

    const rankTypes = [0, 1, 2, 3, 4, 5, 6];
    const bwR7 = new ByteWriter();
    bwR7.writeUByte(rankTypes.length);
    for (const rt of rankTypes) bwR7.writeUByte(rt);
    sendPacket(PackId.Rank, 7, bwR7.toBuffer());

    const bwR4 = new ByteWriter();
    bwR4.writeShort(0);
    sendPacket(PackId.Rank, 4, bwR4.toBuffer());

    const bwT = new ByteWriter();
    bwT.writeInt(0);
    bwT.writeInt(st.titleShowId || 0);
    sendPacket(PackId.Title, 1, bwT.toBuffer());
  }

  // Fuben Daily counts (53, 62)
  {
    const dailyBase = configLoader.get('cfg_BaseDailyFubenConfig') || {};
    const keys = Object.keys(dailyBase);
    const bwD = new ByteWriter();
    bwD.writeUByte(keys.length);
    for (const k of keys) {
      bwD.writeInt(Number(k));
      bwD.writeInt(10000);
      bwD.writeShort(0);
      bwD.writeShort(0);
      bwD.writeInt(0);
      bwD.writeBool(false);
    }
    // Wait: FbSys.reg(62) patchDailyCountChange - verify count type! If empty or via (53,62), send count=0 as short/int cleanly?
    // Notice patchDailyCountChange was checked via main.min.js earlier; let's keep daily info safe on request.
  }
}

function onGameEvent(ctx, eventType, data) {
  const { st, configLoader } = ctx;
  if (!st || !st.mainTask) return;
  const tasksCfg = configLoader.get('cfg_MainTaskConfig') || {};
  const tCfg = tasksCfg[String(st.mainTask.id)];
  if (!tCfg || st.mainTask.status !== 0) return;

  let progressed = false;
  if (eventType === 'wave_clear' && tCfg.type === 62) {
    st.mainTask.value += 1;
    progressed = true;
  } else if (eventType === 'guaji_boss_clear' && (tCfg.type === 53 || tCfg.type === 16)) {
    st.mainTask.value += 1;
    progressed = true;
  } else if (eventType === 'equip_count' && tCfg.type === 17) {
    st.mainTask.value = data.count;
    progressed = true;
  }

  if (progressed) {
    if (st.mainTask.value >= (tCfg.target || 1)) {
      st.mainTask.value = tCfg.target || 1;
      st.mainTask.status = 1; // Claimable!
    }
    sendMainTaskUpdate(ctx, true);
  }
}

function handleSystemsPacket(ctx, sysId, msgId, payload) {
  const { st, sendPacket, configLoader, handlersWorld, handlersInventory } = ctx;
  if (!st) return;
  const br = new ByteReader(payload);

  if (sysId === PackId.Task) {
    if (msgId === 2) {
      // sendMainTaskOK -> reward + advance to next task!
      const tasksCfg = configLoader.get('cfg_MainTaskConfig') || {};
      const curCfg = tasksCfg[String(st.mainTask.id)];
      if (curCfg) {
        for (const aw of curCfg.awardList || []) {
          if (aw.type === 0) {
            if (aw.id === CurType.exp) handlersWorld.sendExpUpdate(ctx, aw.count, 1);
            else {
              st.currencies[aw.id] = (st.currencies[aw.id] || 0) + aw.count;
              handlersWorld.sendCurrencyChange(ctx, aw.id, st.currencies[aw.id], 0);
            }
          } else {
            handlersInventory.giveItem(ctx, aw.id, aw.count, 0, 1);
          }
        }
        const bwR = new ByteWriter();
        bwR.writeInt(curCfg.id);
        sendPacket(PackId.Task, 3, bwR.toBuffer());

        const nextId = curCfg.next && tasksCfg[String(curCfg.next)] ? curCfg.next : curCfg.id + 1;
        if (tasksCfg[String(nextId)]) {
          st.mainTask = { id: nextId, status: 0, value: 0 };
          if (tasksCfg[String(nextId)].type === 17) {
            const eqCnt = st.equips.filter((id) => id > 0).length;
            st.mainTask.value = eqCnt;
            if (eqCnt >= (tasksCfg[String(nextId)].target || 2)) st.mainTask.status = 1;
          }
        } else {
          st.mainTask.status = 2;
        }
        sendMainTaskUpdate(ctx, true);
      }
    }
    return;
  }

  if (sysId === PackId.SQXY) {
    const map = {
      2: ['shenqi', 2], 5: ['shenqi', 5],
      12: ['wing', 12], 15: ['wing', 15],
      22: ['sz', 22], 25: ['sz', 25],
      32: ['meilin', 32], 35: ['meilin', 35],
    };
    const spec = map[msgId];
    if (!spec) return;
    const [key, replyId] = spec;
    if (msgId % 10 === 2) {
      st[key].level += 1;
      const bw = new ByteWriter();
      bw.writeShort(st[key].level);
      sendPacket(PackId.SQXY, replyId, bw.toBuffer());
    } else if (msgId % 10 === 5) {
      st[key].huanHuaId = br.readInt();
      const bw = new ByteWriter();
      bw.writeInt(st[key].huanHuaId);
      sendPacket(PackId.SQXY, replyId, bw.toBuffer());
    }
    recalcStats(configLoader, st);
    handlersWorld.sendAttrsDiff(ctx);
    return;
  }

  if (sysId === PackId.JingLing) {
    if (msgId === 2 || msgId === 12 || msgId === 32) {
      const mKey = msgId === 2 ? 'damon' : msgId === 12 ? 'yongbing' : 'shenmo';
      st[mKey].level += 1;
      const bw = new ByteWriter();
      bw.writeShort(st[mKey].level);
      bw.writeInt(st[mKey].levelExp);
      sendPacket(PackId.JingLing, msgId, bw.toBuffer());
      recalcStats(configLoader, st);
      handlersWorld.sendAttrsDiff(ctx);
    } else if (msgId === 3 || msgId === 13 || msgId === 33) {
      const mKey = msgId === 3 ? 'damon' : msgId === 13 ? 'yongbing' : 'shenmo';
      st[mKey].stageLevel += 1;
      const bw = new ByteWriter();
      bw.writeShort(st[mKey].stageLevel);
      bw.writeInt(st[mKey].stageExp);
      sendPacket(PackId.JingLing, msgId, bw.toBuffer());
      recalcStats(configLoader, st);
      handlersWorld.sendAttrsDiff(ctx);
    }
    return;
  }

  if (sysId === PackId.Mail) {
    if (msgId === 2) {
      const h = br.readInt();
      const mail = st.mails.find((m) => m.handle === h);
      if (mail) {
        mail.type = 1;
        const bw = new ByteWriter();
        bw.writeInt(mail.handle);
        bw.writeString(mail.title);
        bw.writeInt(mail.times);
        bw.writeInt(mail.type);
        bw.writeInt(mail.receive);
        bw.writeString(mail.text);
        bw.writeInt(mail.items.length);
        for (const it of mail.items) bw.writeItemReward(it);
        sendPacket(PackId.Mail, 2, bw.toBuffer());
      }
    } else if (msgId === 4) {
      const cnt = br.readInt();
      const claimed = [];
      for (let i = 0; i < cnt; i++) {
        const h = br.readInt();
        const mail = st.mails.find((m) => m.handle === h);
        if (mail && mail.receive === 0) {
          mail.receive = 1;
          mail.type = 1;
          claimed.push(h);
          for (const it of mail.items) {
            if (it.type === 0) {
              st.currencies[it.id] = (st.currencies[it.id] || 0) + it.count;
              handlersWorld.sendCurrencyChange(ctx, it.id, st.currencies[it.id], 0);
            } else {
              handlersInventory.giveItem(ctx, it.id, it.count, 0, 1);
            }
          }
        }
      }
      const bw = new ByteWriter();
      bw.writeInt(claimed.length);
      for (const h of claimed) bw.writeInt(h);
      sendPacket(PackId.Mail, 4, bw.toBuffer());
    }
    return;
  }

  if (sysId === PackId.AttrAdd) {
    if (msgId === 32) {
      const idx = br.readInt();
      if (!st.qijiOpenIdxs.includes(idx)) st.qijiOpenIdxs.push(idx);
      const bw = new ByteWriter();
      bw.writeUByte(st.qijiOpenIdxs.length);
      for (const v of st.qijiOpenIdxs) bw.writeUByte(v);
      sendPacket(PackId.AttrAdd, 31, bw.toBuffer());
    } else if (msgId === 73) {
      const zsCfg = configLoader.get('cfg_ZhuanShengLevelConfig') || {};
      const cur = zsCfg[String(st.zsId)];
      if (cur && cur.nextId && zsCfg[String(cur.nextId)]) {
        st.zsId = cur.nextId;
        const bw = new ByteWriter();
        bw.writeInt(st.zsId);
        bw.writeUByte(st.zsTasks.length);
        for (const t of st.zsTasks) {
          bw.writeInt(t.value);
          bw.writeByte(t.state);
        }
        sendPacket(PackId.AttrAdd, 73, bw.toBuffer());
        recalcStats(configLoader, st);
        handlersWorld.sendAttrsDiff(ctx);
      }
    }
    return;
  }

  if (sysId === PackId.Friends && msgId === 1) {
    const fType = br.readUByte();
    const bw = new ByteWriter();
    bw.writeUByte(fType);
    bw.writeShort(0);
    sendPacket(PackId.Friends, 1, bw.toBuffer());
    return;
  }

  if (sysId === PackId.Rank && msgId === 1) {
    const rType = br.readShort();
    const bw = new ByteWriter();
    bw.writeShort(rType);
    bw.writeShort(1); // 1 row: player
    bw.writeShort(1); // rank
    bw.writeInt(st.actorId);
    bw.writeString(st.name);
    bw.writeByte(st.vipLv);
    bw.writeByte(st.sVipLv);
    sendPacket(PackId.Rank, 1, bw.toBuffer());
    return;
  }

  if (sysId === PackId.JJC && msgId === 2) {
    const bw = new ByteWriter();
    bw.writeUByte(0);
    sendPacket(PackId.JJC, 2, bw.toBuffer());
    return;
  }

  if (sysId === PackId.Chat && msgId === 1) {
    const ch = br.readByte();
    const target = br.readUInt();
    const text = br.readString();
    const bw = new ByteWriter();
    bw.writeBool(true);
    sendPacket(PackId.Chat, 3, bw.toBuffer());
    return;
  }
}

module.exports = {
  sendVipInit,
  sendAllSysDataInit,
  onGameEvent,
  handleSystemsPacket,
};
