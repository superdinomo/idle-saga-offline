'use strict';

const { PackId } = require('./opcodes');
const { ByteWriter, ByteReader, toMiniDateTime } = require('./packet');
const { JOB_ACTIVE_SKILLS, createHeroState } = require('./session_state');

const FIRST_NAMES = ['Aiden', 'Lyra', 'Kael', 'Seraphina', 'Vance', 'Elara', 'Theron', 'Sylvi', 'Dorian', 'Nyx'];
const LAST_NAMES = ['Dawnblade', 'Starfall', 'Shadowbane', 'Ironheart', 'Stormborn', 'Lightbringer'];

function buildSelectRoleListPacket(accounts, selectedUser) {
  const bw = new ByteWriter();
  const roles = accounts.getRoles(selectedUser);
  bw.writeInt(accounts.getAccountId(selectedUser));
  bw.writeByte(0); // errIndex === 0 (success)
  bw.writeUByte(roles.length);
  for (const r of roles) {
    // SelectRoleDataDetail.parser: int actorid, str actorName, int job, int level, double power, int vip, str createRoleTime
    bw.writeInt(r.actorId);
    bw.writeString(r.name);
    bw.writeInt(r.job);
    bw.writeInt(r.level);
    bw.writeDouble(r.power);
    bw.writeInt(r.sVipLv);
    bw.writeString(new Date(r.createRoleTime * 1000).toISOString());
  }
  return bw.toBuffer();
}

function sendInitBurst(ctx) {
  const { sendPacket, st, configLoader, handlersWorld, handlersInventory, handlersSystems } = ctx;

  // 1. Server Time & Open Server Day
  {
    const bw = new ByteWriter();
    bw.writeUInt(toMiniDateTime());
    sendPacket(PackId.Default, 14, bw.toBuffer());

    const bw2 = new ByteWriter();
    bw2.writeInt(st.openDays);
    bw2.writeInt(toMiniDateTime(Date.now() - 86400 * 1000));
    sendPacket(PackId.Default, 23, bw2.toBuffer());
  }

  // 2. VIP Init (19, 1) BEFORE ActorInfo so sVipLv / vipAwardStates exist
  handlersSystems.sendVipInit(ctx);

  // 3. ActorInfo (0, 1)
  {
    const bw = new ByteWriter();
    bw.writeDouble(st.handleActor);
    bw.writeInt(st.actorId);
    bw.writeInt(st.serverId);
    bw.writeString(st.serverName);
    bw.writeString(st.name);
    bw.writeShort(st.job);
    bw.writeInt(st.level);
    bw.writeDouble(st.exp);
    bw.writeDouble(st.power);
    bw.writeDouble(st.currencies[1] || 0);
    bw.writeDouble(st.currencies[2] || 0);
    bw.writeDouble(st.currencies[27] || 0);
    bw.writeInt(st.sVipLv);
    bw.writeDouble(st.currencies[6] || 0);
    bw.writeInt(st.bagNum);
    bw.writeDouble(st.currencies[3] || 0);
    bw.writeDouble(st.currencies[28] || 0);
    bw.writeDouble(st.currencies[4] || 0);
    bw.writeInt(0);
    bw.writeAttrs(st.attrs);
    sendPacket(PackId.Default, 1, bw.toBuffer());
  }

  // 4. Currency Init (0, 27) & LvExp (0, 26)
  {
    const curKeys = Object.keys(st.currencies);
    const bw = new ByteWriter();
    bw.writeUByte(curKeys.length);
    for (const k of curKeys) {
      bw.writeShort(Number(k));
      bw.writeDouble(st.currencies[k]);
    }
    sendPacket(PackId.Default, 27, bw.toBuffer());

    const bwExp = new ByteWriter();
    bwExp.writeInt(st.level);
    bwExp.writeDouble(st.exp);
    bwExp.writeDouble(st.totalExp);
    sendPacket(PackId.Default, 26, bwExp.toBuffer());
  }

  // 5. Bag & Equip & Forge init BEFORE map entities
  handlersInventory.sendAllBagAndEquipInit(ctx);

  // 6. Skills, SQXY (ShenQi/Wing/Sz/Meilin), JingLing (Damon/Yongbing/Shenmo), JobSys, TouXian, Task, Fuli, Mail, JJC, Rank, Title, Notice
  handlersWorld.sendSkillInit(ctx);
  handlersSystems.sendAllSysDataInit(ctx);

  // 7. Guaji Fuben info (53, 0) & Fuben map enter (0, 3) & RefreshConfig (75, 4) BEFORE entity creation (0, 4)
  handlersWorld.sendGuajiInfo(ctx);
  handlersWorld.enterMapScene(ctx, st.fbId, st.mapId, st.x, st.y);

  // 8. Final patchAllSysInit (0, 56) triggers RpFun.doAllSysInit()!
  sendPacket(PackId.Default, 56, Buffer.alloc(0));
}

function handleLoginPacket(ctx, msgId, payload) {
  const { sendPacket, accounts, configLoader } = ctx;
  const br = new ByteReader(payload);

  if (msgId === 1) {
    // sendCheckAccount: [int srvid, str user, str spverify]
    const srvid = br.readInt();
    const user = br.readString() || 'commander';
    br.readString();
    ctx.user = user;
    ctx.serverId = srvid || 1;
    const bw = new ByteWriter();
    bw.writeUByte(0); // success
    sendPacket(PackId.Login, 1, bw.toBuffer());
    return;
  }

  if (msgId === 4) {
    // sendRoleList
    const pf = br.readString();
    const pfid = br.readString();
    const appid = br.readString();
    const isnew = br.readUByte();
    ctx.pfInfo = { pf, pfid, appid, isnew };
    const pkt = buildSelectRoleListPacket(accounts, ctx.user || 'commander');
    sendPacket(PackId.Login, 4, pkt);
    return;
  }

  if (msgId === 6) {
    // sendRandomName: [byte sex]
    const sex = br.readUByte();
    const n1 = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const n2 = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    const bw = new ByteWriter();
    bw.writeUByte(0);
    bw.writeUByte(sex);
    bw.writeString(`${n1}${n2}`);
    sendPacket(PackId.Login, 6, bw.toBuffer());
    return;
  }

  if (msgId === 2 || msgId === 10) {
    // sendCreateRole / sendCreateRole1: [str name, byte job, byte sex, ...]
    const name = br.readString() || 'Commander';
    const job = br.readByte() || 1;
    const actorId = accounts.nextActorId();
    const st = createHeroState(configLoader, {
      actorId,
      name,
      job: JOB_ACTIVE_SKILLS[job] ? job : 1,
      preset: accounts.defaultPreset,
    });
    accounts.addRole(ctx.user || 'commander', st);

    const bw = new ByteWriter();
    bw.writeByte(0);
    bw.writeInt(st.actorId);
    bw.writeString(st.name);
    bw.writeUInt(toMiniDateTime(st.createRoleTime * 1000));
    sendPacket(PackId.Login, 2, bw.toBuffer());
    return;
  }

  if (msgId === 5) {
    // sendEnterGame: [int actorId, ...]
    const actorId = br.readInt();
    let st = accounts.findRole(ctx.user || 'commander', actorId);
    if (!st) {
      st = createHeroState(configLoader, {
        actorId: actorId || accounts.nextActorId(),
        preset: accounts.defaultPreset,
      });
      accounts.addRole(ctx.user || 'commander', st);
    }
    ctx.st = st;

    const bw = new ByteWriter();
    bw.writeUByte(0); // enter game ok
    sendPacket(PackId.Login, 5, bw.toBuffer());

    // Push complete initial world and character state
    sendInitBurst(ctx);
    return;
  }

  // Fallback for unknown Login sub-message
  console.log(`[Login] Unhandled msgId=${msgId}`);
}

module.exports = {
  handleLoginPacket,
  sendInitBurst,
};
