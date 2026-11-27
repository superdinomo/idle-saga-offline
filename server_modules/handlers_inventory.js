'use strict';

const { PackId, CurType } = require('./opcodes');
const { ByteWriter, ByteReader } = require('./packet');
const { recalcStats } = require('./session_state');

function sendBagSnapshot(ctx, bagType, list, replace = 0) {
  const bw = new ByteWriter();
  bw.writeUByte(replace);
  bw.writeUByte(bagType);
  bw.writeInt(list.length);
  for (const it of list) {
    bw.writeItemData(it);
  }
  ctx.sendPacket(PackId.Bag, 1, bw.toBuffer());
}

function sendAllBagAndEquipInit(ctx) {
  const { st, sendPacket } = ctx;

  // 1. BagData (3, 1): bagType 0 = Other/Items, 1 = Equip, 2 = XunBao
  sendBagSnapshot(ctx, 0, st.bagOthers, 0);
  sendBagSnapshot(ctx, 1, st.bagEquips, 0);
  sendBagSnapshot(ctx, 2, [], 0);

  // 2. EquipList (4, 4)
  {
    const bw = new ByteWriter();
    bw.writeUByte(st.equips.length);
    for (const id of st.equips) bw.writeInt(id);
    sendPacket(PackId.Equip, 4, bw.toBuffer());
  }

  // 3. RongLian (4, 5) & HuFu (4, 20)
  {
    const bwRl = new ByteWriter();
    bwRl.writeInt(st.ronglianLv);
    bwRl.writeInt(st.ronglianExp);
    sendPacket(PackId.Equip, 5, bwRl.toBuffer());

    const bwHf = new ByteWriter();
    bwHf.writeShort(st.hufuRank);
    sendPacket(PackId.Equip, 20, bwHf.toBuffer());
  }

  // 4. ForgeSys (52): Strengthen (52,6), Add (52,8), Suit (52,11), God (52,13), GodWake (52,16), Gem (52,21), Enchant (52,31), TianMo (52,41), Purify (52,61)
  {
    const bwStr = new ByteWriter();
    bwStr.writeByte(st.strengthenDaRenLv);
    bwStr.writeByte(st.strengthenDaShiLv);
    for (let i = 0; i < 10; i++) bwStr.writeShort(st.strengthen[i] || 0);
    sendPacket(PackId.Forge, 6, bwStr.toBuffer());

    const bwAdd = new ByteWriter();
    bwAdd.writeUByte(10);
    for (let i = 0; i < 10; i++) bwAdd.writeShort(st.addLv[i] || 0);
    bwAdd.writeUByte(6);
    for (let i = 0; i < 6; i++) bwAdd.writeInt(0);
    sendPacket(PackId.Forge, 8, bwAdd.toBuffer());

    const bwSuit = new ByteWriter();
    bwSuit.writeUByte(0);
    sendPacket(PackId.Forge, 11, bwSuit.toBuffer());

    const bwGod = new ByteWriter();
    bwGod.writeUByte(10);
    for (let i = 0; i < 10; i++) {
      bwGod.writeByte(i);
      bwGod.writeShort(st.godLv[i] || 0);
    }
    bwGod.writeByte(st.godAddId);
    sendPacket(PackId.Forge, 13, bwGod.toBuffer());

    const bwWake = new ByteWriter();
    bwWake.writeUByte(10);
    for (let i = 0; i < 10; i++) {
      bwWake.writeByte(i);
      bwWake.writeByte(st.godWakeLv[i] || 0);
    }
    bwWake.writeByte(st.godWakeAddId);
    sendPacket(PackId.Forge, 16, bwWake.toBuffer());

    const bwGem = new ByteWriter();
    bwGem.writeShort(st.gemAttrPlusLv);
    bwGem.writeUByte(10);
    for (let pos = 0; pos < 10; pos++) {
      bwGem.writeByte(pos);
      bwGem.writeUByte(3);
      for (let slot = 0; slot < 3; slot++) {
        bwGem.writeByte(slot + 1);
        bwGem.writeInt((st.gems[pos] && st.gems[pos][slot]) || 0);
      }
    }
    sendPacket(PackId.Forge, 21, bwGem.toBuffer());

    const bwEnch = new ByteWriter();
    bwEnch.writeUByte(10);
    for (let pos = 0; pos < 10; pos++) {
      bwEnch.writeByte(pos);
      bwEnch.writeUByte(4);
      for (let pt = 0; pt < 4; pt++) {
        bwEnch.writeByte(pt + 1);
        bwEnch.writeShort((st.fumo[pos] && st.fumo[pos][pt]) || 0);
      }
    }
    sendPacket(PackId.Forge, 31, bwEnch.toBuffer());

    const bwTm = new ByteWriter();
    bwTm.writeUByte(st.tianmo.length);
    for (const t of st.tianmo) {
      bwTm.writeByte(t.pos);
      bwTm.writeShort(t.star);
      bwTm.writeShort(t.rank);
      bwTm.writeBool(t.isAct);
    }
    sendPacket(PackId.Forge, 41, bwTm.toBuffer());

    const bwPur = new ByteWriter();
    bwPur.writeUByte(10);
    for (let i = 0; i < 10; i++) {
      bwPur.writeByte(i);
      bwPur.writeShort(st.purifyLv[i] || 0);
    }
    bwPur.writeShort(st.purifyDaRenLv);
    bwPur.writeShort(st.purifyDaShiLv);
    sendPacket(PackId.Forge, 61, bwPur.toBuffer());
  }
}

function giveItem(ctx, itemId, count, bagType = 0, showTip = 1) {
  const { st, sendPacket, configLoader } = ctx;
  const itemsCfg = configLoader.get('cfg_ItemConfig') || {};
  const cfg = itemsCfg[itemId];
  const actualBagType = cfg && cfg.type === 0 ? 1 : bagType;
  const list = actualBagType === 1 ? st.bagEquips : st.bagOthers;

  if (actualBagType === 0) {
    const existing = list.find((x) => x.id === itemId);
    if (existing) {
      existing.count += count;
      const bw = new ByteWriter();
      bw.writeUByte(actualBagType);
      bw.writeDouble(existing.handle);
      bw.writeInt(existing.count);
      bw.writeUByte(showTip);
      bw.writeUByte(0);
      sendPacket(PackId.Bag, 5, bw.toBuffer());
      return existing;
    }
  }

  const countToAdd = actualBagType === 1 ? Math.max(1, count) : count;
  const item = { handle: st.allocItemHandle(), id: itemId, count: countToAdd, miniKeepTime: 0 };
  list.push(item);

  const bw = new ByteWriter();
  bw.writeUByte(actualBagType);
  bw.writeItemData(item);
  bw.writeUByte(showTip);
  bw.writeUByte(0);
  sendPacket(PackId.Bag, 4, bw.toBuffer());
  return item;
}

function consumeItem(ctx, itemId, amount, bagType = 0) {
  const { st, sendPacket } = ctx;
  const list = bagType === 1 ? st.bagEquips : st.bagOthers;
  const idx = list.findIndex((x) => x.id === itemId);
  if (idx < 0 || list[idx].count < amount) return false;
  list[idx].count -= amount;
  const it = list[idx];
  if (it.count <= 0) {
    list.splice(idx, 1);
    const bw = new ByteWriter();
    bw.writeUByte(bagType);
    bw.writeDouble(it.handle);
    sendPacket(PackId.Bag, 3, bw.toBuffer());
  } else {
    const bw = new ByteWriter();
    bw.writeUByte(bagType);
    bw.writeDouble(it.handle);
    bw.writeInt(it.count);
    bw.writeUByte(0);
    bw.writeUByte(0);
    sendPacket(PackId.Bag, 5, bw.toBuffer());
  }
  return true;
}

function handleBagPacket(ctx, msgId, payload) {
  const { st, sendPacket, handlersWorld } = ctx;
  if (!st) return;
  const br = new ByteReader(payload);

  if (msgId === 2) {
    const addSlots = br.readInt() || 10;
    st.bagNum += addSlots;
    const bw = new ByteWriter();
    bw.writeInt(st.bagNum);
    sendPacket(PackId.Bag, 2, bw.toBuffer());
    return;
  }

  if (msgId === 6) {
    // sendUseItem: [int id, int count, byte type]
    const id = br.readInt();
    const count = Math.max(1, br.readInt());
    consumeItem(ctx, id, count, 0);
    st.currencies[CurType.gold] += 5000 * count;
    handlersWorld.sendCurrencyChange(ctx, CurType.gold, st.currencies[CurType.gold], 0);
    const bw = new ByteWriter();
    bw.writeInt(id);
    bw.writeInt(count);
    sendPacket(PackId.Bag, 6, bw.toBuffer());
  }
}

function handleEquipPacket(ctx, msgId, payload) {
  const { st, sendPacket, configLoader, handlersWorld, handlersSystems } = ctx;
  if (!st) return;
  const br = new ByteReader(payload);
  const itemsCfg = configLoader.get('cfg_ItemConfig') || {};

  if (msgId === 1) {
    // sendWearEquipment: [int itemId]
    const itemId = br.readInt();
    const cfg = itemsCfg[itemId];
    if (!cfg || cfg.subType < 0 || cfg.subType >= 10) return;
    const pos = cfg.subType;
    const oldId = st.equips[pos];
    consumeItem(ctx, itemId, 1, 1);
    if (oldId > 0) giveItem(ctx, oldId, 1, 1, 0);
    st.equips[pos] = itemId;

    const bw = new ByteWriter();
    bw.writeShort(pos);
    bw.writeInt(itemId);
    sendPacket(PackId.Equip, 1, bw.toBuffer());

    recalcStats(configLoader, st);
    handlersWorld.sendAttrsDiff(ctx);
    handlersSystems.onGameEvent(ctx, 'equip_count', { count: st.equips.filter((id) => id > 0).length });
    return;
  }

  if (msgId === 6) {
    // sendOneKeyEquip: [byte count, int[] itemIds]
    const cnt = br.readUByte();
    for (let i = 0; i < cnt; i++) {
      const itemId = br.readInt();
      const cfg = itemsCfg[itemId];
      if (!cfg || cfg.subType < 0 || cfg.subType >= 10) continue;
      const pos = cfg.subType;
      const oldId = st.equips[pos];
      consumeItem(ctx, itemId, 1, 1);
      if (oldId > 0) giveItem(ctx, oldId, 1, 1, 0);
      st.equips[pos] = itemId;
      const bw = new ByteWriter();
      bw.writeShort(pos);
      bw.writeInt(itemId);
      sendPacket(PackId.Equip, 1, bw.toBuffer());
    }
    recalcStats(configLoader, st);
    handlersWorld.sendAttrsDiff(ctx);
    handlersSystems.onGameEvent(ctx, 'equip_count', { count: st.equips.filter((id) => id > 0).length });
    return;
  }

  if (msgId === 2) {
    // Smelt bag equips
    let firstInt = br.readInt();
    let handles = [];
    if (payload.length >= 8 && br.remaining >= 4) {
      const cnt = br.readInt();
      for (let i = 0; i < cnt && br.remaining >= 8; i++) handles.push(br.readDouble());
    } else {
      br.pos = 0;
      const cnt = br.readShort();
      for (let i = 0; i < cnt && br.remaining >= 8; i++) handles.push(br.readDouble());
    }
    let smelted = 0;
    for (const h of handles) {
      const idx = st.bagEquips.findIndex((it) => it.handle === h);
      if (idx >= 0) {
        st.bagEquips.splice(idx, 1);
        const bwDel = new ByteWriter();
        bwDel.writeUByte(1);
        bwDel.writeDouble(h);
        sendPacket(PackId.Bag, 3, bwDel.toBuffer());
        smelted++;
      }
    }
    st.ronglianExp += smelted * 50;
    while (st.ronglianExp >= 200) {
      st.ronglianExp -= 200;
      st.ronglianLv += 1;
    }
    const bwRl = new ByteWriter();
    bwRl.writeInt(st.ronglianLv);
    bwRl.writeInt(st.ronglianExp);
    sendPacket(PackId.Equip, 5, bwRl.toBuffer());
    if (smelted > 0) giveItem(ctx, 310001, smelted * 5, 0, 1);
    return;
  }

  if (msgId === 21) {
    st.hufuRank += 1;
    const bw = new ByteWriter();
    bw.writeShort(st.hufuRank);
    sendPacket(PackId.Equip, 20, bw.toBuffer());
    recalcStats(configLoader, st);
    handlersWorld.sendAttrsDiff(ctx);
  }
}

function handleForgePacket(ctx, msgId, payload) {
  const { st, sendPacket, configLoader, handlersWorld } = ctx;
  if (!st) return;
  const br = new ByteReader(payload);

  if (msgId === 1) {
    // sendUpGrade (strengthen): [byte pos] -> patchstrengthenUpdate: [byte pos, short lv]
    const pos = br.readByte();
    if (pos < 0 || pos >= 10) return;
    st.strengthen[pos] = (st.strengthen[pos] || 0) + 1;
    consumeItem(ctx, 310001, 5, 0);
    const bw = new ByteWriter();
    bw.writeByte(pos);
    bw.writeShort(st.strengthen[pos]);
    sendPacket(PackId.Forge, 1, bw.toBuffer());
    recalcStats(configLoader, st);
    handlersWorld.sendAttrsDiff(ctx);
    return;
  }

  if (msgId === 9) {
    // sendStrengthenOneKey -> increment lowest equipped slot
    let minPos = 0;
    for (let i = 1; i < 10; i++) {
      if ((st.strengthen[i] || 0) < (st.strengthen[minPos] || 0)) minPos = i;
    }
    st.strengthen[minPos] = (st.strengthen[minPos] || 0) + 1;
    consumeItem(ctx, 310001, 5, 0);
    const bw = new ByteWriter();
    for (let i = 0; i < 10; i++) bw.writeShort(st.strengthen[i] || 0);
    sendPacket(PackId.Forge, 9, bw.toBuffer());
    recalcStats(configLoader, st);
    handlersWorld.sendAttrsDiff(ctx);
    return;
  }

  if (msgId === 2) {
    const pos = br.readByte();
    if (pos < 0 || pos >= 10) return;
    st.addLv[pos] = (st.addLv[pos] || 0) + 1;
    consumeItem(ctx, 310005, 5, 0);
    const bw = new ByteWriter();
    bw.writeUByte(1);
    bw.writeByte(pos);
    bw.writeShort(st.addLv[pos]);
    sendPacket(PackId.Forge, 2, bw.toBuffer());
    recalcStats(configLoader, st);
    handlersWorld.sendAttrsDiff(ctx);
    return;
  }

  if (msgId === 62) {
    const pos = br.readByte();
    if (pos < 0 || pos >= 10) return;
    st.purifyLv[pos] = (st.purifyLv[pos] || 0) + 1;
    const bw = new ByteWriter();
    bw.writeBool(true);
    bw.writeByte(pos);
    bw.writeShort(st.purifyLv[pos]);
    sendPacket(PackId.Forge, 62, bw.toBuffer());
    recalcStats(configLoader, st);
    handlersWorld.sendAttrsDiff(ctx);
    return;
  }

  if (msgId === 32) {
    const pos = br.readByte();
    const pt = br.readByte();
    if (pos >= 0 && pos < 10 && pt >= 1 && pt <= 4) {
      st.fumo[pos][pt - 1] += 1;
      const bw = new ByteWriter();
      bw.writeBool(true);
      bw.writeByte(pos);
      bw.writeByte(pt);
      bw.writeShort(st.fumo[pos][pt - 1]);
      sendPacket(PackId.Forge, 32, bw.toBuffer());
    }
    return;
  }

  if (msgId === 22 || msgId === 24) {
    const pos = br.readByte();
    const slot = br.readByte();
    const gemId = msgId === 22 ? br.readInt() : ((st.gems[pos] && st.gems[pos][slot - 1]) || 601001) + 1;
    if (pos >= 0 && pos < 10 && slot >= 1 && slot <= 3) {
      st.gems[pos][slot - 1] = gemId;
      const bw = new ByteWriter();
      bw.writeByte(pos);
      bw.writeByte(slot);
      bw.writeInt(gemId);
      sendPacket(PackId.Forge, 25, bw.toBuffer());
      recalcStats(configLoader, st);
      handlersWorld.sendAttrsDiff(ctx);
    }
  }
}

function handleShopPacket(ctx, msgId, payload) {
  const { st, configLoader, handlersWorld } = ctx;
  if (!st) return;
  const br = new ByteReader(payload);
  const storeCfg = configLoader.get('cfg_StoreItemConfig') || {};

  if (msgId === 2) {
    const cnt = br.readInt();
    for (let i = 0; i < cnt; i++) {
      const idx = br.readInt();
      const qty = Math.max(1, br.readInt());
      const entry = storeCfg[idx];
      if (!entry) continue;
      const totalCost = (entry.price || 0) * qty;
      const curType = entry.needItemId || CurType.yb;
      if ((st.currencies[curType] || 0) >= totalCost) {
        st.currencies[curType] -= totalCost;
        handlersWorld.sendCurrencyChange(ctx, curType, st.currencies[curType], 1);
      }
      if (entry.itemId < 100) {
        st.currencies[entry.itemId] = (st.currencies[entry.itemId] || 0) + (entry.count || 1) * qty;
        handlersWorld.sendCurrencyChange(ctx, entry.itemId, st.currencies[entry.itemId], 0);
      } else {
        giveItem(ctx, entry.itemId, (entry.count || 1) * qty, 0, 1);
      }
    }
  }
}

module.exports = {
  sendAllBagAndEquipInit,
  giveItem,
  consumeItem,
  handleBagPacket,
  handleEquipPacket,
  handleForgePacket,
  handleShopPacket,
};
