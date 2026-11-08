/* ネオン：ブルーオーシャン (id 185, MG, B3)
 *
 * パーサで表現できなかった部分:
 *   - バースト「自分に 使用武器変更（ダメージ：最終攻撃力の33%／
 *     持続時間7秒）」のうち、7秒間の状態（使用武器変更中）を管理する。
 *   - 使用武器変更中の攻撃で対象が灼熱コードなら、
 *     最終攻撃力の11%の追加ダメージ（trigger:unknown）。
 *
 * 実装していないもの:
 *   - 使用武器変更そのもののダメージ（33%）。engine の通常攻撃は
 *     char.stats.weaponDamage を buildSchedule 時に固定しており、
 *     戦闘中に武器のダメージ倍率を差し替える口が無い。
 *   - スキル1／スキル2の「開始回数別の効果、下位効果スタック適用」
 *     （1回目/2回目/3回目）。engine の buff() は同じ key:stat を
 *     最大値でマージするため、結果として最大段階の値だけが乗る。
 *     段階ごとの積み上がりは再現できない（数値は原文のまま）。
 */
(function () {
  'use strict';

  /* E.pickTarget は README では (u, frame) だが engine の実装は (u, enemies, frame)。 */
  function pick(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  function st(u) {
    if (!u.neonBO) u.neonBO = { burstUntil: -1 };
    return u.neonBO;
  }

  (window.SPECIALS = window.SPECIALS || {})[185] = {
    init: function (u, E) {
      st(u);
    },

    onShot: function (u, E, frame, shot) {
      var s = st(u);
      if (frame > s.burstUntil) return;   // 使用武器変更中のみ

      var t = pick(u, E, frame);
      if (!t || !t.alive) return;
      if (t.element !== '灼熱') return;
      E.damage(u, t, frame, { multiplierPct: 11 });
    },

    onBurst: function (u, E, frame) {
      st(u).burstUntil = frame + 7 * E.FPS;   // 使用武器変更：7秒
    }
  };
})();
