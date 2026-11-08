/* ルドミラ：ウィンターオーナー (id 171, MG, B3, 火力型)
 *
 * パーサで表現できなかった部分:
 *   - skill1「通常攻撃が60回命中した時、対象に 最終攻撃力の158.43の追加ダメージ」。
 *     パーサは同じブロックの「受けるダメージ12.56%」だけを処理し、
 *     追加ダメージは op:unparsed で落としている。
 *     （原文に % 表記が無いが、他の持続ダメージ行と同じ「最終攻撃力の N%」の形）
 *
 * 実装していないもの:
 *   - 「弾丸チャージ20発」（engine に弾丸チャージの概念が無い）
 */
(window.SPECIALS = window.SPECIALS || {})[171] = {
  init: function (u, E) {
    u.ludmila = { anchor: 0 };
  },

  tick: function (u, E, frame) {
    var s = u.ludmila;
    if (!s) return;
    /* 60ヒットごとに追加ダメージ。パーサ側の counter(60) は
     * 「受けるダメージ12.56%」を担当しているので、こちらはダメージだけ。 */
    var hits = u.counters.attackHits;
    while (hits - s.anchor >= 60) {
      s.anchor += 60;
      var t = this._target(u, E, frame);
      if (t) E.damage(u, t, frame, { multiplierPct: 158.43 });
    }
  },

  onShot: function () { /* 追加ダメージは tick 側でヒット数を見て出す */ },

  /* E.pickTarget は README では (u, frame) だが engine の実装は (u, enemies, frame)。
   * どちらでも動くようにしておく。 */
  _target: function (u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  },


  onBurst: function () { /* バースト効果はパーサが処理済み */ }
};
