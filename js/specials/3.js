/* スノーホワイト：ヘビーアームズ (id 3 / org 178)
 *
 * ロックオン・オートファイア準備・セブンスドワーフ・フルアクティブの本体は
 * engine.js が u.swha として実装済み（makeUnit / fireBurst / 射撃ループ）。
 * ここで足すのは engine が持っていない「解除」だけ。
 *
 * 原文 skill1 末尾:
 *   通常攻撃をした時、フルバースト状態でなければ自分に
 *   ・セブンスドワーフ・フルアクティブ解除
 * 原文 burst:
 *   効果1：チャージ時間3.2秒に固定 / 効果2：最大ロックオン対象数10 / 効果3：装填10
 *   使用回数：2回 / 解除条件：使用回数を使い切った時   ← engine 側
 * 原文 skill2 先頭:
 *   戦闘開始時、チャージ時間1.2秒に固定
 *   → 素の chargeFrames が 72 (=1.2秒) なので engine の射撃周期と一致しており追加不要。
 */
(function () {
  'use strict';

  var FB_FRAMES = 10 * 60; /* engine.js の FB_FRAMES と同じ 10 秒 */

  /* engine は B3 バーストの瞬間に team.lastBurst を更新し、そこから 10 秒が
   * フルバーストタイム。SPECIALS から読める唯一の手掛かり。 */
  function inFullBurst(u, frame) {
    var lb = u.team && u.team.lastBurst;
    return !!(lb && lb.stage === 'B3' && frame >= lb.frame && frame <= lb.frame + FB_FRAMES);
  }

  (window.SPECIALS = window.SPECIALS || {})[3] = {
    init: function (u, E) {
      /* engine 側の状態が無ければ何もしない */
    },

    tick: function (u, E, frame) {
      /* 解除は「通常攻撃をした時」なので onShot 側で行う */
    },

    onShot: function (u, E, frame, shot) {
      var st = u.swha;
      if (!st) return;
      if (st.fullActive > 0 && !inFullBurst(u, frame)) {
        /* セブンスドワーフ・フルアクティブ解除 */
        st.fullActive = 0;
        st.maxLocks = 5;
        st.maxRounds = 5;
        u.chargeFixed = Math.round(1.2 * E.FPS);
      }
    },

    onBurst: function (u, E, frame) {
      /* 発動自体は engine.fireBurst が処理する */
    }
  };
})();
