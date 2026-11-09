/* 同期データの変換を実データで確かめる.
 *
 *   node tools/test_sync.js <roster.json>
 *
 * roster.json は blablalink の { list, details, effects }。
 * Worker が返す形に組み替えてから、ブラウザ側の normalise / applyTo に通す。
 */
global.window = { addEventListener: function () {} };
global.document = { querySelector: function () { return null; }, addEventListener: function () {} };
global.localStorage = {
  _v: {},
  getItem: function (k) { return this._v[k] == null ? null : this._v[k]; },
  setItem: function (k, v) { this._v[k] = String(v); },
  removeItem: function (k) { delete this._v[k]; }
};
global.URLSearchParams = URLSearchParams;
global.location = { search: '' };

var fs = require('fs');
['data', 'stat_data', 'skills', 'gauge', 'stats', 'cubes', 'engine', 'sync'].forEach(function (f) {
  require('../js/' + f + '.js');
});
Object.assign(global, window);

var path = process.argv[2];
if (!path) {
  console.error('usage: node tools/test_sync.js <roster.json>');
  process.exit(1);
}
var R = JSON.parse(fs.readFileSync(path, 'utf8'));

/* Worker の応答そのものなら、そのまま使う */
var payload;
if (Array.isArray(R.characters)) {
  payload = R;
} else {
payload = {
  ok: true,
  version: 3,
  area_id: 81,
  option_effects: R.effects,
  characters: R.list.map(function (c) {
    var d = R.details[String(c.name_code)] || {};
    function pick(k) { return Number(d[k] != null ? d[k] : c[k]) || 0; }
    return {
      name_code: Number(c.name_code),
      level: Number(c.lv) || 0,
      limit_break: pick('grade'),
      core: pick('core'),
      affection: pick('attractive_lv'),
      skills: { s1: pick('skill1_lv'), s2: pick('skill2_lv'), burst: pick('ulti_skill_lv') },
      cube_lv: pick('harmony_cube_lv'),
      cube_tid: pick('harmony_cube_tid'),
      equip: {
        head: pick('head_equip_lv'), body: pick('torso_equip_lv'),
        arm: pick('arm_equip_lv'), leg: pick('leg_equip_lv')
      },
      equip_tier: pick('head_equip_tier'),
      options: [
        d.head_equip_option1_id, d.head_equip_option2_id, d.head_equip_option3_id,
        d.torso_equip_option1_id, d.torso_equip_option2_id, d.torso_equip_option3_id,
        d.arm_equip_option1_id, d.arm_equip_option2_id, d.arm_equip_option3_id,
        d.leg_equip_option1_id, d.leg_equip_option2_id, d.leg_equip_option3_id
      ].map(Number),
      favorite_item_lv: pick('favorite_item_lv'),
      treasure: !!Number(d.favorite_item_tid || c.favorite_item_tid),
      combat: pick('combat')
    };
  })
};
}

var norm = window.Sync.normalise(payload);
if (!norm) { console.error('normalise に失敗'); process.exit(1); }

var applied = window.Sync.applyTo(norm);
var ids = Object.keys(applied.chars);
console.log('取り込み', ids.length, '体 / 未対応', applied.unknown.length);

var samples = ids.slice(0, 3).concat(ids.slice(-2));
samples.forEach(function (id) {
  var cfg = applied.chars[id];
  var c = window.CHARACTERS.filter(function (x) { return String(x.id) === id; })[0];
  console.log(
    '  ' + String(c && c.name).padEnd(20) +
    ' lv' + cfg.stats.level +
    ' lb' + cfg.stats.lb +
    ' core' + cfg.stats.core +
    ' cube' + cfg.stats.cubeLevel + (cfg.cubeType ? '#' + cfg.cubeType : '') +
    ' sk' + cfg.skillLevels.skill1 + '/' + cfg.skillLevels.skill2 + '/' + cfg.skillLevels.burst +
    ' ol ' + JSON.stringify(cfg.stats.overload)
  );
});

/* 戦闘力がどれだけ合うか */
var rows = [];
ids.forEach(function (id) {
  var cfg = applied.chars[id];
  var c = window.CHARACTERS.filter(function (x) { return String(x.id) === id; })[0];
  if (!c) return;
  var raw = R.list.filter(function (e) { return String(c.nameCode) === String(e.name_code); })[0];
  if (!raw) return;
  var st = window.Stats.compute(c, cfg.stats);
  var cp = window.Stats.combatPower(st, cfg.stats, cfg.skillLevels);
  rows.push(cp / raw.combat);
});
rows.sort(function (a, b) { return a - b; });
console.log('戦闘力の比 中央値', rows[Math.floor(rows.length / 2)].toFixed(3));
