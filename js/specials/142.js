/* イヴ (142 / org 157)
 *
 * パーサで表現できていない部分だけを実装する。
 *
 * 実装:
 *   1. スキル2「通常攻撃が10回命中した時、対象が電撃コードなら自分に・弾丸チャージ3発」
 *      … パーサの bulletCharge は engine 側に処理が無いので、ここで装弾数を増やす。
 *   2. バースト「エグゾスパインMk2」（10秒）
 *      … 「イーグルアイエグゾスパインの攻撃力増加倍率を100%効果量に対し増加」。
 *      基礎効果はスキル2の攻撃力50%なので、10秒間 +50% を上乗せする。
 *   3. バーストの「457.14%のダメージ：6回順番に攻撃」
 *      … パーサは1回ぶんしか出さないので、残り5回をここで叩き込む。
 *
 * 未実装（理由）:
 *   - スキル1「通常攻撃が44回クリティカル命中した時」…
 *     engine は critHits カウンタを増やしておらず、onShot から会心を観測できない。
 *   - 「不安定エネルギーが命中した時、対象が電撃コードなら受けるダメージ10%▲」…
 *     上記のダメージ自体が発火しないため、付随効果も発動しない。
 *   - スキル2の「イーグルアイエグゾスパイン：下位効果のスタック適用」… 解釈不能。
 */
(function () {
  'use strict';

  /* E.pickTarget は README では (u, frame) だが engine の実装は (u, enemies, frame)。
   * どちらでも動くようにしてから使う。 */
  function pickTargetOf(u, E, frame) {
    try {
      var t = E.pickTarget(u, E.enemies(u), frame);
      if (t) return t;
    } catch (e) { /* 2引数版 */ }
    try { return E.pickTarget(u, frame) || null; } catch (e2) { return null; }
  }

  /* 決定的な対象選択（engine の rng は API に出ていないので使わない）。 */
  function nthAlive(list, n) {
    var live = [];
    for (var i = 0; i < list.length; i++) if (list[i].alive) live.push(list[i]);
    if (!live.length) return null;
    return live[n % live.length];
  }

  (window.SPECIALS = window.SPECIALS || {})[142] = {
    /* イヴ：457.14%×5はここで実装 */
    suppress: { burst: [0] },
    init: function (u, E) {
      u.eveHitMark = 0;
    },
    tick: function (u, E, frame) { },

    onShot: function (u, E, frame, shot) {
      var hits = u.counters ? u.counters.attackHits : 0;
      var applied = false;
      while (hits - u.eveHitMark >= 10) {
        u.eveHitMark += 10;
        var t = pickTargetOf(u, E, frame);
        if (t && t.element === '電撃' && isFinite(u.firing.magazine)) {
          u.firing.magazine += 3;   /* 弾丸チャージ3発 */
          applied = true;
        }
      }
      return applied;
    },

    onBurst: function (u, E, frame) {
      /* エグゾスパインMk2：基礎効果量(50%)ぶん上乗せ、10秒 */
      E.buff(u, 'eve-mk2-atk', 'atkPct', 50, 'up', frame + 10 * E.FPS, {});

      /* 「6回順番に攻撃」の残り5回（パーサが1回ぶん処理済み） */
      var enemies = E.enemies(u);
      for (var i = 0; i < 5; i++) {
        var t = nthAlive(enemies, i + u.pos + frame);
        if (!t) break;
        E.damage(u, t, frame, { multiplierPct: 457.14 });
      }
    }
  };
})();
