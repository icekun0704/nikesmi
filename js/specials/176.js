/* ディーゼル（宝物）(id 176 / org 54, MG, B2, 防御型, 風圧)
 *
 * 原文の状態機械:
 *   イチゴキャンディ（自分）
 *     通常攻撃が70回命中した時: 最大装弾数56.7%▲：10スタック：10秒間維持
 *     自分がイチゴキャンディの最大スタック状態ならスタック解除後、味方全体に
 *       弾丸チャージ86.62%
 *       貫通ダメージ30%▲：10秒間維持
 *   傾く…ではなく skill1:
 *     フルバーストタイム持続中に撃たれた時、自分がヘイト状態なら自分に
 *       スキル発動者の最終最大HPの11.02%回復
 *     通常攻撃が150回命中した時、自分がヘイト状態なら自分に
 *       スタック可能バフ効果のスタック量1個▲
 *
 * パーサの扱い:
 *   - イチゴキャンディも150回効果も trigger=unknown / op=stackBoost で未発動。
 *   - 回復は trigger=unknown で未発動。
 *   - burst の 最大HP100.05%▲ / ヘイト（挑発）10秒 はパーサが動かしている。
 *
 * 実装しないもの:
 *   - 「同一効果は重複不可」の明示（E.buff の同一キー更新で同等）
 *   - 挑発の「→削除」行（パーサは自分に5.06秒の挑発を置くが、同じバーストの
 *     10秒ヘイトが上書きするため実害が無い）
 */
(function () {
  'use strict';

  var FB_FRAMES = 10 * 60;
  var CANDY_HITS = 70;          /* 宝物1：100回→70回 */
  var CANDY_MAX = 10;
  var CANDY_PCT = 56.7;
  var CANDY_FRAMES = 10 * 60;
  var STACK_BOOST_HITS = 150;
  var HEAL_PCT = 11.02;
  var BULLET_CHARGE_PCT = 86.62;
  var PIERCE_PCT = 30;

  function st(u) {
    if (!u.dieselT) {
      u.dieselT = {
        candy: 0,
        candyUntil: -1,
        boost: 0,
        nextCandyHits: CANDY_HITS,
        nextBoostHits: STACK_BOOST_HITS,
        takenSeen: 0,
        fbSeen: -1,
        fbEnd: -1
      };
    }
    return u.dieselT;
  }

  function removeCandy(u) {
    u.buffs = u.buffs.filter(function (b) { return b.key !== 'diesel-candy'; });
  }

  function applyCandy(u, E, frame, s) {
    if (s.candy >= CANDY_MAX) {
      /* 最大スタック状態 → スタック解除後、味方全体に弾丸チャージ＋貫通ダメージ */
      s.candy = 0;
      s.candyUntil = -1;
      removeCandy(u);
      var allies = E.alive(E.team(u));
      for (var i = 0; i < allies.length; i++) {
        var a = allies[i];
        if (a.firing && Number.isFinite(a.firing.magazine) && a.firing.magazine > 0) {
          a.firing.shotsInMagazine = Math.max(0,
            a.firing.shotsInMagazine - a.firing.magazine * BULLET_CHARGE_PCT / 100);
        }
        E.buff(a, 'diesel-pierce:' + u.side + u.pos + ':' + a.pos,
          'pierceDmgPct', PIERCE_PCT, 'up', frame + CANDY_FRAMES, {});
      }
      E.event({ frame: frame, kind: 'diesel-candy-release', side: u.side, unit: u.name });
      return;
    }

    s.candy = Math.min(CANDY_MAX, s.candy + 1 + s.boost);
    s.candyUntil = frame + CANDY_FRAMES;
    var b = E.buff(u, 'diesel-candy', 'magazinePct', CANDY_PCT, 'up',
      frame + CANDY_FRAMES, { maxStacks: CANDY_MAX });
    if (b) b.stacks = s.candy;
    E.event({ frame: frame, kind: 'diesel-candy', side: u.side, unit: u.name,
              stacks: s.candy });
  }

  (window.SPECIALS = window.SPECIALS || {})[176] = {
    init: function (u, E) {
      st(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);

      /* イチゴキャンディの失効 */
      if (s.candyUntil >= 0 && frame > s.candyUntil) {
        s.candy = 0;
        s.candyUntil = -1;
        removeCandy(u);
      }

      /* フルバースト終了の検出 */
      var team = E.team(u) || [];
      var lb = team.lastBurst;
      if (lb && lb.stage === 'B3' && lb.frame !== s.fbSeen) {
        s.fbSeen = lb.frame;
        s.fbEnd = lb.frame + FB_FRAMES;
      }

      /* フルバーストタイム持続中に撃たれた時、自分がヘイト状態なら
       * スキル発動者の最終最大HPの11.02%回復 */
      var taken = u.counters.hitsTaken || 0;
      if (taken > s.takenSeen) {
        s.takenSeen = taken;
        if (s.fbEnd >= 0 && frame <= s.fbEnd && u.tauntUntil >= frame) {
          E.heal(u, u.hpMax * HEAL_PCT / 100, frame);
          E.event({ frame: frame, kind: 'diesel-heal', side: u.side, unit: u.name });
        }
      } else {
        s.takenSeen = taken;
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = st(u);
      if (!s) return;
      var hits = u.counters.attackHits || 0;

      /* 通常攻撃が70回命中した時、イチゴキャンディ */
      while (hits >= s.nextCandyHits) {
        s.nextCandyHits += CANDY_HITS;
        applyCandy(u, E, frame, s);
      }

      /* 通常攻撃が150回命中した時、自分がヘイト状態なら
       * スタック可能バフ効果のスタック量1個▲ */
      while (hits >= s.nextBoostHits) {
        s.nextBoostHits += STACK_BOOST_HITS;
        if (u.tauntUntil >= frame) {
          s.boost += 1;
          E.event({ frame: frame, kind: 'diesel-stack-boost', side: u.side,
                    unit: u.name, boost: s.boost });
        }
      }
    },

    onBurst: function (u, E, frame) {
      /* バーストの 最大HP100.05% / ヘイト10秒 はパーサが処理する。 */
    }
  };
})();
