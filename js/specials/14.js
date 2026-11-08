/* メイデン：アイスローズ (id 14 / org 140, RL, B3, 防御型)
 *
 * パーサで表現できていない部分:
 *   - MP（最大12）の状態機械
 *       バースト1段階突入時、MPが0なら +1
 *       フルバーストタイム発動時、MPが1以上なら +1
 *       バーストスキル使用時、所持MPをすべて消費
 *   - スキル2「MPチャージ時に自分を除く電撃コードの味方全体に
 *       有利コードの攻撃ダメージ40.9%▲：10秒／スキル発動者基準で攻撃力20.9%▲：10秒」
 *     発動条件が trigger:unknown で落ちており、パーサは一度も発動しない。
 *     MPが増えるたびに配る。
 *   - スキル2「MP使用後、自分に
 *       有利コードの攻撃ダメージ31.68%▲：10秒／
 *       スキル発動者の最終最大HPの3.2%分の攻撃力▲：10秒」
 *     パーサは trigger:always として戦闘開始時に一度配ってしまうため、
 *     このブロックを止めて、バースト（MP消費）時に配り直す。
 *   - バースト「照準線に最も近い敵1機に
 *       スキル発動者の最終最大HPの10%を攻撃力に合算して1372.8%ダメージ
 *       所持MP分の連続攻撃」
 *     op:unparsed で落ちている。最終最大HPの10%を攻撃力に足したうえで、
 *     所持MPの回数だけ1372.8%を撃つ。
 *
 * パーサが処理済みなので触らないもの:
 *   - スキル1「フルチャージ攻撃で6回攻撃した時、最大HPのみ6.34%▲：10スタック」
 *   - スキル2「フルチャージ攻撃で1回攻撃した時、547.62%ダメージ」
 */
(function () {
  'use strict';

  var MP_MAX = 12;              /* 原文: MPは最大12まで蓄積 */
  var MP_REGEN_ELEM_PCT = 40.9; /* 原文: 有利コードの攻撃ダメージ40.9%▲ */
  var MP_REGEN_ATK_PCT = 20.9;  /* 原文: スキル発動者基準で攻撃力20.9%▲ */
  var MP_USED_ELEM_PCT = 31.68; /* 原文: 有利コードの攻撃ダメージ31.68%▲ */
  var MP_USED_ATK_PCT = 3.2;    /* 原文: 最終最大HPの3.2%分の攻撃力▲ */
  var BURST_DMG_PCT = 1372.8;   /* 原文: 1372.8%ダメージ */
  var BURST_HP_ATK_PCT = 0.10;  /* 原文: 最終最大HPの10%を攻撃力に合算 */
  var EFFECT_SECONDS = 10;      /* 原文: 10秒間維持 */

  /* E.pickTarget は README では (u, frame)、engine の実装は (u, enemies, frame)。 */
  function primaryTarget(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  /* MPを n 増やす。増えたときだけスキル2の「MPチャージ時」を発動する。 */
  function addMp(u, E, frame, n) {
    var s = u.maiden;
    if (!s || s.mp >= MP_MAX) return;
    s.mp = Math.min(MP_MAX, s.mp + n);

    var until = frame + EFFECT_SECONDS * E.FPS;
    var allies = E.alive(E.team(u));
    var flat = E.atkEff(u) * MP_REGEN_ATK_PCT / 100;
    for (var i = 0; i < allies.length; i++) {
      var a = allies[i];
      if (a === u) continue;                 /* 自分を除く */
      if (a.element !== '電撃') continue;    /* 電撃コードのみ */
      E.buff(a, 'maiden-mp-elem-' + u.pos, 'elementDmgPct',
        MP_REGEN_ELEM_PCT, 'up', until, {});
      E.buff(a, 'maiden-mp-atk-' + u.pos, 'atkFlat', flat, 'up', until, {});
    }
    E.event({ frame: frame, kind: 'maiden-mp', side: u.side, unit: u.name, mp: s.mp });
  }

  (window.SPECIALS = window.SPECIALS || {})[14] = {
    init: function (u, E) {
      var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
      if (src && u.skillState) {
        /* スキル定義をこのユニット専用に複製する */
        u.skills = JSON.parse(JSON.stringify(src));
        for (var i = 0; i < u.skillState.length; i++) {
          var st = u.skillState[i];
          var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
          if (!arr) continue;
          for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
        }
        /* スキル2の「MP使用後」は trigger:always で開始時に配られてしまうので止める */
        if (u.skills.skill2 && u.skills.skill2.blocks[1]) {
          u.skills.skill2.blocks[1].trigger = { kind: 'disabled' };
        }
      }
      u.maiden = { mp: 0, lastBurstFrame: -1 };
    },

    tick: function (u, E, frame) {
      var s = u.maiden;
      if (!s) return;

      var lb = E.team(u).lastBurst;
      if (!lb || lb.frame === s.lastBurstFrame) return;
      s.lastBurstFrame = lb.frame;

      if (lb.stage === 'B1') {
        /* バースト1段階突入時、MPが0なら +1 */
        if (s.mp === 0) addMp(u, E, frame, 1);
      } else if (lb.stage === 'B3') {
        /* フルバーストタイム発動時、MPが1以上なら +1 */
        if (s.mp >= 1) addMp(u, E, frame, 1);
      }
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) {
      var s = u.maiden;
      if (!s) return;
      var count = s.mp;
      if (count <= 0) return;          /* 所持MP分の連続攻撃なので0なら何も起きない */
      s.mp = 0;

      /* 最終最大HPの10%を攻撃力に合算する（このフレームだけ） */
      E.buff(u, 'maiden-burst-hp', 'atkFlat', u.hpMax * BURST_HP_ATK_PCT,
        'up', frame, {});

      var t = primaryTarget(u, E, frame);
      for (var i = 0; i < count; i++) {
        if (!t || !t.alive) break;
        E.damage(u, t, frame, { multiplierPct: BURST_DMG_PCT, isBurst: true });
      }

      /* MP使用後：自分に2種（10秒） */
      var until = frame + EFFECT_SECONDS * E.FPS;
      E.buff(u, 'maiden-used-elem', 'elementDmgPct', MP_USED_ELEM_PCT, 'up', until, {});
      E.buff(u, 'maiden-used-atk', 'atkFlat',
        u.hpMax * MP_USED_ATK_PCT / 100, 'up', until, {});
      E.event({ frame: frame, kind: 'maiden-burst', side: u.side, unit: u.name, hits: count });
    }
  };
})();
