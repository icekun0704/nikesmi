/* プリバティ（宝物）(id 145, AR, B3, 火力型, 宝物)
 *
 * 宝物版の読み替え（Treasure2）:
 *   - skill2「最後の弾丸が命中した時、対象が気絶状態→ターゲット指定状態なら
 *     同一の敵に 最終攻撃力の1089%→1687%の追加ダメージ」
 *     宝物では条件が「気絶」から「ターゲット指定」に置き換わる。
 *
 * パーサで表現できなかった部分:
 *   - この条件付き追加ダメージのブロックは trigger=unknown で一度も発火しない。
 *     最後の弾丸（engine の shot.reloaded）で、対象が「ターゲット指定」状態
 *     （バースト自身が付与する atkPct 5.02%▼・10秒、宝物ではこの名前が付く）なら
 *     最終攻撃力の1687%の追加ダメージを与える。
 *
 * パーサ／エンジンが既に処理しているもの（二重計上しない）:
 *   - skill2 B0 の 256.17% 追加ダメージと 受けるダメージ10.01%▲
 *   - burst の 1407.64% / 気絶3秒 / 有利コードの攻撃ダメージ130%▲ /
 *     ターゲット指定（攻撃力5.02%▼）
 *
 * 不明点:
 *   - 追加ダメージの対象は「最後の弾丸が命中した同一の敵」。
 *     エンジンでは通常攻撃の対象が E.pickTarget と一致するのでそれを用いる。
 */
(function () {
  'use strict';

  var FPS = 60;
  var EXTRA_PCT = 1687;        // 最終攻撃力の1687%の追加ダメージ
  var MARK_VALUE = 5.02;       // ターゲット指定：攻撃力5.02%▼

  function pickTargetOf(u, E, frame) {
    try {
      var t = E.pickTarget(u, E.enemies(u), frame);
      if (t) return t;
    } catch (e) { /* 2引数版 */ }
    try { return E.pickTarget(u, frame) || null; } catch (e2) { return null; }
  }

  /* 対象が「ターゲット指定」状態か */
  function hasTargetMark(target, frame) {
    if (!target || !target.buffs) return false;
    for (var i = 0; i < target.buffs.length; i++) {
      var b = target.buffs[i];
      if (b.until < frame) continue;
      if (b.label === 'ターゲット指定') return true;
      if (b.stat === 'atkPct' && b.dir === 'down' &&
          Math.abs((b.value || 0) - MARK_VALUE) < 1e-6) return true;
    }
    return false;
  }

  (window.SPECIALS = window.SPECIALS || {})[145] = {
    init: function (u, E) {
      u.privaty = {};
    },

    tick: function (u, E, frame) {},

    onShot: function (u, E, frame, shot) {
      // 「最後の弾丸が命中した時」
      if (!shot || !shot.reloaded) return;
      var t = pickTargetOf(u, E, frame);
      if (!t || !t.alive) return;
      if (!hasTargetMark(t, frame)) return;
      E.damage(u, t, frame, { multiplierPct: EXTRA_PCT });
      E.event({ frame: frame, kind: 'privaty-lastbullet-extra', side: u.side,
                unit: u.name, target: t.name });
    },

    onBurst: function (u, E, frame) {}
  };
})();
