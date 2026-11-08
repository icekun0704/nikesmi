/* 最終ステータスの計算.
 *
 * ゲーム内の育成要素を、実際の計算順で積む:
 *
 *   ① 基礎値           レベル × クラス × 武器
 *   ② 限界突破         基礎に ×(1+0.02×LB) と固定値 +3000HP/+20ATK/+100DEF
 *   ③ 好感度・研究     固定値を加算
 *   ④ コア強化         ここまでに ×(1+0.02×コア)
 *   ⑤ 魔方・装備・コレクション   固定値を加算
 *   ⑥ オーバーロード   最後に % を乗算
 *
 * 「限界突破の2%は基礎にだけ」「コアの2%は装備より前」という順序を守らないと
 * 数%ずれる。装備・魔方・コレクションはすべて固定値で、%ではない。
 */
window.Stats = (function () {
  'use strict';

  var D = null;

  function data() {
    if (!D) D = window.STAT_DATA;
    return D;
  }

  var CLASS_KEY = { '火力型': '火力', '防御型': '防御', '支援型': '支援' };
  var CLASS_KEY_CN = { '火力型': '火力', '防御型': '防御', '支援型': '辅助' };

  /* オーバーロード厳選値 — 段階1..15 の等間隔テーブル */
  var OVERLOAD = {
    elementDmg: { min: 9.54, max: 29.16, label: '有利コードダメージ' },
    atk: { min: 4.77, max: 14.63, label: '攻撃力' },
    def: { min: 4.77, max: 14.63, label: '防御力' },
    critRate: { min: 2.30, max: 7.07, label: '会心率' },
    critDmg: { min: 6.64, max: 20.36, label: '会心ダメージ' },
    magazine: { min: 27.84, max: 85.37, label: '最大装弾数' },
    hitRate: { min: 4.77, max: 14.63, label: '命中率' },
    chargeSpeed: { min: 1.98, max: 6.09, label: 'チャージ速度' },
    chargeDmg: { min: 4.77, max: 14.63, label: 'チャージダメージ' }
  };

  function overloadValue(key, tier) {
    var o = OVERLOAD[key];
    if (!o) return 0;
    var t = Math.max(1, Math.min(15, tier | 0));
    return o.min + (t - 1) * (o.max - o.min) / 14;
  }

  /* スキルレベルの倍率。
   * ゲーム内の表記はレベル10の値で、レベル1はその 13/22。
   * 実データ367件のうち97.8%が「v(L) = v10 × (L+12)/22」で一致する。 */
  function skillScale(level) {
    var l = Math.max(1, Math.min(10, Math.round(level || 10)));
    return (l + 12) / 22;
  }

  function levelIndex(level) {
    var d = data();
    var lv = Math.max(d.levels[0], Math.min(d.levels[d.levels.length - 1], Math.round(level)));
    var i = d.levels.indexOf(lv);
    if (i < 0) {
      // nearest
      var best = 0, bd = Infinity;
      for (var k = 0; k < d.levels.length; k++) {
        var dd = Math.abs(d.levels[k] - lv);
        if (dd < bd) { bd = dd; best = k; }
      }
      i = best;
    }
    return i;
  }

  function equipmentOf(classType, equipLevel) {
    var d = data();
    var lv = Math.max(0, Math.min(5, Math.round(equipLevel == null ? 5 : equipLevel)));
    var mult = d.equipment.multipliers[lv];
    var cls = CLASS_KEY_CN[classType] || '火力型';
    var out = { hp: 0, atk: 0, def: 0 };
    d.equipment.slots.forEach(function (slot) {
      var row = d.equipment.base[slot] && d.equipment.base[slot][cls];
      if (row) {
        out.hp += row.hp * mult;
        out.atk += row.atk * mult;
        out.def += row.def * mult;
      }
    });
    return out;
  }

  function cubeOf(level) {
    var d = data();
    var lv = Math.max(0, Math.min(15, Math.round(level || 0)));
    if (lv <= 0) return { hp: 0, atk: 0, def: 0 };
    var i = lv - 1;
    return {
      hp: Number(d.cube.arrays.hp[i]) || 0,
      atk: Number(d.cube.arrays.attack[i]) || 0,
      def: Number(d.cube.arrays.defense[i]) || 0
    };
  }

  function collectibleOf(rarity, level) {
    var d = data();
    var kind = rarity === 'SR' ? 'SR' : 'R';
    var lv = Math.max(0, Math.min(15, Math.round(level || 0)));
    var arr = d.relic[kind] || [];
    var row = arr.filter(function (r) { return r.level === lv; })[0] || arr[0] || {};
    return { hp: Number(row.hp) || 0, atk: Number(row.attack) || 0, def: Number(row.defense) || 0 };
  }

  function affinityOf(classType, level) {
    var d = data();
    var key = classType === '防御型' ? 'defense' : classType === '支援型' ? 'support' : 'attack';
    var o = d.affinity.affinities[key] || d.affinity.affinities.attack;
    var lv = Math.max(1, Math.min(40, Math.round(level || 1)));
    var i = lv - 1;
    return {
      hp: Number(o.hp[i]) || 0,
      atk: Number(o.attack[i]) || 0,
      def: Number(o.defence ? o.defence[i] : (o.defense || [])[i]) || 0
    };
  }

  function researchOf(level) {
    var g = Math.max(0, Math.round((level && level.general) || 0));
    var c = Math.max(0, Math.round((level && level.classType) || 0));
    var co = Math.max(0, Math.round((level && level.company) || 0));
    return { hp: g * 450 + c * 750, atk: co * 25, def: c * 5 + co * 5 };
  }

  function defaults(char) {
    return {
      level: 400,
      lb: 3,
      core: 3,
      affection: 40,
      research: { general: 180, classType: 100, company: 100 },
      cubeLevel: 10,
      equipLevel: 5,
      collectible: { rarity: 'SR', level: 10 },
      overload: { atk: 47.2, hp: 0, def: 0, elementDmg: 0, critRate: 0, critDmg: 0, magazine: 0, hitRate: 0, chargeSpeed: 0, chargeDmg: 0 }
    };
  }

  function compute(char, cfg) {
    var d = data();
    cfg = Object.assign(defaults(char), cfg || {});
    var cls = CLASS_KEY_CN[char.classType] || '火力型';
    var table = d.classes[cls];
    var li = levelIndex(cfg.level);

    var weapon = char.weapon || 'AR';
    var defTable = table.defense[weapon] || table.defense.AR || table.defense[Object.keys(table.defense)[0]];

    var hp0 = table.hp[li];
    var atk0 = table.attack[li];
    var def0 = defTable[li];

    var lb = Math.max(0, Math.min(3, Math.round(cfg.lb || 0)));
    var core = Math.max(0, Math.min(7, Math.round(cfg.core || 0)));

    var mult = 1 + 0.02 * lb;
    var hp = hp0 * mult + 3000 * lb;
    var atk = atk0 * mult + 20 * lb;
    var def = def0 * mult + 100 * lb;

    var aff = affinityOf(char.classType, cfg.affection);
    var res = researchOf(cfg.research);
    hp += aff.hp + res.hp;
    atk += aff.atk + res.atk;
    def += aff.def + res.def;

    var coreMult = 1 + 0.02 * core;
    hp *= coreMult; atk *= coreMult; def *= coreMult;

    // 珍藏品（宝物）を装備したキャラは、SRコレクションLv15相当の固定値を持つ
    var treasure = !!char.treasure;
    var cube = cubeOf(cfg.cubeLevel);
    var equip = equipmentOf(char.classType, cfg.equipLevel);
    var coll = treasure
      ? collectibleOf('SR', 15)
      : collectibleOf(cfg.collectible && cfg.collectible.rarity, cfg.collectible && cfg.collectible.level);

    hp += cube.hp + equip.hp + coll.hp;
    atk += cube.atk + equip.atk + coll.atk;
    def += cube.def + equip.def + coll.def;

    var ol = cfg.overload || {};
    atk *= 1 + (Number(ol.atk) || 0) / 100;
    hp *= 1 + (Number(ol.hp) || 0) / 100;
    def *= 1 + (Number(ol.def) || 0) / 100;

    return {
      atk: Math.round(atk),
      hp: Math.round(hp),
      def: Math.round(def),
      cfg: cfg
    };
  }

  /* 戦闘力 — ゲーム内の表示に近い式 */
  function combatPower(stats, cfg, skillLevels) {
    cfg = cfg || {};
    var sl = skillLevels || {};
    var a = 0.01 * (sl.skill1 || 10) + 0.01 * (sl.skill2 || 10) + 0.02 * (sl.burst || 10);
    a += 0.0092 * (cfg.cubeLevel || 0) * 0.5;
    var base = 1.075 * stats.atk * 18 + (stats.def * 100 + stats.hp) * 0.7;
    return Math.round(base * (1.3 + a) / 100);
  }

  return {
    compute: compute,
    defaults: defaults,
    combatPower: combatPower,
    skillScale: skillScale,
    overloadValue: overloadValue,
    OVERLOAD: OVERLOAD
  };
})();
