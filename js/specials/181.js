/* ラピ：レッドフード (181 / org 142)
 *
 * パーサで表現できていない部分だけを実装する。
 *
 * 実装:
 *   バーストⅢで使用した時、10秒間だけスキル2「粘着榴弾」の発動条件が
 *   120回 → 60回 に変わる（burst 10行目）。
 *   ダメージ自体（88.11% × 2）はパーサが counter で出しているので触らない。
 *   条件オブジェクトは SKILL_DB と共有なので、init でこの個体専用に複製してから
 *   n を書き換える（同じキャラが両チームに居ても干渉しない）。
 *
 * 未実装（理由）:
 *   - 「発射体付着ダメージ▲」「発射体爆発ダメージ▲」… engine に発射体の概念が無く、
 *     パーサも projectileDmgPct として積むだけ（engine 側が読まない）。
 *   - バーストⅠ／Ⅲの分岐… engine は burst ブロックを段階で選ばず全部発動するため、
 *     B1 の「爆発範囲」「クールタイム」と B3 の「2808%ダメージ」が毎回同時に乗る。
 *     これは skill データ側の問題なので、このファイルからは打ち消せない。
 *   - 戦闘補助（B1 への変更）… Gauge.burstSequence が isRapiRH で既に扱っているので不要。
 */
(function () {
  'use strict';

  var BASE_N = 120;   /* 原文: 通常攻撃で120回攻撃した時 */
  var BURST_N = 60;   /* 原文: スキル2粘着榴弾発動回数条件60回▼ */

  /* スキル2 の「通常攻撃で◯回攻撃した時」ブロック（この個体のぶん） */
  function bombBlock(u) {
    if (!u.skillState) return null;
    for (var s = 0; s < u.skillState.length; s++) {
      var sk = u.skillState[s];
      if (sk.slot !== 'skill2') continue;
      for (var b = 0; b < sk.blocks.length; b++) {
        var bs = sk.blocks[b];
        var t = bs.block && bs.block.trigger;
        if (t && t.kind === 'counter' && t.on === 'attackShots') return bs;
      }
    }
    return null;
  }

  function ownTrigger(u) {
    var bs = bombBlock(u);
    if (!bs) return null;
    if (!bs._rhOwn) {
      bs.block = Object.assign({}, bs.block, {
        trigger: Object.assign({}, bs.block.trigger)
      });
      bs._rhOwn = true;
    }
    return bs.block.trigger;
  }

  function setThreshold(u, n) {
    var t = ownTrigger(u);
    if (t && t.n !== n) t.n = n;
  }

  (window.SPECIALS = window.SPECIALS || {})[181] = {
    init: function (u, E) {
      u.rhBombUntil = -1;
      setThreshold(u, BASE_N);
    },
    tick: function (u, E, frame) {
      setThreshold(u, frame <= u.rhBombUntil ? BURST_N : BASE_N);
    },
    onShot: function (u, E, frame, shot) { },
    onBurst: function (u, E, frame) {
      if (u.burstStageUsed === 'B3') u.rhBombUntil = frame + 10 * E.FPS;
    }
  };
})();
