/* マリアン：クイーン (id 168 / org 204, MG / B3 / 火力型 / 灼熱) — 宝物なし
 *
 * パーサが既に動かしているもの（ここでは触らない）:
 *   - バーストの 攻撃力78.4%▲ / 攻撃ダメージ78.14%▲：10秒、敵全体へ 1346.4%
 *   - skill2 フルバースト時の コアダメージ24.64%▲：10秒（engine は coreDmgPct を
 *     読まないため数値効果は無い）
 *
 * パーサで表現できていない部分:
 *   - skill1「戦闘開始時、自分に 臨戦：意思の鋭槍」
 *       機能：ランダムな敵にダークマターの槍を発射する
 *       ・ダークマターの槍：最終攻撃力の125.51%のダメージ：7回順番に攻撃
 *       ・命中した対象に 弱点露出：受けるダメージ5.05%▲：持続・解除不可
 *       ・再発動周期：4秒
 *     パーサはこのブロックを「自分自身への125.51%ダメージ＋自分への被ダメ
 *     デバフ」として解釈してしまい、毎回自分を撃っているため効果を空にする。
 *   - skill1「バーストスキルを使用した時、敵全体に 弱点露出」
 *     槍の命中時と同じ debuff を二重に付けないよう、パーサ側のブロックを
 *     空にして、onBurst で 1 本にまとめて付与する。
 *   - skill2「バーストスキルを使用した時、自分に 臨戦：胸を刺す願い」
 *       ・通常攻撃で2回攻撃した時、弱点露出状態の敵全体に
 *         最終攻撃力の14.06%のコア命中ダメージ
 *       ・自分に 臨戦：意思の鋭槍再発動周期2秒▼：10秒間維持
 *     パーサはこのブロックも「自分への14.06%ダメージ」にしているため空にする。
 *     状態の持続時間は原文に無いので、効果2と同じ10秒として扱う。
 *   - skill2「フルバーストタイムが発動した時、自分が臨戦：胸を刺す願い状態で
 *     なければ、自分に 順番攻撃ダメージ85.17%：10秒間維持」
 *     順番攻撃（＝ダークマターの槍の7連撃）のダメージ上昇として扱う。
 *
 * 実装していないもの:
 *   - 「マシンガン立ち上げ速度100%」。engine の MG 立ち上げは gauge.js の固定
 *     テーブルで、バースト時点では既に立ち上げが終わっている。
 *   - コア命中ダメージの「コア」部分。アリーナにコアヒットが無い。
 */
(function () {
  'use strict';

  var FPS = 60;
  var SPEAR_PCT = 125.51;      /* 原文: 最終攻撃力の125.51%のダメージ */
  var SPEAR_HITS = 7;          /* 原文: 7回順番に攻撃 */
  var WEAK_UP = 5.05;          /* 原文: 弱点露出：受けるダメージ5.05%▲ */
  var SPEAR_PERIOD = 4;        /* 原文: 再発動周期：4秒 */
  var FAST_PERIOD = 2;         /* 原文: 再発動周期2秒▼ */
  var STATE_SECONDS = 10;      /* 原文: 10秒間維持 */
  var CORE_PCT = 14.06;        /* 原文: 最終攻撃力の14.06%のコア命中ダメージ */
  var SEQ_DMG_UP = 85.17;      /* 原文: 順番攻撃ダメージ85.17% */

  function copySkills(u) {
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (!src) return null;
    u.skills = JSON.parse(JSON.stringify(src));
    for (var s = 0; s < u.skillState.length; s++) {
      var st = u.skillState[s];
      var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
      if (!arr) continue;
      for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
    }
    return u.skills;
  }

  /* engine の乱数は API に無いので、フレームと添字から決まる疑似乱数で選ぶ */
  function randomEnemy(u, E, frame, index) {
    var list = E.alive(E.enemies(u));
    if (!list.length) return null;
    var h = (frame * 2654435761 + index * 40503 + u.pos * 97) >>> 0;
    return list[h % list.length];
  }

  /* 弱点露出（持続・解除不可）。key を揃えて何度当てても 1 本にまとめる。 */
  function applyWeak(t, u, E) {
    if (!t.marianWeak) {
      E.buff(t, 'marian-weak:' + u.pos, 'takenDmgPct', WEAK_UP, 'up', Infinity, {});
      t.marianWeak = true;
    }
  }

  function fireSpear(u, E, frame) {
    var s = u.marian;
    var mult = SPEAR_PCT * (frame <= s.seqUntil ? (1 + SEQ_DMG_UP / 100) : 1);
    for (var i = 0; i < SPEAR_HITS; i++) {
      var t = randomEnemy(u, E, frame, i);
      if (!t) return;
      E.damage(u, t, frame, { multiplierPct: mult });
      applyWeak(t, u, E);
    }
    E.event({ frame: frame, kind: 'marian-spear', side: u.side, unit: u.name });
  }

  (window.SPECIALS = window.SPECIALS || {})[168] = {
    init: function (u, E) {
      u.marian = {
        spearNext: 0,
        fastUntil: -1,
        wishUntil: -1,
        attacks: 0,
        seqUntil: -1,
        fbFrame: -1
      };

      var sk = copySkills(u);
      if (sk && sk.skill1) {
        for (var i = 0; i < sk.skill1.blocks.length; i++) {
          var t1 = sk.skill1.blocks[i].trigger || {};
          /* 戦闘開始時のブロックは「自分を撃つ」誤解釈なので止める */
          if (t1.kind === 'battleStart') sk.skill1.blocks[i].effects = [];
          /* バースト時の弱点露出は、槍の命中時と同じ debuff を二重に付けないよう
           * ここで止めて、下の onBurst で 1 本にまとめて付与する */
          if (t1.kind === 'burst') sk.skill1.blocks[i].effects = [];
        }
      }
      if (sk && sk.skill2) {
        /* バースト時のブロックも「自分を撃つ」誤解釈なので止める */
        for (var j = 0; j < sk.skill2.blocks.length; j++) {
          var t2 = sk.skill2.blocks[j].trigger || {};
          if (t2.kind === 'burst') sk.skill2.blocks[j].effects = [];
        }
      }
    },

    tick: function (u, E, frame) {
      var s = u.marian;
      if (!s) return;

      /* 臨戦：意思の鋭槍（4秒ごと / 胸を刺す願い中は2秒ごと） */
      if (frame >= s.spearNext) {
        var period = frame <= s.fastUntil ? FAST_PERIOD : SPEAR_PERIOD;
        s.spearNext = frame + period * FPS;
        fireSpear(u, E, frame);
      }

      /* フルバーストタイムの発動検出 */
      var lb = (E.team(u) || []).lastBurst;
      if (lb && lb.stage === 'B3' && lb.frame !== s.fbFrame &&
          frame >= lb.frame && frame <= lb.frame + STATE_SECONDS * FPS) {
        s.fbFrame = lb.frame;
        if (frame > s.wishUntil) {
          /* 臨戦：胸を刺す願い状態でなければ 順番攻撃ダメージ85.17%：10秒 */
          s.seqUntil = frame + STATE_SECONDS * FPS;
          E.event({ frame: frame, kind: 'marian-seq-up', side: u.side, unit: u.name });
        }
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = u.marian;
      if (!s) return;
      if (frame > s.wishUntil) return;

      /* 胸を刺す願い：通常攻撃で2回攻撃した時、
       * 弱点露出状態の敵全体に 最終攻撃力の14.06%のコア命中ダメージ */
      s.attacks += 1;
      if (s.attacks % 2 !== 0) return;
      var foes = E.alive(E.enemies(u));
      for (var i = 0; i < foes.length; i++) {
        if (!foes[i].marianWeak) continue;
        E.damage(u, foes[i], frame, { multiplierPct: CORE_PCT });
      }
    },

    onBurst: function (u, E, frame) {
      var s = u.marian;
      if (!s) return;

      /* 臨戦：胸を刺す願い（10秒）＋ 再発動周期2秒▼（10秒） */
      s.wishUntil = frame + STATE_SECONDS * FPS;
      s.fastUntil = frame + STATE_SECONDS * FPS;
      s.attacks = 0;

      /* バースト使用時の弱点露出（パーサが敵全体へ付与する）を状態にも記録 */
      var foes = E.alive(E.enemies(u));
      for (var i = 0; i < foes.length; i++) applyWeak(foes[i], u, E);

      /* 弾丸チャージ100%（engine は op:bulletCharge を処理しないので装弾を満タンに戻す） */
      if (u.firing && isFinite(u.firing.magazine) && u.firing.magazine > 0) {
        u.firing.shotsInMagazine = 0;
      }

      E.event({ frame: frame, kind: 'marian-wish', side: u.side, unit: u.name });
    }
  };
})();
