/* レイヴン (id 59 / org 159, RL / B3 / 火力型 / 鉄甲) — 宝物なし
 *
 * パーサが既に動かしているもの（ここでは触らない）:
 *   - バーストの敵全体 492.3% と 持続ダメージ89.44%▲：10秒
 *   - skill1 フルバースト時の 発動者基準 攻撃力47.52%▲：10秒
 *   - skill2 急所攻略（パーツダメージ21.12%▲）：戦闘開始時 / フルバースト時
 *
 * パーサで表現できていない部分:
 *   - skill1「フルチャージして攻撃した時、照準線に最も近い敵1機に
 *     最終攻撃力の68.46%の持続ダメージ：1秒間隔：10スタック：5秒間維持」
 *     パーサは1回ぶんの即時ダメージにしてしまうので、その効果を空にして
 *     スタック（最大10）＋毎秒の持続ダメージとして撃ち直す。
 *   - バースト「A.N.モード」の状態。効果2の 持続ダメージ89.44%▲ はパーサが
 *     動かしているので、ここでは状態フラグだけ持つ。
 *
 * 実装していないもの:
 *   - バースト「A.N.モード 効果1：一点集中解除」と skill2
 *     「味方がパーツを破壊した時 → 一点集中：持続ダメージ47.32%▲：15秒」。
 *     アリーナにパーツが無いため、一点集中は発生も解除もされない。
 *   - 急所攻略（パーツダメージ）は engine が partDmgPct を読まないため数値効果なし。
 */
(function () {
  'use strict';

  var FPS = 60;
  var DOT_PCT = 68.46;     /* 原文: 最終攻撃力の68.46%の持続ダメージ */
  var DOT_SECONDS = 5;     /* 原文: 5秒間維持 */
  var MAX_STACKS = 10;     /* 原文: 10スタック */

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

  (window.SPECIALS = window.SPECIALS || {})[59] = {
    init: function (u, E) {
      u.raven = { stacks: [], nextTick: 60, anMode: false };

      var sk = copySkills(u);
      if (sk && sk.skill1) {
        for (var i = 0; i < sk.skill1.blocks.length; i++) {
          var b = sk.skill1.blocks[i];
          var t = b.trigger || {};
          if (t.kind !== 'fullChargeShot') continue;
          /* 即時1回ぶんのダメージを止めて、持続ダメージとして撃ち直す */
          for (var e = b.effects.length - 1; e >= 0; e--) {
            if (b.effects[e].op === 'damage') b.effects.splice(e, 1);
          }
        }
      }
    },

    tick: function (u, E, frame) {
      var s = u.raven;
      if (!s) return;

      /* 持続ダメージは1秒間隔。スタックごとに5秒間維持。 */
      if (frame < s.nextTick) return;
      s.nextTick += 60;
      for (var i = s.stacks.length - 1; i >= 0; i--) {
        var st = s.stacks[i];
        if (frame > st.until) { s.stacks.splice(i, 1); continue; }
        if (st.target && st.target.alive) {
          E.damage(u, st.target, frame, { multiplierPct: DOT_PCT, isSustained: true });
        }
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = u.raven;
      if (!s) return;
      /* RL の通常攻撃はすべてフルチャージ攻撃 */
      if (u.weapon !== 'RL' && u.weapon !== 'SR') return;
      var t = primaryTarget(u, E, frame);
      if (!t) return;
      s.stacks.push({ target: t, until: frame + DOT_SECONDS * FPS });
      if (s.stacks.length > MAX_STACKS) s.stacks.shift();
    },

    onBurst: function (u, E, frame) {
      var s = u.raven;
      if (!s) return;
      /* A.N.モード（一点集中解除。パーツが無いので実質フラグのみ） */
      s.anMode = true;
      E.event({ frame: frame, kind: 'raven-an-mode', side: u.side, unit: u.name });
    }
  };
})();
