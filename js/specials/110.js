/* サクラ：ブルーム・イン・サマー (id 110 / org 124)
 *
 * パーサが表現できていない部分だけを実装する。
 *  - バースト「ランダムの敵に457.14%を10回順番に攻撃」の残り9回
 *  - バースト「同じ敵に35.16%の持続ダメージ：1秒間隔：10スタック：10秒」
 *
 * パーサは上の2つを「1回の457.14%」と「1回の35.16%」として処理しているため、
 * 差分だけを足して合計が原文どおりになるようにする（二重計上しない）。
 *
 * スキル1のパーツ破壊トリガーと「スキル2強制使用」は、このエンジンにパーツの
 * 概念が無く、スキル2は periodic として0フレーム目に発火するため実装しない。
 */
(function () {
  (window.SPECIALS = window.SPECIALS || {})[110] = {
    /* サクラ：457.14%×9はここで実装 */
    suppress: { burst: [0, 1], skill2: [1] },
    init: function (u, E) {
      u.skState = { dots: [] };
    },

    tick: function (u, E, frame) {
      var st = u.skState;
      if (!st) return;
      for (var i = st.dots.length - 1; i >= 0; i--) {
        var d = st.dots[i];
        if (frame > d.until) { st.dots.splice(i, 1); continue; }
        if (frame < d.next) continue;
        var es = E.alive(E.enemies(u));
        for (var j = 0; j < es.length; j++) {
          E.damage(u, es[j], frame, { multiplierPct: d.mult, isSustained: true });
        }
        d.mult = 35.16 * 10;   // 2回目以降は10スタック分
        d.next += 60;
      }
    },

    onBurst: function (u, E, frame) {
      var st = u.skState;
      if (!st) return;

      // 457.14% を10回順番に攻撃（パーサが1回分を実行済みなので残り9回）
      var es = E.alive(E.enemies(u));
      if (es.length) {
        for (var i = 0; i < 9; i++) {
          var idx = (frame * 31 + i * 17) % es.length;
          if (es[idx] && es[idx].alive) {
            E.damage(u, es[idx], frame, { multiplierPct: 457.14 });
          }
        }
      }

      // 同じ敵に 35.16% の持続ダメージ：1秒間隔：10スタック：10秒間維持
      // パーサが初回1スタック分（35.16%）を与えているので、最初のtickから差し引く。
      st.dots.push({
        mult: 35.16 * 10 - 35.16,
        next: frame + 60,
        until: frame + 600
      });
    }
  };
})();
