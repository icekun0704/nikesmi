/* 紅蓮：ブラックシャドウ (id 56, RL, B3)
 *
 * パーサで表現できなかった部分:
 *   - スキル1の「攻撃回数別の効果」（3回/6回/9回）が
 *     trigger:always + damage だけのブロックになっているため、
 *     engine の runAlwaysSkills（ダメージだけの常時ブロックは撃たない）で
 *     一度も発動しない。フルチャージ攻撃の回数を数えて実装する。
 *       3回：防御力が最も低い敵1機に 283.03%
 *       6回：攻撃範囲内の敵に 565% の分配ダメージ
 *       9回：敵全体に 848.03% の分配ダメージ
 *     各段階の効果のみ適用（同時に複数は撃たない）。9回でカウントを戻す。
 *   - バースト「スキル1のフルチャージ攻撃回数の条件が1回/2回/3回に変更：
 *     10秒間維持」（op:'unparsed'）
 *
 * 実装していないもの:
 *   - スキル2の「弾丸チャージ100%」（op:'bulletCharge' は applyEffect が
 *     stat として捨てる）。次弾を即チャージ済みにする受け皿が無い。
 */
(function () {
  'use strict';

  function st(u) {
    if (!u.scarletBS) u.scarletBS = { count: 0, fastUntil: -1 };
    return u.scarletBS;
  }

  /* E.pickTarget は README では (u, frame) だが engine の実装は (u, enemies, frame)。 */
  function pick(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  function lowestDef(E, enemies) {
    var best = null;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      var def = e.def * (1 + E.sumStat(e, 'defPct') / 100);
      if (!best || def < best.def) best = { unit: e, def: def };
    }
    return best ? best.unit : null;
  }

  function effect3(u, E, frame, enemies) {
    var t = lowestDef(E, enemies);
    if (t) E.damage(u, t, frame, { multiplierPct: 283.03 });
  }

  function effect6(u, E, frame, enemies) {
    var prim = pick(u, E, frame);
    if (!prim) return;
    var r = (u.char.rlExplosionRange == null ? 1 : u.char.rlExplosionRange);
    var list = E.slotsInRange(enemies, prim.pos, r);
    if (!list.length) list = [prim];
    for (var i = 0; i < list.length; i++) {
      E.damage(u, list[i], frame, { multiplierPct: 565, isDistributed: true });
    }
  }

  function effect9(u, E, frame, enemies) {
    for (var i = 0; i < enemies.length; i++) {
      E.damage(u, enemies[i], frame, { multiplierPct: 848.03, isDistributed: true });
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[56] = {
    /* 3回/6回/9回の攻撃はここで数えているので、パーサ側は止める */
    suppress: { skill1: [0, 1, 2] },
    init: function (u, E) {
      st(u);
    },

    onShot: function (u, E, frame, shot) {
      var s = st(u);
      if (!u.firing || !(u.firing.chargeFrames > 0)) return;   // フルチャージ攻撃のみ

      s.count += 1;
      var th = (frame <= s.fastUntil) ? [1, 2, 3] : [3, 6, 9];
      var enemies = E.alive(E.enemies(u));
      if (!enemies.length) return;

      if (s.count === th[0]) {
        effect3(u, E, frame, enemies);
      } else if (s.count === th[1]) {
        effect6(u, E, frame, enemies);
      } else if (s.count >= th[2]) {
        effect9(u, E, frame, enemies);
        s.count = 0;
      }
    },

    onBurst: function (u, E, frame) {
      // スキル1の条件を 1回/2回/3回 に変更（10秒間）
      st(u).fastUntil = frame + 10 * E.FPS;
    }
  };
})();
