/* レオナ (id 65, SG, B2, 支援型) — 宝物なし
 *
 * パーサで表現できなかった部分:
 *   - burst「自分が咆哮のフルスタック状態なら、ショットガンを所持する味方全体に
 *     クリティカル確率21.32%▲：10秒間維持」の条件が落ちている。
 *     パーサは trigger=burst / target=SG味方 のブロックとして無条件に発火させるため、
 *     フルスタックでない時は同じ値のマイナスを別キーで入れて打ち消す。
 *     （数値の二重計上ではなく、条件の欠落を補正するための相殺）
 *
 * アリーナに存在しないため実装しないもの:
 *   - skill1「適正最大射程距離20%▲：10秒間維持」（アリーナに適正距離補正が無い）。
 *
 * 咆哮（クリティカル確率2.62%▲・5スタック・5秒）はパーサ／エンジンが
 * 通常攻撃5回ごとに付与しているので、ここでは付与しない。
 */
(function () {
  'use strict';

  var FPS = 60;
  var ROAR_VALUE = 2.62;     // 咆哮1スタック分
  var ROAR_MAX = 5;
  var BURST_CRIT = 21.32;    // SG味方全体へのクリティカル確率▲
  var BURST_SECONDS = 10;

  /* 自分が咆哮のフルスタック状態か */
  function hasFullRoar(u, frame) {
    for (var i = 0; i < u.buffs.length; i++) {
      var b = u.buffs[i];
      if (b.until < frame) continue;
      if (b.stat !== 'critRate' || b.dir === 'down') continue;
      if (Math.abs((b.value || 0) - ROAR_VALUE) > 1e-6) continue;
      if ((b.stacks || 1) >= Math.min(ROAR_MAX, b.maxStacks || ROAR_MAX)) return true;
    }
    return false;
  }

  (window.SPECIALS = window.SPECIALS || {})[65] = {
    init: function (u, E) {
      u.leona = {};
    },

    tick: function (u, E, frame) {},

    onShot: function (u, E, frame, shot) {},

    onBurst: function (u, E, frame) {
      // 条件が成立していればパーサの効果をそのまま使う
      if (hasFullRoar(u, frame)) return;

      // 成立していない: パーサが無条件に配るクリティカル確率21.32%を相殺する
      var allies = E.alive(E.team(u));
      for (var i = 0; i < allies.length; i++) {
        var a = allies[i];
        if (a.weapon !== 'SG') continue;
        E.buff(a, 'leona-roar-condition', 'critRate', BURST_CRIT, 'down',
               frame + BURST_SECONDS * FPS, {});
      }
      E.event({ frame: frame, kind: 'leona-roar-condition', side: u.side, unit: u.name,
                fullStack: false });
    }
  };
})();
