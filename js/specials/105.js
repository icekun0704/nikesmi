/* ラム (105 / org 116)
 *
 * パーサで表現できていない部分だけを実装する。
 *
 * 実装:
 *   バースト「味方全体に・スキル発動者の最終最大HPの10.08%バリア：10秒間維持」
 *   … パーサは op=unparsed で落としている。engine のシールドは期限を持たないので、
 *     付与ぶんと期限を覚えておき、10秒たったら残っている分だけ剥がす。
 *
 * 未実装（理由）:
 *   - スキル1「フルバースト終了時、同じ部隊の味方がいれば自分にバーストCT20.16秒▼」
 *     … パーサが対象を自分ではなく味方全体にしてしまっている。付与済みの効果は
 *     取り消せないので、ここでは何もしない。
 *   - スキル2「残りのHPの数値が最も低い味方2機」… パーサは pick を落として
 *     編成順の2機に配っている。こちらで配り直すと二重計上になるため触らない。
 */
(function () {
  'use strict';

  var BARRIER_PCT = 10.08;  /* 原文: 最終最大HPの10.08% */
  var DURATION = 10;        /* 原文: 10秒間維持 */

  (window.SPECIALS = window.SPECIALS || {})[105] = {
    init: function (u, E) {
      u._ramBarriers = [];
    },

    tick: function (u, E, frame) {
      var list = u._ramBarriers;
      if (!list.length) return;
      var keep = [];
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        if (!b.unit) continue;
        if (frame <= b.until) { keep.push(b); continue; }
        /* 期限切れ：付与したぶんのうち残っている分だけ剥がす */
        var cur = b.unit.shield || 0;
        b.unit.shield = Math.max(0, cur - Math.min(b.amount, cur));
      }
      u._ramBarriers = keep;
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) {
      var team = E.alive(E.team(u));
      var grant = u.hpMax * BARRIER_PCT / 100;
      var until = frame + DURATION * E.FPS;
      for (var i = 0; i < team.length; i++) {
        var t = team[i];
        var before = t.shield || 0;
        t.shield = Math.max(before, grant);
        var added = t.shield - before;
        if (added > 0) u._ramBarriers.push({ unit: t, amount: added, until: until });
      }
    }
  };
})();
