/* アンカー：イノセントメイド (id 39 / org 145)
 *
 * 実装する状態機械: フルバーストタイム発動時の継続回復と、burst の「保存」
 *
 * 原文 skill1（2つ目のブロック）:
 *   フルバーストタイムが発動した時、同じ部隊の味方がいれば味方全体に
 *   ・スキル発動者の最大HPの3.04%の回復：1秒間隔：8秒間維持
 * 原文 burst:
 *   味方全体に
 *   ・保存：スキル発動者基準で最大HPの60.19%まで超過HP回復量を保存：25秒間維持
 *   ・スキル発動者の最大HPの40.18%の回復
 *   ・スキル発動者基準で攻撃力30.09%▲：10秒間維持
 *
 * パーサ側の扱い:
 *   - 40.18% の回復と「保存」は未解釈（op:unparsed）。ここで実装する。
 *   - 攻撃力30.09% と skill2 の使用回数別バフはパーサが処理済み。触らない。
 *   - 「保存」は engine に超過回復量という概念が無いので、回復しきれなかった分を
 *     シールドとして置く（engine はシールドを被ダメージの吸収に使う）。
 *     25秒の持続は表現できないため無期限として扱う。
 */
(function () {
  'use strict';

  var FB_FRAMES = 10 * 60;
  var HEAL_PCT = 3.04;
  var HEAL_INTERVAL = 60;     /* 1秒間隔 */
  var HEAL_TICKS = 8;         /* 8秒間 */
  var BURST_HEAL_PCT = 40.18;
  var OVERHEAL_CAP_PCT = 60.19;
  var TIER_HIT_RATE = 10.13;      /* 1回：命中率10.13%▲：10秒間 */
  var TIER_ATK_PCT = 35.02;       /* 2回：スキル発動者基準で攻撃力35.02%▲：10秒間 */
  var TIER_RELOAD_PCT = 40.04;    /* 3回：リロード速度40.04%▲：15秒間 */
  var TIER_DISTRIBUTED = 30.4;    /* 2回：分配ダメージ30.4%▲：10秒間 */

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  /* パーサは「使用回数別の効果」を判別できず、fullBurst / fullBurstEnd のたびに
   * 1回〜3回の効果を全部まとめて付与してしまっている（使用回数の区別なし）。
   * 本来の「使用回数別・下位効果のスタック適用」を実装するため、
   * ユニット専用にスキル定義を複製して該当ブロックの効果を取り除く。 */
  function neutraliseParserBlock(u) {
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (!src || !u.skillState) return;
    u.skills = JSON.parse(JSON.stringify(src));
    for (var s = 0; s < u.skillState.length; s++) {
      var st = u.skillState[s];
      var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
      if (!arr) continue;
      for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
    }
    /* 値で特定する（trigger の解釈が変わっても二重計上しないように）。 */
    var s1 = (u.skills.skill1 && u.skills.skill1.blocks) || [];
    for (var i = 0; i < s1.length; i++) {
      s1[i].effects = (s1[i].effects || []).filter(function (e) {
        if (e.op === 'stat' && e.stat === 'distributedDmgPct' &&
            Math.abs(e.value - TIER_DISTRIBUTED) < 1e-6) return false;
        return true;
      });
    }
    var s2 = (u.skills.skill2 && u.skills.skill2.blocks) || [];
    for (var j = 0; j < s2.length; j++) {
      s2[j].effects = (s2[j].effects || []).filter(function (e) {
        if (e.op !== 'stat') return true;
        if (e.stat === 'hitRate' && Math.abs(e.value - TIER_HIT_RATE) < 1e-6) return false;
        if (e.stat === 'atkPct' && Math.abs(e.value - TIER_ATK_PCT) < 1e-6) return false;
        if (e.stat === 'reloadSpeedPct' && Math.abs(e.value - TIER_RELOAD_PCT) < 1e-6) return false;
        return true;
      });
    }
  }

  function fullBurstFrame(u, frame) {
    var lb = u.team && u.team.lastBurst;
    if (!lb || lb.stage !== 'B3') return -1;
    return (frame >= lb.frame && frame <= lb.frame + FB_FRAMES) ? lb.frame : -1;
  }

  /* フルバーストタイム発動時: 使用回数別・下位効果のスタック適用
   *   1回：HP回復量30.96%▲：5秒間維持   → engine に「与える回復量」が無いため保留
   *   2回：分配ダメージ30.4%▲：10秒間維持
   *   3回：スタック可能デバフ効果のスタック量1個▼ → デバフスタックの概念が無い
   */
  function applyFbStart(u, E, frame, uses) {
    if (uses < 2) return;
    var mates = E.alive(E.team(u));
    var v = TIER_DISTRIBUTED * scaleOf(u, 'skill1');
    for (var i = 0; i < mates.length; i++) {
      E.buff(mates[i], 'anchor-fb-start:' + u.pos, 'distributedDmgPct', v, 'up',
        frame + 10 * E.FPS, { label: '使用回数2回' });
    }
  }

  /* フルバーストタイム終了時: 使用回数別・下位効果のスタック適用
   *   1回：命中率10.13%▲：10秒間維持
   *   2回：スキル発動者基準で攻撃力35.02%▲：10秒間維持
   *   3回：リロード速度40.04%▲：15秒間維持
   */
  function applyFbEnd(u, E, frame, uses) {
    if (uses < 1) return;
    var mates = E.alive(E.team(u));
    for (var i = 0; i < mates.length; i++) {
      var t = mates[i];
      E.buff(t, 'anchor-fb-end:' + u.pos, 'hitRate', TIER_HIT_RATE * scaleOf(u, 'skill2'),
        'up', frame + 10 * E.FPS, { label: '使用回数1回' });
      if (uses >= 2) {
        var flat = E.atkEff(u) * (TIER_ATK_PCT * scaleOf(u, 'skill2')) / 100;
        E.buff(t, 'anchor-fb-end-atk:' + u.pos, 'atkFlat', flat, 'up',
          frame + 10 * E.FPS, { label: '使用回数2回' });
      }
      if (uses >= 3) {
        E.buff(t, 'anchor-fb-end-reload:' + u.pos, 'reloadSpeedPct',
          TIER_RELOAD_PCT * scaleOf(u, 'skill2'), 'up', frame + 15 * E.FPS,
          { label: '使用回数3回' });
      }
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[39] = {
    init: function (u, E) {
      neutraliseParserBlock(u);
      u.anchor = {
        fbFrame: -1,
        healNext: -1,
        healLast: -1,
        inFb: false,
        uses: 0
      };
    },

    tick: function (u, E, frame) {
      var a = u.anchor;
      if (!a) return;

      var fb = fullBurstFrame(u, frame);

      /* フルバーストタイムの発動／終了を検出して使用回数を数える */
      if (fb >= 0 && !a.inFb) {
        a.inFb = true;
        a.uses += 1;
        applyFbStart(u, E, frame, Math.min(a.uses, 3));
      } else if (fb < 0 && a.inFb) {
        a.inFb = false;
        applyFbEnd(u, E, frame, Math.min(a.uses, 3));
      }

      if (fb >= 0 && fb !== a.fbFrame) {
        a.fbFrame = fb;
        a.healNext = fb;
        a.healLast = fb + (HEAL_TICKS - 1) * HEAL_INTERVAL;
      }

      if (a.healNext >= 0 && frame >= a.healNext && frame <= a.healLast) {
        var team = E.alive(E.team(u));
        /* 「同じ部隊の味方がいれば」＝自分以外の生存者がいること */
        if (team.length >= 2) {
          var amount = u.hpMax * (HEAL_PCT * scaleOf(u, 'skill1')) / 100;
          for (var i = 0; i < team.length; i++) E.heal(team[i], amount, frame);
        }
        a.healNext += HEAL_INTERVAL;
      }
    },

    onShot: function (u, E, frame, shot) {
      /* 通常攻撃そのものの処理は無し */
    },

    onBurst: function (u, E, frame) {
      var team = E.alive(E.team(u));
      var amount = u.hpMax * (BURST_HEAL_PCT * scaleOf(u, 'burst')) / 100;
      var cap = u.hpMax * OVERHEAL_CAP_PCT / 100;
      for (var i = 0; i < team.length; i++) {
        var t = team[i];
        var before = t.hp;
        E.heal(t, amount, frame);
        var excess = amount - (t.hp - before);
        if (excess > 0) {
          /* 保存（超過HP回復量を最大HPの60.19%まで保持） */
          var store = Math.min(excess, cap);
          if (store > (t.shield || 0)) t.shield = store;
        }
      }
    }
  };
})();
