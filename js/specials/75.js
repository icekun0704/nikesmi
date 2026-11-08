/* K (id 75 / org 156, SMG, B3, 火力型, 電撃)
 *
 * 原文の状態機械:
 *   傾く天秤（自分）
 *     最後の弾丸で攻撃した時: クリティカル確率0.75%▲：100スタック：持続
 *                             ＋「傾く天秤のスタック量29個▲」
 *     フルバーストタイム終了時: 傾く天秤解除
 *   正義の実現
 *     傾く天秤が付与された時、味方全体に
 *       最大装弾数51.13%▼：10秒間維持（同一効果は重複不可）
 *       攻撃ダメージ10.62%▲：10秒間維持
 *     フルバーストタイム終了時: 正義の実現解除
 *   バースト: 使用武器変更（ダメージ92.5% / ペレット10個 / 攻撃速度90%▼ / 10秒）
 *
 * パーサの扱い:
 *   - 傾く天秤のクリティカル0.75%は1スタックずつ積む（本来は1回で29スタック）。
 *     スタック数を自前で数え、パーサのバフの stacks を上書きする。
 *   - 正義の実現は trigger=unknown で未発動。ここで付与する。
 *   - 武器変更は op=weaponChange で engine が処理しない。
 *     通常攻撃との差分ダメージ＋射撃間隔で近似する。
 *
 * 実装しないもの:
 *   - ペレット数10個（ヒット数・ゲージ・会心判定の回数）: engine の通常攻撃は
 *     武器種で分岐しており、戦闘中に武器種を差し替える口が無い
 *   - クリティカル攻撃4回ごとの23.9%追加ダメージ: engine に critHits カウンタが
 *     無く、onShot に会心の内訳が渡らない
 */
(function () {
  'use strict';

  var FB_FRAMES = 10 * 60;
  var SCALES_PER_LAST_BULLET = 29;   /* 傾く天秤のスタック量29個▲ */
  var SCALES_MAX = 100;              /* クリティカル確率0.75%▲：100スタック */
  var BURST_FRAMES = 10 * 60;
  var BURST_DAMAGE = 92.5;           /* 使用武器変更：ダメージ92.5% */

  function pick(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  function st(u) {
    if (!u.kState) {
      u.kState = {
        scales: 0,
        fbSeen: -1,
        fbEnd: -1,
        burstUntil: -1,
        baseInterval: 0,
        baseIntervalFrames: 0,
        baseWeaponMult: (u.char && u.char.stats && u.char.stats.weaponDamage) || 0
      };
    }
    return u.kState;
  }

  /* 傾く天秤は「クリティカル確率0.75%▲」のバフ。engine のキーは
   * <side><pos>:<slot>:<block>... だが slot が undefined になるため、
   * スタットと値（1%未満の小さなクリ率）で見分ける。 */
  function isScalesBuff(u, b) {
    return b.stat === 'critRate' && b.value < 2 &&
      b.key.indexOf(u.side + u.pos + ':') === 0;
  }

  function scalesBuff(u) {
    for (var i = 0; i < u.buffs.length; i++) {
      if (isScalesBuff(u, u.buffs[i])) return u.buffs[i];
    }
    return null;
  }

  function clearScales(u, frame, s) {
    s.scales = 0;
    u.buffs = u.buffs.filter(function (b) { return !isScalesBuff(u, b); });
  }

  function clearJustice(u, E) {
    var allies = E.team(u) || [];
    for (var i = 0; i < allies.length; i++) {
      var a = allies[i];
      if (!a) continue;
      var keyPrefix = 'k-justice:' + u.side + u.pos + ':';
      a.buffs = a.buffs.filter(function (b) { return b.key.indexOf(keyPrefix) !== 0; });
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[75] = {
    init: function (u, E) {
      st(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);

      /* burst の「追加効果：攻撃力63.36%▲」（スキル発動者基準）は原文では自分宛て。
       * パーサは target.side=null のため味方全体に配るので、味方に付いたぶんを外す。
       * （slot が undefined の現状のキーと、将来 slot が入ったキーの両方を見る） */
      var alliesK = E.team(u) || [];
      for (var ai = 0; ai < alliesK.length; ai++) {
        var al = alliesK[ai];
        if (!al || al === u) continue;
        al.buffs = al.buffs.filter(function (b) {
          if (b.stat !== 'atkFlat') return true;
          var base = u.side + u.pos + ':';
          if (b.key.indexOf(base + 'burst:1:') === 0) return false;
          if (b.key.indexOf(base + 'undefined:1:') === 0) return false;
          return true;
        });
      }

      /* 傾く天秤のスタック数をパーサのバフに反映（1回で29スタック） */
      var b = scalesBuff(u);
      if (b) {
        if (s.scales <= 0) {
          b.stacks = 0;
          b.until = -1;
        } else {
          b.stacks = s.scales;
          b.until = Infinity;
        }
      }

      /* フルバースト終了：傾く天秤解除 / 正義の実現解除 */
      var team = E.team(u) || [];
      var lb = team.lastBurst;
      if (lb && lb.stage === 'B3' && lb.frame !== s.fbSeen) {
        s.fbSeen = lb.frame;
        s.fbEnd = lb.frame + FB_FRAMES;
      }
      if (s.fbEnd >= 0 && frame >= s.fbEnd) {
        s.fbEnd = -1;
        clearScales(u, frame, s);
        clearJustice(u, E);
        E.event({ frame: frame, kind: 'k-scales-end', side: u.side, unit: u.name });
      }

      /* 武器変更の終了 */
      if (s.burstUntil >= 0 && frame > s.burstUntil) {
        s.burstUntil = -1;
        if (s.baseInterval) u.firing.interval = s.baseInterval;
        if (s.baseIntervalFrames) u.firing.baseIntervalFrames = s.baseIntervalFrames;
        E.event({ frame: frame, kind: 'k-weapon-end', side: u.side, unit: u.name });
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = st(u);
      if (!s || !shot) return;

      /* 傾く天秤が付与された時（最後の弾丸で攻撃した時） */
      if (shot.reloaded) {
        s.scales = Math.min(SCALES_MAX, s.scales + SCALES_PER_LAST_BULLET);

        /* 正義の実現：味方全体に 最大装弾数51.13%▼ / 攻撃ダメージ10.62%▲：10秒 */
        var allies = E.alive(E.team(u));
        for (var i = 0; i < allies.length; i++) {
          var a = allies[i];
          var key = 'k-justice:' + u.side + u.pos + ':' + a.pos;
          E.buff(a, key + ':mag', 'magazinePct', 51.13, 'down', frame + 10 * E.FPS, {});
          E.buff(a, key + ':dmg', 'atkDmgPct', 10.62, 'up', frame + 10 * E.FPS, {});
        }
        E.event({ frame: frame, kind: 'k-scales', side: u.side, unit: u.name,
                  stacks: s.scales });
      }

      /* 使用武器変更中の差分ダメージ。
       * 通常攻撃が武器ダメージ（SMG 4.55%）を既に与えているので、
       * 92.5% との差分だけを足す。 */
      if (s.burstUntil >= frame) {
        var t = pick(u, E, frame);
        if (t && t.alive) {
          var extra = BURST_DAMAGE - s.baseWeaponMult;
          if (extra > 0) E.damage(u, t, frame, { multiplierPct: extra });
        }
      }
    },

    onBurst: function (u, E, frame) {
      var s = st(u);
      if (s.burstUntil >= frame) return;   /* 変更中なら期間だけ更新しない */
      /* 使用武器変更：10秒間 / 攻撃速度90%▼（間隔 ×10） */
      s.burstUntil = frame + BURST_FRAMES;
      s.baseInterval = u.firing.interval;
      s.baseIntervalFrames = u.firing.baseIntervalFrames;
      u.firing.interval = Math.round(s.baseInterval * 10) || 40;
      u.firing.baseIntervalFrames = u.firing.interval;
      E.event({ frame: frame, kind: 'k-weapon', side: u.side, unit: u.name });
    }
  };
})();
