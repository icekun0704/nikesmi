/* クエンシー (id 76 / org 56, SMG, B2, 支援型, 電撃)
 *
 * 原文の状態機械:
 *   skill1
 *     通常攻撃で60回攻撃した時、自分に
 *       最大HPが最も高いニケの最大HPのコピー12.42%：10秒間維持
 *   skill2
 *     攻撃力が最も高い味方2機に 攻撃力16.11%▲：5秒間維持    ← パーサ済み
 *   burst
 *     攻撃力が最も高い味方2機に 最大HP43.87%▲：5秒／
 *       クリティカルダメージ29.9%▲：10秒                    ← パーサ済み
 *
 * パーサの扱い:
 *   - skill1 の効果は op:unparsed。counter on:'attackShots' n:60 でブロック自体は
 *     発動するが engine 側に効果が無いため、ここで実装する。
 *
 * 実装しないもの:
 *   - なし（原文の効果はこれだけ）。
 */
(function () {
  'use strict';

  var FPS = 60;
  var SHOTS = 60;               /* 通常攻撃で60回攻撃した時 */
  var COPY_PCT = 12.42;         /* 最大HPのコピー12.42% */
  var COPY_SEC = 10;

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  /* skill2 の周期スキルは trigger.seconds が "8秒"（文字列）で保存されており、
   * そのままでは engine 側で NaN になり毎フレーム発動してしまう。
   * ユニット専用の複製で数値に直す。 */
  function cloneSkills(u) {
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (!src || !u.skillState) return;
    u.skills = JSON.parse(JSON.stringify(src));
    normalizePeriodic(u.skills);
    for (var s = 0; s < u.skillState.length; s++) {
      var st = u.skillState[s];
      var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
      if (!arr) continue;
      for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
    }
  }

  function normalizePeriodic(skills) {
    var slots = ['skill1', 'skill2', 'burst'];
    for (var i = 0; i < slots.length; i++) {
      var sk = skills[slots[i]];
      if (!sk || !sk.blocks) continue;
      for (var b = 0; b < sk.blocks.length; b++) {
        var t = sk.blocks[b].trigger;
        if (!t || t.kind !== 'periodic' || typeof t.seconds !== 'string') continue;
        var m = t.seconds.match(/(\d+(?:\.\d+)?)/);
        if (m) t.seconds = parseFloat(m[1]);
      }
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[76] = {
    init: function (u, E) {
      cloneSkills(u);
      u.quency = { shots: 0 };
    },

    tick: function (u, E, frame) { },

    onShot: function (u, E, frame, shot) {
      var s = u.quency;
      if (!s) return;
      s.shots += 1;
      if (s.shots % SHOTS !== 0) return;

      /* 味方の中で最も最大HPが高いユニットの最大HP */
      var mates = E.alive(E.team(u));
      var best = 0;
      for (var i = 0; i < mates.length; i++) {
        if (mates[i].hpMax > best) best = mates[i].hpMax;
      }
      if (best <= 0) return;
      E.buff(u, 'quency-hp-copy', 'hpFlat',
        best * COPY_PCT * scaleOf(u, 'skill1') / 100, 'up',
        frame + COPY_SEC * FPS, { label: '最大HPコピー' });
      E.event({ frame: frame, kind: 'quency-hp-copy', side: u.side, unit: u.name });
    },

    onBurst: function (u, E, frame) { }
  };
})();
