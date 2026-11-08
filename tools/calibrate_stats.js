/* 実データと計算値の突き合わせ.
 *
 *   node tools/calibrate_stats.js <roster.json>
 *
 * roster.json は blablalink から取った { list, details, effects } を持つファイル。
 * キャラごとに「ゲームが表示する戦闘力」と「このシミュレータの計算値」を比べる。
 */
global.window = {};
['data', 'stat_data', 'skills', 'gauge', 'stats'].forEach(function (f) {
  require('../js/' + f + '.js');
});
Object.assign(global, window);

var fs = require('fs');
var path = process.argv[2];
if (!path) {
  console.error('usage: node tools/calibrate_stats.js <roster.json>');
  process.exit(1);
}

var R = JSON.parse(fs.readFileSync(path, 'utf8'));

/* state_effects の function_type → このシミュレータのキー */
var EFFECT_KEY = {
  StatAtk: 'atk',
  StatDef: 'def',
  StatAmmoLoad: 'magazine',
  StatCritical: 'critRate',
  StatCriticalDamage: 'critDmg',
  StatChargeDamage: 'chargeDmg',
  StatChargeTime: 'chargeSpeed',
  IncElementDmg: 'elementDmg',
  StatAccuracyCircle: 'hitRate'
};

function overloadFrom(detail) {
  var out = {};
  var effects = R.effects || {};
  ['head', 'torso', 'arm', 'leg'].forEach(function (slot) {
    for (var i = 1; i <= 3; i++) {
      var id = detail[slot + '_equip_option' + i + '_id'];
      if (!id) continue;
      var e = effects[String(id)];
      if (!e) continue;
      var key = EFFECT_KEY[e[0]];
      if (!key) continue;
      var pct = Math.abs(Number(e[1]) || 0) / 100;
      out[key] = Math.round((out[key] || 0) + pct * 100) / 100;
    }
  });
  return out;
}

var byCode = {};
window.CHARACTERS.forEach(function (c) {
  if (c.nameCode != null && !byCode[c.nameCode]) byCode[c.nameCode] = c;
});

function configOf(entry, detail) {
  var d = detail || {};
  return {
    level: entry.lv,
    lb: entry.grade,
    core: entry.core,
    affection: entry.attractive_lv,
    cubeLevel: d.harmony_cube_lv || 0,
    cubeType: d.harmony_cube_tid ? d.harmony_cube_tid % 100 : 0,
    equipLevel: d.head_equip_lv || 0,
    equipTier: d.head_equip_tier || 0,
    collectible: { rarity: 'SR', level: 15 },
    overload: overloadFrom(d)
  };
}

var rows = [];
var missing = 0;
R.list.forEach(function (entry) {
  var c = byCode[entry.name_code];
  if (!c) { missing++; return; }
  var d = R.details[String(entry.name_code)] || {};
  var cfg = configOf(entry, d);
  var st = window.Stats.compute(c, cfg);
  var cp = window.Stats.combatPower(st, cfg, {
    skill1: d.skill1_lv, skill2: d.skill2_lv, burst: d.ulti_skill_lv
  });
  rows.push({
    name: c.name, code: entry.name_code, lv: entry.lv,
    real: entry.combat, calc: cp, ratio: cp / entry.combat, st: st
  });
});

rows.sort(function (a, b) { return a.ratio - b.ratio; });
var med = rows[Math.floor(rows.length / 2)];
var mean = rows.reduce(function (s, r) { return s + r.ratio; }, 0) / rows.length;

console.log('キャラ', rows.length, '/ 名前コード未対応', missing);
console.log('中央値 calc/real', med.ratio.toFixed(4), ' 平均', mean.toFixed(4));
console.log('');
['最も低い', '最も高い'].forEach(function (label, i) {
  console.log('--- ' + label + ' 5件');
  var part = i === 0 ? rows.slice(0, 5) : rows.slice(-5).reverse();
  part.forEach(function (r) {
    console.log(
      '  ' + String(r.name).padEnd(22) +
      ' lv' + String(r.lv).padEnd(4) +
      ' real ' + String(r.real).padStart(7) +
      ' calc ' + String(r.calc).padStart(7) +
      '  ' + r.ratio.toFixed(3)
    );
  });
});
