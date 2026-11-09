/* ジル・バレンタイン (id 229, AR, B3, 火力型) — 宝物なし
 *
 * パーサで表現できなかった部分:
 *   - skill1「マグナム弾」（unparsed）: 戦闘開始時、および最大弾数のリロードが
 *     完了した時に、通常攻撃ダメージ30%倍率▲を9発間付与。
 *     パーサの trigger は battleStart だけで、リロード完了側が丸ごと抜けている。
 *     engine は通常攻撃限定のダメージ倍率を持たないため、atkDmgPct 30% で近似する
 *     （バーストにも乗ってしまう点はエンジン側の制約）。
 *   - skill2「硫酸弾」（unparsed）: 最大弾数のリロード完了後、初弾のみ対象に
 *     最終攻撃力の192%の持続ダメージ（1秒間隔・30秒）。
 *     パーサ側のブロックは battleStart で target=self の damage だけになっており、
 *     engine の runAlwaysSkills は「ダメージ効果しか無いブロック」を発動しないため
 *     実際には何も起きない。ここでは初弾の対象に30秒間のDoTを載せる。
 *   - burst「強制リロード」「残弾数100%減少」（unparsed）: バースト時に弾を捨てて
 *     即リロードする。
 *
 * engine に処理が無いため実装していないもの（数値は原文にあるが適用先が無い）:
 *   - burst「通常攻撃を防御力無視ダメージとして適用：10秒間維持」
 *     （op normalIgnoreDef は applyEffect に case が無い。通常攻撃の ignoreDef 経路が無い）
 *   - burst「リロード速度99.96%増加状態で固定」（reloadSpeedPct はエンジン未使用）
 */
(function () {
  'use strict';

  var FPS = 60;
  var MAGNUM_SHOTS = 9;
  var MAGNUM_ATKDMG = 30;      // 通常攻撃ダメージ30%倍率▲
  var ACID_TICK = 192;         // 最終攻撃力の192% / 1秒
  var ACID_SECONDS = 30;

  function pickTargetOf(u, E, frame) {
    try {
      var t = E.pickTarget(u, E.enemies(u), frame);
      if (t) return t;
    } catch (e) { /* 2引数版 */ }
    try { return E.pickTarget(u, frame) || null; } catch (e2) { return null; }
  }

  (window.SPECIALS = window.SPECIALS || {})[229] = {
  /* 持続ダメージの刻みはエンジン側で行う */
  suppress: {'skill2': [0]},
    init: function (u, E) {
      u.jill = {
        magnum: MAGNUM_SHOTS,   // 残りのマグナム弾
        acid: true,             // 次の1発に硫酸弾を載せる
        dot: null               // { target, next, until }
      };
    },

    tick: function (u, E, frame) {
      var j = u.jill;
      if (!j) return;

      // 最大弾数のリロード完了（エンジンは reloadingUntil に完了フレームを入れる）
      if (u.firing && u.firing.reloadingUntil === frame) {
        j.magnum = MAGNUM_SHOTS;
        j.acid = true;
      }

      // マグナム弾: 9発間 通常攻撃ダメージ30%倍率▲
      if (j.magnum > 0) {
        E.buff(u, 'jill-magnum', 'atkDmgPct', MAGNUM_ATKDMG, 'up', frame + 2,
               { label: 'マグナム弾' });
      }

      // 硫酸弾の持続ダメージ（1秒間隔）
      var dot = j.dot;
      if (!dot) return;
      if (!dot.target.alive || frame > dot.until) { j.dot = null; return; }
      if (frame >= dot.next) {
        dot.next += FPS;
        E.damage(u, dot.target, frame, { multiplierPct: ACID_TICK, isSustained: true });
      }
    },

    onShot: function (u, E, frame, shot) {
      var j = u.jill;
      if (!j) return;

      // マグナム弾は1発ずつ消費
      if (j.magnum > 0) j.magnum -= 1;

      // 硫酸弾: リロード後（＝戦闘開始含む）の初弾のみ
      if (j.acid && shot && shot.hits > 0) {
        var t = pickTargetOf(u, E, frame);
        if (t) {
          j.acid = false;
          j.dot = { target: t, next: frame + FPS, until: frame + ACID_SECONDS * FPS };
          E.event({ frame: frame, kind: 'jill-acid', side: u.side, unit: u.name, target: t.name });
        }
      }
    },

    onBurst: function (u, E, frame) {
      // 残弾数100%減少 + 強制リロード
      var f = u.firing;
      if (!f) return;
      f.shotsInMagazine = 0;
      if (f.reloadFrames > 0) {
        f.nextFrame = frame + f.reloadFrames;
        f.reloadingUntil = f.nextFrame;
      }
    }
  };
})();
