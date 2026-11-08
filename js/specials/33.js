/* ラプラス (id 33 / org 102)
 *
 * パーサが表現できていない部分だけを実装する。
 *  - スキル1「フルチャージ攻撃時、自分に
 *    ヒーロービジョン：爆発範囲3.57%▲：5スタック：5秒間維持」
 *  - バーストの武器変更のうち、初回ダメージ 897.6% と、
 *    ヒーロービジョンがフルスタックのとき同じ敵への 11.9% 防御力無視ダメージ
 *
 * 武器変更中の「通常ダメージ14.52%を5秒間」は、エンジン側に連射モードが無く、
 * 通常射撃のダメージを差し替えられないため実装しない（既存の通常射撃のまま）。
 * 貫通特化も同様に実装しない。スキル2の追加ダメージはパーサ側のトリガーに任せる。
 */
(function () {
  function pick(u, E, frame) {
    var es = E.alive(E.enemies(u));
    if (!es.length) return null;
    var taunt = es.filter(function (x) { return x.tauntUntil >= frame; });
    if (taunt.length) {
      taunt.sort(function (a, b) { return a.pos - b.pos; });
      return taunt[0];
    }
    var right = u.weapon === 'SR';
    es.sort(function (a, b) { return right ? b.pos - a.pos : a.pos - b.pos; });
    return es[0];
  }

  (window.SPECIALS = window.SPECIALS || {})[33] = {
    init: function (u, E) {
      u.lap = { vision: 0 };
    },

    onShot: function (u, E, frame, shot) {
      var st = u.lap;
      if (!st) return;
      // ラプラスは RL。RL は毎射撃がフルチャージ攻撃。
      if (u.weapon !== 'RL') return;
      var b = E.buff(u, 'lap-vision', 'explosionRangePct', 3.57, 'up',
        frame + 5 * E.FPS, { maxStacks: 5 });
      st.vision = b ? (b.stacks || 1) : 1;
    },

    onBurst: function (u, E, frame) {
      var st = u.lap;
      if (!st) return;
      var target = pick(u, E, frame);
      if (!target) return;

      // 初回ダメージ：最終攻撃力の897.6%
      var chargeMult = ((u.char.stats && u.char.stats.maxCharge) || 250) / 100;
      E.damage(u, target, frame, { multiplierPct: 897.6, chargeMult: chargeMult });

      // 自分がヒーロービジョンのフルスタック状態なら、同じ敵に
      // 最終攻撃力の11.9%の防御力無視ダメージ
      if (st.vision >= 5 && target.alive) {
        E.damage(u, target, frame, { multiplierPct: 11.9, ignoreDef: true });
      }
    }
  };
})();
