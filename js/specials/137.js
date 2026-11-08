/* プリバティ (id 137, AR, B3, 火力型)
 *
 * パーサで表現できなかった部分:
 *   - skill2「最後の弾丸が命中した時、対象が気絶状態なら同一の敵に
 *     最終攻撃力の1089%の追加ダメージ」。
 *     パーサは trigger=unknown にしており一度も発動しない。
 *     最後の弾丸（リロード直前）の対象が気絶していれば追加ダメージを出す。
 *
 * 実装していないもの:
 *   - 宝物専用行（受けるダメージ10.01% / 有利コード130% / ターゲット指定）は
 *     この形態（treasure=false）には付かない
 */
(window.SPECIALS = window.SPECIALS || {})[137] = {
  init: function (u, E) {
    u.privaty = { lastStunHit: -1 };
  },

  tick: function () { /* 毎フレーム処理なし */ },

  /* E.pickTarget は README では (u, frame) だが engine の実装は (u, enemies, frame)。
   * どちらでも動くようにしておく。 */
  _target: function (u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  },


  onShot: function (u, E, frame, shot) {
    var s = u.privaty;
    if (!s) return;
    /* 最後の弾丸が命中した時 */
    if (!shot.reloaded) return;
    var t = this._target(u, E, frame);
    if (!t || !t.alive) return;
    /* 対象が気絶状態なら同一の敵に 1089% */
    if (t.stunUntil >= frame) {
      var sf = (u.skillScale && u.skillScale.skill2) || 1;
      E.damage(u, t, frame, { multiplierPct: 1089 * sf });
      E.event({ frame: frame, kind: 'privaty-stun-extra', side: u.side, unit: u.name, target: t.name });
    }
  },

  onBurst: function () { /* バースト効果（457.87%＋気絶3秒）はパーサが処理済み */ }
};
