/* ベロータ：パンプキンウィッチ (id 194 / org 203, RL / B2 / 支援型 / 水冷) — 宝物なし
 *
 * パーサが既に動かしているもの（ここでは触らない）:
 *   - skill1 フルバースト時の イタズラ準備：最大HP15.84%▲：10秒
 *
 * パーサで表現できていない部分:
 *   - 「自分の右隣の味方1機」の対象指定。パーサは味方のうち pos が最も小さい
 *     1機（＝左端）を選んでしまうため、下の3ブロックを空にして
 *     右隣（team[pos+1]）へ撃ち直す。
 *       バースト：発動者基準 攻撃力47.52%▲ / 持続ダメージ27.23%▲：10秒
 *       skill1 フルバースト時：発動者基準 攻撃力44.88%▲：10秒
 *       skill2 フルチャージ時：持続ダメージ19.97%▲：5秒
 *   - skill1 おばけの仮装（単一攻撃の対象から除外 / 直接攻撃を受けると解除）：
 *     10秒間の状態。engine の pickTarget には対象除外の口が無いので、
 *     「直接攻撃を受けたら解除」だけを被ダメージの増加で判定する。
 *   - skill2「フルチャージ攻撃が命中した時、自分がおばけの仮装状態なら、対象に
 *     おばけのイタズラ：受けるダメージ10.56%▲：10秒」
 *     パーサは条件を落として毎回付与するため、効果を空にして条件付きで撃つ。
 *
 * 実装していないもの:
 *   - おばけの仮装「単一攻撃の対象から除外」。engine 側に対象除外の口が無い。
 */
(function () {
  'use strict';

  var FPS = 60;
  var GHOST_SECONDS = 10;   /* 原文: おばけの仮装：10秒間維持 */
  var TRICK_UP = 10.56;     /* 原文: おばけのイタズラ：受けるダメージ10.56%▲ */
  var TRICK_SECONDS = 10;   /* 原文: 10秒間維持 */
  var SUSTAIN_5 = 19.97;    /* 原文: 持続ダメージ19.97%▲：5秒間維持 */
  var SUSTAIN_10 = 27.23;   /* 原文: 持続ダメージ27.23%▲：10秒間維持 */
  var ATK_BURST = 47.52;    /* 原文: 発動者基準で攻撃力47.52%▲ */
  var ATK_FB = 44.88;       /* 原文: 発動者基準で攻撃力44.88%▲ */

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

  function primaryTarget(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  /* 右隣の味方1機（team は pos 昇順で並んでいる） */
  function rightNeighbor(u, E) {
    var team = E.team(u) || [];
    var n = team[u.pos + 1];
    if (!n || !n.alive) return null;
    return n;
  }

  function grantAtk(u, E, frame, target, pct, seconds) {
    if (!target) return;
    var flat = E.atkEff(u) * pct / 100;   /* スキル発動者基準 */
    E.buff(target, 'pumpkin-atk:' + u.pos + ':' + target.pos, 'atkFlat', flat,
      'up', frame + seconds * FPS, {});
  }

  (window.SPECIALS = window.SPECIALS || {})[194] = {
    init: function (u, E) {
      u.pumpkin = { ghostUntil: -1, lastTaken: 0, fbFrame: -1 };

      var sk = copySkills(u);
      /* 右隣を対象にすべきブロック（パーサは左端を選ぶ）と、
       * おばけの仮装の条件が落ちているブロックを空にする。 */
      if (sk && sk.burst && sk.burst.blocks[0]) sk.burst.blocks[0].effects = [];
      if (sk && sk.skill1 && sk.skill1.blocks[1]) sk.skill1.blocks[1].effects = [];
      if (sk && sk.skill2) {
        if (sk.skill2.blocks[0]) sk.skill2.blocks[0].effects = [];
        if (sk.skill2.blocks[1]) sk.skill2.blocks[1].effects = [];
      }
    },

    tick: function (u, E, frame) {
      var s = u.pumpkin;
      if (!s) return;

      /* フルバーストタイムの発動検出 */
      var lb = (E.team(u) || []).lastBurst;
      if (lb && lb.stage === 'B3' && lb.frame !== s.fbFrame &&
          frame >= lb.frame && frame <= lb.frame + GHOST_SECONDS * FPS) {
        s.fbFrame = lb.frame;
        /* おばけの仮装：10秒間維持 */
        s.ghostUntil = frame + GHOST_SECONDS * FPS;
        /* 右隣の味方1機に 発動者基準 攻撃力44.88%▲：10秒 */
        grantAtk(u, E, frame, rightNeighbor(u, E), ATK_FB, 10);
        E.event({ frame: frame, kind: 'pumpkin-ghost', side: u.side, unit: u.name });
      }

      /* おばけの仮装：直接攻撃を受けると解除（被ダメージの増加で判定） */
      var taken = u.damageTaken || 0;
      if (s.ghostUntil >= frame && taken > s.lastTaken) {
        s.ghostUntil = -1;
        E.event({ frame: frame, kind: 'pumpkin-ghost-break', side: u.side, unit: u.name });
      }
      s.lastTaken = taken;
    },

    onShot: function (u, E, frame, shot) {
      var s = u.pumpkin;
      if (!s) return;
      /* RL の通常攻撃はすべてフルチャージ攻撃 */
      if (u.weapon !== 'RL' && u.weapon !== 'SR') return;

      /* おばけの仮装状態なら、対象に 受けるダメージ10.56%▲：10秒 */
      if (frame <= s.ghostUntil) {
        var t = primaryTarget(u, E, frame);
        if (t) {
          E.buff(t, 'pumpkin-trick:' + u.pos + ':' + t.pos, 'takenDmgPct', TRICK_UP,
            'up', frame + TRICK_SECONDS * FPS, {});
        }
      }

      /* フルチャージして攻撃した時、右隣の味方1機に 持続ダメージ19.97%▲：5秒 */
      var n = rightNeighbor(u, E);
      if (n) {
        E.buff(n, 'pumpkin-sust:' + u.pos + ':' + n.pos, 'sustainedDmgPct', SUSTAIN_5,
          'up', frame + 5 * FPS, {});
      }
    },

    onBurst: function (u, E, frame) {
      var s = u.pumpkin;
      if (!s) return;
      /* 自分の右隣の味方1機に
       *   発動者基準 攻撃力47.52%▲ / 持続ダメージ27.23%▲：10秒 */
      var n = rightNeighbor(u, E);
      if (!n) return;
      grantAtk(u, E, frame, n, ATK_BURST, 10);
      E.buff(n, 'pumpkin-burst-sust:' + u.pos + ':' + n.pos, 'sustainedDmgPct', SUSTAIN_10,
        'up', frame + 10 * FPS, {});
    }
  };
})();
