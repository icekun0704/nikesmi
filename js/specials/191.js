/* スノーホワイト：イノセントデイズ (id 191 / org 98, AR, B3, 火力型)
 *
 * パーサで表現できていない部分:
 *   - バースト「スキル2の命中回数条件20回▼：10秒間維持」
 *     スキル2のカウンタは 50回 で組まれている。原文は「20回▼」なので
 *     10秒間だけ条件を 50 → 30 回に下げる。
 *     このユニット専用にスキル定義を複製し、スキル2の counter ブロックの
 *     n を差し替える（SKILL_DB は全ユニット共有なので直接は触らない）。
 *   - バースト「装弾数無限：10秒間維持」
 *     op:infiniteMagazine は engine の applyEffect が知らない。
 *     10秒間、装弾数を Infinity にしてリロードを止める（Gauge.liftAfterShot は
 *     magazine が有限のときだけリロードする）。
 *
 * パーサが処理済みなので触らないもの:
 *   - スキル1/2 の命中回数カウンタとダメージ
 *   - バーストの攻撃力97.2%▲（発動者基準）とスキル2の攻撃ダメージ21.12%▲
 */
(function () {
  'use strict';

  var CONDITION_SECONDS = 10;    /* 原文: 10秒間維持 */
  var CONDITION_REDUCE = 20;     /* 原文: 命中回数条件20回▼ */
  var BASE_CONDITION = 50;       /* スキル2「通常攻撃が50回命中した時」 */

  function cloneSkills(u) {
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (!src || !u.skillState) return;
    u.skills = JSON.parse(JSON.stringify(src));
    for (var s = 0; s < u.skillState.length; s++) {
      var st = u.skillState[s];
      var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
      if (!arr) continue;
      for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
    }
  }

  /* スキル2の「通常攻撃が50回命中した時」カウンタ */
  function skill2CounterBlock(u) {
    if (!u.skills || !u.skills.skill2) return null;
    var blocks = u.skills.skill2.blocks;
    for (var i = 0; i < blocks.length; i++) {
      var t = blocks[i].trigger || {};
      if (t.kind === 'counter' && t.on === 'attackHits') return blocks[i];
    }
    return null;
  }

  (window.SPECIALS = window.SPECIALS || {})[191] = {
    init: function (u, E) {
      cloneSkills(u);
      u.swid = {
        block: skill2CounterBlock(u),
        base: BASE_CONDITION,
        reduced: BASE_CONDITION - CONDITION_REDUCE,
        until: -1,
        unlimited: false,
        savedMagazine: null
      };
    },

    tick: function (u, E, frame) {
      var s = u.swid;
      if (!s) return;
      if (s.until < 0 || frame <= s.until) return;

      /* 効果時間の終了 */
      if (s.block && s.block.trigger) s.block.trigger.n = s.base;
      if (s.unlimited && u.firing) {
        u.firing.magazine = s.savedMagazine;
        s.unlimited = false;
        s.savedMagazine = null;
      }
      s.until = -1;
      E.event({ frame: frame, kind: 'swid-burst-end', side: u.side, unit: u.name });
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) {
      var s = u.swid;
      if (!s) return;

      /* スキル2の命中回数条件 50 → 30 */
      if (s.block && s.block.trigger) s.block.trigger.n = s.reduced;

      /* 装弾数無限 */
      if (!s.unlimited && u.firing) {
        s.savedMagazine = u.firing.magazine;
        u.firing.magazine = Infinity;
        s.unlimited = true;
      }
      s.until = frame + CONDITION_SECONDS * E.FPS;
      E.event({ frame: frame, kind: 'swid-burst', side: u.side, unit: u.name });
    }
  };
})();
