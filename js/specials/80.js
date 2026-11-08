/* スノーホワイト (id 80 / org 97, AR, B3, 火力型, 鉄甲)
 *
 * 原文の状態機械（バースト）:
 *   使用武器変更
 *     チャージ時間：5秒（固定）
 *     ダメージ：最終攻撃力の499.5%
 *     フルチャージダメージ：1000%
 *     最大装弾数：1発
 *     追加効果：貫通特化
 *
 * パーサは op=weaponChange として落とすだけで engine は何もしない。
 *
 * 本ファイルでは、バースト時に武器ダメージをフルチャージぶん（1000%）へ差し替え、
 * チャージ時間を5秒固定（u.chargeFixed = 300）にし、装弾数を1発にする。
 * その1発を撃ち終えたら元の AR に戻す（最大装弾数1発の武器変更のため）。
 *
 * 実装しないもの:
 *   - 通常（フルチャージでない）ダメージ499.5%: engine の AR にはチャージの
 *     概念が無く、フルチャージ時だけを再現している
 *   - 貫通特化: 通常攻撃の貫通（複数対象）を差し替える口が engine に無い
 */
(function () {
  'use strict';

  var CHARGE_FRAMES = 5 * 60;     /* チャージ時間：5秒（固定） */
  var FULL_CHARGE_DAMAGE = 1000;  /* フルチャージダメージ：1000% */

  /* skill2「攻撃範囲内の敵に 144.73%」は trigger.seconds が文字列（"15秒"）のため
   * engine の周期計算が NaN になり、毎フレーム発動してしまう。
   * このユニットの skillState だけ trigger.seconds を数値に直して15秒周期に戻す。 */
  function fixPeriodicSeconds(u) {
    if (!u.skillState) return;
    for (var i = 0; i < u.skillState.length; i++) {
      var sk = u.skillState[i];
      for (var b = 0; b < sk.blocks.length; b++) {
        var bs = sk.blocks[b];
        var t = bs.block && bs.block.trigger;
        if (!t || t.kind !== 'periodic') continue;
        if (typeof t.seconds !== 'string') continue;
        var m = t.seconds.match(/(\d+(?:\.\d+)?)/);
        bs.block = Object.assign({}, bs.block, {
          trigger: Object.assign({}, t, { seconds: m ? parseFloat(m[1]) : null })
        });
      }
    }
  }

  function st(u) {
    if (!u.sw80) {
      u.sw80 = {
        pending: false,
        until: -1,
        origChar: null,
        changedChar: null,
        baseMagazine: 0,
        periodicSeen: 0
      };
    }
    return u.sw80;
  }

  /* フルバーストタイム中か（B3 バーストから10秒） */
  function inFullBurst(u, frame) {
    var lb = u.team && u.team.lastBurst;
    return !!(lb && lb.stage === 'B3' && frame >= lb.frame && frame <= lb.frame + 10 * 60);
  }

  function restore(u, E, frame) {
    var s = st(u);
    if (!s.pending) return;
    s.pending = false;
    s.until = -1;
    if (s.origChar) u.char = s.origChar;
    s.origChar = null;
    s.changedChar = null;
    if (u.chargeFixed) delete u.chargeFixed;
    u.firing.magazine = s.baseMagazine;
    u.firing.shotsInMagazine = 0;
    u.firing.nextFrame = frame + (u.firing.interval || 6);
    E.event({ frame: frame, kind: 'snowwhite-weapon-end', side: u.side, unit: u.name });
  }

  (window.SPECIALS = window.SPECIALS || {})[80] = {
    init: function (u, E) {
      var s = st(u);
      s.baseMagazine = Number.isFinite(u.firing.magazine) ? u.firing.magazine : 0;
      fixPeriodicSeconds(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);
      if (s.pending && frame > s.until) restore(u, E, frame);

      /* skill2 の「攻撃範囲内の敵に144.73%」が発動した時、フルバーストタイム
       * 持続中なら自分に クリティカル確率26.1%▲：10秒間維持。
       * periodic の発動は skill2 の nextPeriodic が進んだことで判定する。 */
      var sk2 = null;
      for (var i = 0; i < (u.skillState || []).length; i++) {
        if (u.skillState[i].slot === 'skill2') { sk2 = u.skillState[i]; break; }
      }
      if (sk2 && sk2.nextPeriodic !== s.periodicSeen) {
        s.periodicSeen = sk2.nextPeriodic;
        if (inFullBurst(u, frame)) {
          E.buff(u, 'snowwhite-crit', 'critRate', 26.1, 'up', frame + 10 * E.FPS, {});
          E.event({ frame: frame, kind: 'snowwhite-crit', side: u.side, unit: u.name });
        }
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = st(u);
      /* 武器変更の1発を撃ち終えたら元の武器へ */
      if (s.pending) restore(u, E, frame);
    },

    onBurst: function (u, E, frame) {
      var s = st(u);
      if (s.pending) return;

      s.pending = true;
      s.until = frame + CHARGE_FRAMES + 60;
      s.origChar = u.char;
      var stats = Object.assign({}, u.char.stats || {});
      stats.weaponDamage = FULL_CHARGE_DAMAGE;
      s.changedChar = Object.assign({}, u.char, { stats: stats });
      u.char = s.changedChar;

      /* チャージ時間5秒固定・装弾数1発 */
      u.chargeFixed = CHARGE_FRAMES;
      u.firing.magazine = 1;
      u.firing.shotsInMagazine = 0;
      /* 変更した武器でチャージし終える時刻まで次の射撃を待つ */
      u.firing.nextFrame = frame + CHARGE_FRAMES;

      E.event({ frame: frame, kind: 'snowwhite-weapon', side: u.side, unit: u.name,
                chargeFrames: CHARGE_FRAMES });
    }
  };
})();
