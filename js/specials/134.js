/* ルピー：ウィンターショッパー (id 134 / org 16, AR, B1, 防御型, 電撃)
 *
 * 原文の状態機械:
 *   skill1
 *     最後の弾丸が命中した時、味方全体に 防御力19.02%▲：5秒間維持  ← パーサ済み
 *   skill2
 *     味方がバーストスキルを使用した時、味方全体に
 *       ショッピング：防御力1.33%▲：4スタック：20秒間維持        ← パーサ済み
 *     フルバーストタイムを終了した時、自分がショッピングのフルスタック状態なら、
 *       味方全体に バーストゲージのチャージ速度7.9%▲：5秒間維持
 *   burst
 *     自分に ヘイト（挑発）5秒／攻撃ダメージの50.47%回復：10秒 ※パーサ済み
 *     味方全体に リロード速度63.17%▲：10秒／バースト再突入1段階 ※パーサ済み
 *
 * パーサの扱い:
 *   - skill2 の2ブロック目は trigger:unknown。
 *   - 「バースト再突入1段階」は op:reentry で engine に処理が無い。
 *
 * 実装しないもの:
 *   - バースト再突入：engine のバーストチェーンに再突入の概念が無い。
 *   - リロード速度（reloadSpeedPct）は engine のリロード時間計算で使われない。
 */
(function () {
  'use strict';

  var FPS = 60;
  var FB_FRAMES = 10 * FPS;
  var SHOP_MAX = 4;                 /* 4スタック */
  var GAUGE_SPEED_PCT = 7.9;        /* バーストゲージのチャージ速度7.9%▲：5秒 */
  var GAUGE_SEC = 5;
  var SHOP_SEC = 20;                /* 20秒間維持 */

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  (window.SPECIALS = window.SPECIALS || {})[134] = {
    init: function (u, E) {
      u.rupee = {
        stacks: 0,
        until: -1,
        lastBurstFrame: -1,
        fbEndFrame: -1
      };
    },

    tick: function (u, E, frame) {
      var s = u.rupee;
      if (!s) return;

      /* 味方（自分以外）のバースト使用でショッピングのスタックを数える */
      var lb = E.team(u).lastBurst;
      if (lb && lb.frame !== s.lastBurstFrame) {
        s.lastBurstFrame = lb.frame;
        if (lb.unit && lb.unit !== u) {
          s.stacks = (frame <= s.until) ? Math.min(SHOP_MAX, s.stacks + 1) : 1;
          s.until = frame + SHOP_SEC * FPS;
        }
        if (lb.stage === 'B3') s.fbEndFrame = lb.frame + FB_FRAMES + 1;
      }

      /* フルバーストタイムを終了した時：フルスタックならゲージチャージ速度7.9%▲ */
      if (s.fbEndFrame >= 0 && frame >= s.fbEndFrame) {
        s.fbEndFrame = -1;
        if (s.stacks >= SHOP_MAX) {
          var mates = E.alive(E.team(u));
          for (var i = 0; i < mates.length; i++) {
            E.buff(mates[i], 'rupee-fb-gauge:' + u.pos, 'burstGaugePct',
              GAUGE_SPEED_PCT * scaleOf(u, 'skill2'), 'up',
              frame + GAUGE_SEC * FPS, {});
          }
          E.event({ frame: frame, kind: 'rupee-fb-gauge', side: u.side, unit: u.name });
        }
      }
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) { }
  };
})();
