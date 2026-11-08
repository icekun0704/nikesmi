/* ポリ（宝物） (id 64, SG, B2)
 *
 * パーサで表現できなかった部分:
 *   - ポリスバッジ状態（戦闘開始時に最大HP100%のバリア、10秒）
 *       ・10秒経過、またはバリアが割れたら状態終了
 *       ・バースト時「自分がポリスバッジ状態なら 不屈：5秒間維持：ポリスバッジ解除」
 *         （不屈自体はパーサが無条件で適用しているので、ここでは状態の解除だけ）
 *   - 「ポリスバッジ状態が終了した時、自分に 最終最大HPの5%持続回復：
 *      1秒間隔：5秒間維持」（trigger:unknown なので発動しない）
 *   - バーストの「最終最大HPの40%の味方共用バリア：10秒間維持」
 *     （宝物版の値。op:'unparsed'）
 *
 * 実装していないもの:
 *   - 「味方共用」の範囲（自分以外も守る）は engine に受け皿が無いため、
 *     単一プールとして自分に持たせる。
 */
(function () {
  'use strict';

  function st(u) {
    if (!u.poliT) {
      u.poliT = {
        started: false,
        badge: true,
        badgeUntil: -1,
        badgeShield: 0,
        badgeRemainder: 0,
        healNext: -1,
        healLeft: 0,
        barrierAdded: 0,
        barrierPrev: 0,
        barrierUntil: -1
      };
    }
    return u.poliT;
  }

  function endBadge(u, E, frame) {
    var s = st(u);
    if (!s.badge) return;
    s.badge = false;

    // 時間切れで残っているバリアを落とす（割れて終了した場合は残量0）
    var leftover = Math.max(0, Math.min(s.badgeRemainder, u.shield));
    u.shield = Math.max(0, u.shield - leftover);
    s.badgeRemainder = 0;

    // スキル2：ポリスバッジ状態が終了した時、最終最大HPの5%持続回復
    // （1秒間隔・5秒間）
    s.healNext = frame;
    s.healLeft = 5;

    E.event({ frame: frame, kind: 'poli-badge-end', side: u.side, unit: u.name });
  }

  (window.SPECIALS = window.SPECIALS || {})[64] = {
    init: function (u, E) {
      st(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);

      if (!s.started) {
        s.started = true;
        // 戦闘開始時のバッジ（最大HP100%のバリア）はパーサが適用済み。
        // その残量を基準に、10秒経過 or 破壊で状態終了とする。
        s.badgeUntil = 10 * E.FPS;
        s.badgeShield = u.shield;
        s.badgeRemainder = u.shield;
      }

      if (s.badge && (frame >= s.badgeUntil || u.shield <= 0)) {
        endBadge(u, E, frame);
      }

      // バッジ終了後の持続回復
      if (s.healLeft > 0 && frame >= s.healNext) {
        s.healNext = frame + 60;
        s.healLeft -= 1;
        E.heal(u, u.hpMax * 0.05, frame);
      }

      // バーストのバリア失効
      if (s.barrierUntil >= 0 && frame > s.barrierUntil) {
        var leftover = Math.max(0, Math.min(s.barrierAdded, u.shield - s.barrierPrev));
        u.shield = Math.max(0, u.shield - leftover);
        s.barrierAdded = 0;
        s.barrierPrev = 0;
        s.barrierUntil = -1;
      }
    },

    onBurst: function (u, E, frame) {
      var s = st(u);

      // ポリスバッジ状態なら解除（不屈はパーサが適用済み）
      if (s.badge) endBadge(u, E, frame);

      // 最終最大HPの40%の味方共用バリア：10秒間維持（宝物版）
      var amt = Math.round(u.hpMax * 0.40);
      s.barrierPrev = u.shield;
      s.barrierAdded = Math.max(0, amt - u.shield);
      u.shield = Math.max(u.shield, amt);
      s.barrierUntil = frame + 10 * E.FPS;
    }
  };
})();
