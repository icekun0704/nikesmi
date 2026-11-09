/* ハーモニーキューブ（ハーモニーキューブ）.
 *
 * 出典: Prydwen の Harmony Cube data
 *       https://www.prydwen.gg/nikke/guides/harmony-cubes-data
 *
 * 種類ごとに固有効果があり、効果量はレベルで3段階に上がる
 * （Lv1〜2 / Lv3〜6 / Lv7〜15）。レベル自体の攻撃力・防御力・HPは
 * js/stat_data.js の cube.arrays を使う。
 *
 * 数値を推測で埋めないこと。ここに無いハーモニーキューブは「効果なし」として扱う。
 */
window.CUBES = [
  { id: 'none',        name: 'なし',              stat: null,            v: [0, 0, 0] },
  { id: 'resilience',  name: 'レジリエンス',       stat: 'reloadSpeedPct', v: [14.84, 22.27, 29.69] },
  { id: 'vigor',       name: 'ヴィゴール',         stat: 'maxHpPct',      v: [4.84, 7.27, 9.69] },
  { id: 'onslaught',   name: 'オンスロート',       stat: 'chargeDmgPct',  v: [2.54, 3.81, 5.09] },
  { id: 'adjutant',    name: 'アジュタント',       stat: 'chargeSpeedPct', v: [14.84, 22.29, 29.69] },
  { id: 'quantum',     name: 'クオンタム',         stat: 'chargeSpeedPct', v: [2.33, 3.5, 4.66] },
  { id: 'wingman',     name: 'ウィングマン',       stat: 'magazinePct',   v: [7.07, 10.6, 14.14] },
  { id: 'assault',     name: 'アサルト',          stat: 'hitRate',       v: [2.54, 3.81, 5.09] },
  { id: 'bastion',     name: 'バスティオン',       stat: null,            v: [11.06, 21.59, 32.12] },
  { id: 'endurance',   name: 'エンデュランス',     stat: 'defPct',        v: [24.20, 36.35, 48.45] },
  { id: 'healing',     name: 'ヒーリング',         stat: 'recoveryGivenPct', v: [8.08, 12.12, 16.16] },
  { id: 'tempering',   name: 'テンパリング',       stat: 'takenDmgPct',   v: [-4.84, -7.27, -9.69] },
  { id: 'piercing',    name: 'ピアシング',         stat: 'pierceDmgPct',  v: [0, 0, 0] },
  { id: 'destruction', name: 'デストラクション',   stat: 'partDmgPct',    v: [15.95, 23.92, 31.90] },
  { id: 'assist',      name: 'アシスト',          stat: null,            v: [6.07, 9.10, 12.14] }
];

/* すべてのハーモニーキューブに共通の「有利コードとして扱う」効果。Lv5から解放。 */
window.CUBE_ELEMENT = {
  5: 8.48, 6: 8.48, 7: 8.48, 8: 8.48, 9: 10.6,
  10: 12.72, 11: 14.84, 12: 14.84, 13: 16.96, 14: 16.96, 15: 19.09
};

window.CubeUtil = {
  byId: function (id) {
    for (var i = 0; i < window.CUBES.length; i++) {
      if (window.CUBES[i].id === id) return window.CUBES[i];
    }
    return window.CUBES[0];
  },
  /* レベルに応じた固有効果の値（Lv1-2 / Lv3-6 / Lv7-15 の3段階） */
  valueAt: function (id, level) {
    var c = this.byId(id);
    if (!c || !c.stat) return 0;
    var lv = Math.max(1, Math.min(15, Math.round(level || 0)));
    return lv <= 2 ? c.v[0] : lv <= 6 ? c.v[1] : c.v[2];
  },
  elementAt: function (level) {
    var lv = Math.max(1, Math.min(15, Math.round(level || 0)));
    return window.CUBE_ELEMENT[lv] || 0;
  }
};
