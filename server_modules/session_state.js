'use strict';

const { AttrType, CurType, EntityType } = require('./opcodes');

const BASE_HERO_HANDLE = 1099511627777; // > 2^31 so client sends server C->S (2,1)
const BASE_ACTOR_HANDLE = 1099511627776;
const BASE_YONGBING_HANDLE = 1099511627778;
const BASE_MONSTER_HANDLE = 2199023255552;
const BASE_ITEM_HANDLE = 3298534883328;

const JOB_ACTIVE_SKILLS = {
  1: [101, 102, 103, 104, 105, 106, 107, 108],
  2: [201, 202, 203, 204, 205, 206, 207, 208],
  3: [301, 302, 303, 304, 305, 306, 307, 308],
};

function createHeroState(configLoader, options = {}) {
  const high = options.preset === 'high';
  const job = [1, 2, 3].includes(Number(options.job)) ? Number(options.job) : 1;
  const name = options.name ? String(options.name) : (high ? 'Overlord' : 'Adventurer');
  const actorId = options.actorId || 10001;
  const nowSec = Math.floor(Date.now() / 1000);

  let nextItemHandle = BASE_ITEM_HANDLE + (actorId % 1000) * 100000;
  const allocItemHandle = () => nextItemHandle++;

  let nextEntityHandle = BASE_MONSTER_HANDLE + 1;
  const allocEntityHandle = () => nextEntityHandle++;

  const spawn = configLoader.getSpawnPoint(high ? 1010 : 1001);

  const equips = high
    ? [101004, 111004, 121004, 131004, 141004, 151004, 161004, 171004, 181507, 191507]
    : [101001, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  const strengthen = high ? [25, 20, 20, 20, 20, 20, 20, 20, 10, 10] : new Array(10).fill(0);
  const addLv = high ? [10, 8, 8, 8, 8, 8, 8, 8, 5, 5] : new Array(10).fill(0);
  const purifyLv = high ? [5, 5, 5, 5, 5, 5, 5, 5, 3, 3] : new Array(10).fill(0);
  const godLv = high ? [3, 2, 2, 2, 2, 2, 2, 2, 0, 0] : new Array(10).fill(0);
  const godWakeLv = high ? [2, 1, 1, 1, 1, 1, 1, 1, 0, 0] : new Array(10).fill(0);
  const panSuitLv = new Array(10).fill(high ? 1 : 0);

  const bagEquips = high
    ? [
        { handle: allocItemHandle(), id: 101003, count: 1, miniKeepTime: 0 },
        { handle: allocItemHandle(), id: 111003, count: 1, miniKeepTime: 0 },
        { handle: allocItemHandle(), id: 121003, count: 1, miniKeepTime: 0 },
      ]
    : [
        { handle: allocItemHandle(), id: 111001, count: 1, miniKeepTime: 0 },
        { handle: allocItemHandle(), id: 121001, count: 1, miniKeepTime: 0 },
        { handle: allocItemHandle(), id: 131001, count: 1, miniKeepTime: 0 },
        { handle: allocItemHandle(), id: 141001, count: 1, miniKeepTime: 0 },
        { handle: allocItemHandle(), id: 151001, count: 1, miniKeepTime: 0 },
      ];

  const bagOthers = [
    { handle: allocItemHandle(), id: 310001, count: high ? 9999 : 500, miniKeepTime: 0 }, // Enhance stone
    { handle: allocItemHandle(), id: 310005, count: high ? 999 : 100, miniKeepTime: 0 },  // Life/Append stone
    { handle: allocItemHandle(), id: 310006, count: high ? 500 : 50, miniKeepTime: 0 },   // Equip foster
    { handle: allocItemHandle(), id: 310019, count: high ? 200 : 20, miniKeepTime: 0 },   // Gear draw ticket
    { handle: allocItemHandle(), id: 310020, count: high ? 200 : 10, miniKeepTime: 0 },   // Soulgear draw ticket
    { handle: allocItemHandle(), id: 1081000, count: high ? 500 : 50, miniKeepTime: 0 },  // Wing feathers
    { handle: allocItemHandle(), id: 310201, count: high ? 200 : 20, miniKeepTime: 0 },   // Rebirth stone
    { handle: allocItemHandle(), id: 340003, count: high ? 50 : 5, miniKeepTime: 0 },     // Demon fortress pass
    { handle: allocItemHandle(), id: 340006, count: high ? 50 : 5, miniKeepTime: 0 },     // Blood Castle pass
  ];

  const activeSkillIds = JOB_ACTIVE_SKILLS[job] || JOB_ACTIVE_SKILLS[1];
  const skills = activeSkillIds.map((id, idx) => ({
    id,
    lv: high ? 30 : (idx < 3 ? 1 : 0),
  }));

  const state = {
    actorId,
    serverId: 1,
    serverName: 'S1 Offline',
    name,
    job,
    sex: job === 2 ? 1 : 0,
    level: high ? 180 : 1,
    exp: 0,
    totalExp: high ? 1800000 : 1000,
    power: 0,
    zsId: high ? 10201 : 10000,
    zsTasks: [
      { state: high ? 2 : 0, value: 0 },
      { state: high ? 2 : 0, value: 0 },
      { state: high ? 2 : 0, value: 0 },
      { state: high ? 2 : 0, value: 0 },
    ],
    createRoleTime: nowSec,
    openDays: 1,
    sVipLv: high ? 5 : 0,
    sVipExp: high ? 15000 : 0,
    vipLv: high ? 5 : 1,
    bagNum: 200,

    handleActor: BASE_ACTOR_HANDLE,
    handleRole: BASE_HERO_HANDLE,
    handleYongbing: BASE_YONGBING_HANDLE,

    fbId: high ? 10010 : 10001,
    mapId: high ? 1010 : 1001,
    x: spawn.px,
    y: spawn.py,
    hp: 100,
    hpMax: 100,

    currencies: {
      [CurType.exp]: 0,
      [CurType.gold]: high ? 50000000 : 100000,
      [CurType.yb]: high ? 250000 : 10000,
      [CurType.feats]: high ? 100000 : 1000,
      [CurType.starsoul]: high ? 50000 : 500,
      [CurType.mojing]: high ? 50000 : 500,
      [CurType.talentValue]: high ? 200000 : 20000,
      [CurType.JinZuan]: high ? 50000 : 1000,
      [CurType.QiyuValue]: high ? 1000 : 0,
    },

    equips,
    bagEquips,
    bagOthers,
    ronglianLv: high ? 10 : 0,
    ronglianExp: 0,
    hufuRank: high ? 3 : 0,

    strengthen,
    strengthenDaRenLv: high ? 3 : 0,
    strengthenDaShiLv: high ? 2 : 0,
    addLv,
    purifyLv,
    purifyDaRenLv: high ? 2 : 0,
    purifyDaShiLv: high ? 1 : 0,
    godLv,
    godAddId: 0,
    godWakeLv,
    godWakeAddId: 0,
    panSuitLv,
    fumo: Array.from({ length: 10 }, () => [0, 0, 0, 0]),
    tianmo: [1, 2, 3, 5].map((pos) => ({ pos, star: high ? 5 : -1, rank: 0, isAct: high })),
    gems: Array.from({ length: 10 }, () => [0, 0, 0]),
    gemAttrPlusLv: 0,
    suitUnlocked: new Map(),

    skills,
    hunqiAwakeLv: high ? 5 : 1,
    hunqiAwakeExp: 0,
    hunqiList: Array.from({ length: 12 }, (_, idx) => ({ id: idx + 1, lv: high ? 3 : 0 })),
    passiveSkills: new Map(),

    guaji: {
      challengeGuanId: high ? 10 : 1,
      helpCount: 0,
      assistCount: 0,
      isAutoChallenge: false,
      boCount: 0,
      maxClaimedWorldIdx: high ? 1 : 0,
      ksgjSdCount: 0,
      ksgjBuyCount: 0,
      killsInWave: 0,
      bossHandle: 0,
      inBossFight: false,
    },

    shenqi: { huanHuaId: high ? 2 : 0, level: high ? 10 : 1 },
    wing: { huanHuaId: high ? 2 : 0, level: high ? 10 : 1 },
    sz: { huanHuaId: high ? 2 : 0, level: high ? 10 : 1 },
    meilin: { huanHuaId: high ? 1 : -1, level: high ? 5 : 1 },

    damon: { useId: high ? 2 : 1, moZhenId: 0, level: high ? 10 : 1, levelExp: 0, stageLevel: high ? 2 : 0, stageExp: 0 },
    yongbing: { useId: high ? 2 : 1, moZhenId: 0, level: high ? 10 : 1, levelExp: 0, stageLevel: high ? 2 : 0, stageExp: 0 },
    shenmo: { useId: high ? 1 : 0, moZhenId: 0, level: high ? 10 : 1, levelExp: 0, stageLevel: high ? 2 : 0, stageExp: 0 },

    touxian: { level: high ? 5 : 1, value: high ? 5000 : 0 },
    qijiOpenIdxs: [],
    gnygOpenIdxs: [],

    mainTask: { id: 1, status: 0, value: 0 },
    lilian: { id: high ? 10 : 1, value: high ? 500 : 0, rewardIndex: 0, dailyValue: 0 },
    signin: { states: Array.from({ length: 30 }, (_, i) => (i === 0 ? 1 : 0)), record: 0, curDay: 1 },
    dailyOnline: { mask: 0, startMs: Date.now(), type: 2, day: 1 },

    jjc: { myRank: 50, bestRank: 50, fightCount: 0, buyCount: 0, cdSec: 0 },
    mails: [
      {
        handle: 1001,
        title: 'Welcome to Idle Saga Offline!',
        times: nowSec,
        type: 0,
        receive: 0,
        text: 'Welcome Commander! Your offline realm is ready with full combat, skills, gear forging, wings, mercenaries, and dungeons.',
        items: [
          { type: 0, id: 2, count: 2000 },
          { type: 0, id: 1, count: 50000 },
          { type: 1, id: 310001, count: 100 },
        ],
      },
    ],

    titleShowId: 0,
    titles: {},

    liveEntities: new Map(),
    liveDrops: new Map(),
    dropSeq: 1,
    allocItemHandle,
    allocEntityHandle,
    nextDropHandle: () => state.dropSeq++,
  };

  recalcStats(configLoader, state);
  return state;
}

function accumulateAttrs(arr, list, mult = 1) {
  if (!Array.isArray(list)) return;
  for (const a of list) {
    if (!a || typeof a.type !== 'number') continue;
    if (a.type >= 0 && a.type < AttrType.atCount) {
      arr[a.type] += (Number(a.value) || 0) * mult;
    }
  }
}

function recalcStats(configLoader, st) {
  const arr = new Array(AttrType.atCount).fill(0);

  // Base hero scaling with level + rebirth
  arr[AttrType.atHpMax] = 4500 + st.level * 600;
  arr[AttrType.atAtkMin] = 350 + st.level * 55;
  arr[AttrType.atAtkMax] = 460 + st.level * 70;
  arr[AttrType.atDef] = 120 + st.level * 25;
  arr[AttrType.atAtkSuc] = 5000 + st.level * 30;
  arr[AttrType.atDefSuc] = 200 + st.level * 10;
  arr[AttrType.atMvSpeed] = 4500;
  arr[AttrType.atAtkSpeed] = 1000;
  arr[AttrType.atZMYJ] = 800;

  const itemsCfg = configLoader.get('cfg_ItemConfig') || {};
  const enhanceCfg = configLoader.get('cfg_EnhanceAttrConfig') || {};
  const appendCfg = configLoader.get('cfg_AppendAttrConfig') || {};
  const stoneCfg = configLoader.get('cfg_StoneConfig') || {};

  for (let pos = 0; pos < st.equips.length; pos++) {
    const eqId = st.equips[pos];
    if (eqId > 0 && itemsCfg[eqId]) {
      accumulateAttrs(arr, itemsCfg[eqId].pattr, 1);
      const sub = itemsCfg[eqId].subType;
      const slv = st.strengthen[pos] || 0;
      if (slv > 0 && enhanceCfg[sub] && enhanceCfg[sub][slv]) {
        accumulateAttrs(arr, enhanceCfg[sub][slv].attr, 1);
      }
      const alv = st.addLv[pos] || 0;
      if (alv > 0 && appendCfg[sub] && appendCfg[sub][alv]) {
        accumulateAttrs(arr, appendCfg[sub][alv].attr, 1);
      }
    }
    for (const gId of st.gems[pos] || []) {
      if (gId > 0 && stoneCfg[gId]) accumulateAttrs(arr, stoneCfg[gId].attr, 1);
    }
  }

  // Convert Atk(32) composite attack into atAtkMin/atAtkMax like client AttrData does
  const sqCfg = configLoader.get('cfg_ShenqiLevelConfig');
  if (sqCfg && sqCfg[st.shenqi.level]) accumulateAttrs(arr, sqCfg[st.shenqi.level].attr, 1);
  const wgCfg = configLoader.get('cfg_WingLevelConfig');
  if (wgCfg && wgCfg[st.wing.level]) accumulateAttrs(arr, wgCfg[st.wing.level].attr, 1);
  const dmCfg = configLoader.get('cfg_DamonLevelConfig');
  if (dmCfg && dmCfg[st.damon.level]) accumulateAttrs(arr, dmCfg[st.damon.level].baseAttrs, 1);
  const ybCfg = configLoader.get('cfg_YongbingLevelConfig');
  if (ybCfg && ybCfg[st.yongbing.level]) accumulateAttrs(arr, ybCfg[st.yongbing.level].baseAttrs, 1);
  const zsCfg = configLoader.get('cfg_ZhuanShengLevelConfig');
  if (zsCfg && zsCfg[st.zsId]) accumulateAttrs(arr, zsCfg[st.zsId].attr, 1);
  const txCfg = configLoader.get('cfg_TouxianConfig');
  if (txCfg && txCfg[st.touxian.level]) accumulateAttrs(arr, txCfg[st.touxian.level].attr, 1);

  // Merge composite Atk(32) into atAtkMin / atAtkMax while keeping Atk(32) for display
  const compositeAtk = arr[AttrType.Atk] || 0;
  arr[AttrType.atAtkMin] += Math.floor(compositeAtk * 0.85);
  arr[AttrType.atAtkMax] += Math.floor(compositeAtk * 1.15);

  const hpMax = Math.max(1000, Math.floor(arr[AttrType.atHpMax]));
  arr[AttrType.atHpMax] = hpMax;
  arr[AttrType.atHp] = hpMax;
  st.hpMax = hpMax;
  st.hp = hpMax;
  st.attrs = arr;

  // Calculate power using cfg_AttrPowerConfig
  const apCfg = configLoader.get('cfg_AttrPowerConfig') || {};
  let power = 0;
  for (let t = 1; t < AttrType.atCount; t++) {
    const val = arr[t];
    if (!val) continue;
    const entry = apCfg[t];
    if (entry && entry.powerC) {
      power += (val * entry.powerC) / 100;
    }
  }
  st.power = Math.max(1200, Math.floor(power));
  return arr;
}

module.exports = {
  JOB_ACTIVE_SKILLS,
  createHeroState,
  recalcStats,
};
