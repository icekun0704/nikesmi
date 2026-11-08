/* シュガー (id 23 / org 100, SG, B3, 火力型, 鉄甲) ※宝物なし
 *
 * 原文の状態機械:
 *   skill1
 *     遮蔽物が攻撃を受けた時、20%の確率で自分に
 *       クリティカルダメージ16.39%▲：10秒間維持
 *       リロード速度12.12%▲：10秒間維持
 *   skill2
 *     フルバーストタイムが発動した時、自分に
 *       クリティカル確率13.02%▲：10秒間維持               ← パーサ済み
 *     フルバーストタイムが発動した時、ショットガンを所持する味方全体に
 *       最大装弾数83.8%▲：10秒間維持                      ← パーサ済み
 *   burst
 *     自分に 攻撃速度66%▲：15秒／命中率33%▲：15秒         ← パーサ済み
 *
 * パーサの扱い:
 *   - skill1 は trigger:unknown（「遮蔽物が攻撃を受けた時」）。
 *     engine は遮蔽物（u.coverHp）がダメージを受けるので、その減少を検出して
 *     20%の確率で発動する。
 *
 * 実装しないもの:
 *   - 命中率・攻撃速度：engine のダメージ計算／射撃間隔で使われない。
 *   - リロード速度（reloadSpeedPct）は engine のリロード時間計算で使われない。
 */
(function () {
  'use strict';

  var FPS = 60;
  var PROC_PCT = 20;             /* 20%の確率で */
  var CRITDMG_PCT = 16.39;       /* クリティカルダメージ16.39%▲：10秒 */
  var RELOAD_PCT = 12.12;        /* リロード速度12.12%▲：10秒 */
  var BUFF_SEC = 10;

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  function roll(s) {
    s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
    return s.rng / 4294967296;
  }

  (window.SPECIALS = window.SPECIALS || {})[23] = {
    init: function (u, E) {
      u.sugar = {
        lastCover: u.coverHp,
        rng: ((u.pos + 1) * 2246822519 + (u.side === 'A' ? 7 : 13)) >>> 0
      };
    },

    tick: function (u, E, frame) {
      var s = u.sugar;
      if (!s) return;
      var cover = u.coverHp;
      if (cover >= s.lastCover) { s.lastCover = cover; return; }
      s.lastCover = cover;

      /* 遮蔽物が攻撃を受けた時、20%の確率で自分にクリティカルダメージ／リロード速度 */
      if (roll(s) * 100 >= PROC_PCT) return;
      var until = frame + BUFF_SEC * FPS;
      E.buff(u, 'sugar-cover-critdmg', 'critDmgPct',
        CRITDMG_PCT * scaleOf(u, 'skill1'), 'up', until, {});
      E.buff(u, 'sugar-cover-reload', 'reloadSpeedPct',
        RELOAD_PCT * scaleOf(u, 'skill1'), 'up', until, {});
      E.event({ frame: frame, kind: 'sugar-cover', side: u.side, unit: u.name });
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) { }
  };
})();
