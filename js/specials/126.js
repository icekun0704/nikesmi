/* ヘルム：アクアマリン (id 126 / org 60, AR / B2 / 火力型 / 鉄甲) — 宝物なし
 *
 * パーサが既に動かしているもの（ここでは触らない）:
 *   - バーストの 敵全体 164.83%
 *   - skill1 通常攻撃30回命中時の 対象へ 131.34%追加ダメージ
 *
 * パーサで表現できていない部分:
 *   - バースト「対象が電撃コードなら、同じ敵に 最終攻撃力の164.83%の追加ダメージ」
 *     パーサは条件を落として敵全体に毎回追加ダメージを撃つため、
 *     このブロックを空にして電撃コードの敵だけへ撃ち直す。
 *   - skill1「フルバーストタイムが発動した時、味方全体に 開始回数別の効果、
 *     下位効果スタック適用」
 *       1回目：バーストスキルクールタイム1.82秒▼
 *       2回目：同 2.2秒▼
 *       3回目：同 2.6秒▼
 *     パーサは3つを毎回すべて発動させ、しかも op:burstCd は engine では
 *     発動者自身にしか効かない。ここでは「n回目の発動時に1回目〜n回目までを
 *     同時適用」とし、味方全体の burstReadyAt を直接減らす。
 *   - skill2「対象が電撃コードなら、同じ敵に 受けるダメージ5.64%▲：5スタック：
 *     5秒間維持」（trigger:unknown で発動しない）
 *     同じスキル2の「ランダムに敵1機へ 105.58%」と対象が同じ敵になる必要が
 *     あるため、skill2 の2ブロックを空にして周期ごと自前で回す。
 *
 * 実装していないもの: なし
 */
(function () {
  'use strict';

  var FPS = 60;
  var S2_PERIOD = 4;          /* パース結果のスキル2周期（4秒） */
  var S2_PCT = 105.58;        /* 原文: 最終攻撃力の105.58%のダメージ */
  var S2_TAKEN = 5.64;        /* 原文: 受けるダメージ5.64%▲ */
  var S2_STACKS = 5;          /* 原文: 5スタック */
  var S2_SECONDS = 5;         /* 原文: 5秒間維持 */
  var BURST_EXTRA = 164.83;   /* 原文: 最終攻撃力の164.83%の追加ダメージ */
  var FB_CD_DOWN = [1.82, 2.2, 2.6];  /* 原文: 1回目/2回目/3回目 */

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

  (window.SPECIALS = window.SPECIALS || {})[126] = {
    init: function (u, E) {
      u.helmAqua = { next: 0, fbUsed: 0, fbFrame: -1 };

      var sk = copySkills(u);
      if (sk && sk.burst && sk.burst.blocks[1]) {
        sk.burst.blocks[1].effects = [];   /* 条件付きの追加ダメージを自前で撃つ */
      }
      if (sk && sk.skill1 && sk.skill1.blocks[1]) {
        sk.skill1.blocks[1].effects = [];  /* 開始回数別の cd 減少を自前で撃つ */
      }
      if (sk && sk.skill2) {
        if (sk.skill2.blocks[0]) sk.skill2.blocks[0].effects = [];
        if (sk.skill2.blocks[1]) sk.skill2.blocks[1].effects = [];
      }
    },

    tick: function (u, E, frame) {
      var s = u.helmAqua;
      if (!s) return;

      /* フルバーストタイムの発動（開始回数別・下位効果スタック適用） */
      var lb = (E.team(u) || []).lastBurst;
      if (lb && lb.stage === 'B3' && lb.frame !== s.fbFrame &&
          frame >= lb.frame && frame <= lb.frame + 10 * FPS) {
        s.fbFrame = lb.frame;
        if (s.fbUsed < FB_CD_DOWN.length) s.fbUsed += 1;
        var allies = E.alive(E.team(u));
        for (var n = 0; n < s.fbUsed; n++) {
          var amount = FB_CD_DOWN[n] * FPS;
          for (var i = 0; i < allies.length; i++) {
            allies[i].burstReadyAt = Math.max(0, allies[i].burstReadyAt - amount);
          }
        }
        E.event({ frame: frame, kind: 'helm-fb-cd', side: u.side, unit: u.name,
                  use: s.fbUsed });
      }

      /* skill2：ランダムに敵1機へ 105.58%（4秒ごと） */
      if (frame >= s.next) {
        s.next = frame + S2_PERIOD * FPS;
        var t = randomEnemy(u, E, frame, s.fbUsed);
        if (t) {
          E.damage(u, t, frame, { multiplierPct: S2_PCT });
          /* 対象が電撃コードなら、同じ敵に 受けるダメージ5.64%▲：5スタック：5秒 */
          if (t.element === '電撃') {
            E.buff(t, 'helm-taken:' + u.pos + ':' + t.pos, 'takenDmgPct', S2_TAKEN,
              'up', frame + S2_SECONDS * FPS, { maxStacks: S2_STACKS });
          }
        }
      }
    },

    onShot: function () { /* 通常攻撃に固有処理なし */ },

    onBurst: function (u, E, frame) {
      /* 対象が電撃コードなら、同じ敵に 最終攻撃力の164.83%の追加ダメージ */
      var foes = E.alive(E.enemies(u));
      for (var i = 0; i < foes.length; i++) {
        if (foes[i].element !== '電撃') continue;
        E.damage(u, foes[i], frame, { multiplierPct: BURST_EXTRA });
      }
    }
  };
})();
