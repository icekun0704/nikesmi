/* クレイ (id 150 / org 123)
 *
 * 実装する状態機械: ヴィクトリークライ（スタック）と、その状態中の攻撃力付与
 *
 * 原文 skill1:
 *   フルバーストタイム持続中に通常攻撃で60回攻撃した時、味方全体に
 *   ・ヴィクトリークライ：防御力無視ダメージ6.45%▲：3スタック：6秒間維持
 *   ・敵の発射体を攻撃する時、該当の発射体に与えるダメージ45.05%▲：6秒間維持
 * 原文 skill2:
 *   バースト1段階突入時、味方全体に ・デバフ効果免疫1回：10秒間維持
 *   自分がヴィクトリークライ状態の時に限り、味方全体に
 *   ・スキル発動者基準で攻撃力20.07%▲：持続
 * 原文 burst:
 *   自分に ・通常攻撃を防御力無視ダメージとして適用：10秒間維持
 *
 * パーサ側の扱い:
 *   - ヴィクトリークライは trigger=unknown のため未付与。ここで実装する。
 *   - 「自分がヴィクトリークライ状態の時に限り」の攻撃力20.07%（発動者基準＝
 *     クレイの攻撃力の20.07%を固定値で加算）は未付与。ここで実装する。
 *   - 発射体ダメージ・デバフ効果免疫は engine に対応する概念が無い。
 *   - burst の「通常攻撃を防御力無視ダメージとして適用」は、engine が通常攻撃の
 *     ダメージ計算を先に行ってから SPECIALS.onShot を呼ぶため差し替えできない。
 */
(function () {
  'use strict';

  var FB_FRAMES = 10 * 60;
  var HITS_FOR_VICTORY = 60;
  var VICTORY_IGNORE_DEF = 6.45;
  var VICTORY_STACKS = 3;
  var VICTORY_FRAMES = 6 * 60;
  var TEAM_ATK_FROM_VICTORY = 20.07;

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  function fullBurstFrame(u, frame) {
    var lb = u.team && u.team.lastBurst;
    if (!lb || lb.stage !== 'B3') return -1;
    return (frame >= lb.frame && frame <= lb.frame + FB_FRAMES) ? lb.frame : -1;
  }

  (window.SPECIALS = window.SPECIALS || {})[150] = {
    init: function (u, E) {
      u.clay = {
        fbFrame: -1,
        hits: 0,
        victoryUntil: -1
      };
    },

    tick: function (u, E, frame) {
      var c = u.clay;
      if (!c) return;

      var fb = fullBurstFrame(u, frame);
      if (fb >= 0 && fb !== c.fbFrame) {
        c.fbFrame = fb;
        c.hits = 0;
      }

      /* 自分がヴィクトリークライ状態の時に限り、味方全体に
       * スキル発動者基準で攻撃力20.07%▲：持続（固定値として付与） */
      if (frame <= c.victoryUntil) {
        var flat = E.atkEff(u) * (TEAM_ATK_FROM_VICTORY * scaleOf(u, 'skill2')) / 100;
        var mates = E.alive(E.team(u));
        for (var i = 0; i < mates.length; i++) {
          E.buff(mates[i], 'clay-victory-atk:' + u.pos, 'atkFlat', flat, 'up', Infinity,
            { aura: true, label: 'ヴィクトリークライ' });
        }
      }
    },

    onShot: function (u, E, frame, shot) {
      var c = u.clay;
      if (!c) return;
      if (fullBurstFrame(u, frame) < 0) return;

      /* フルバーストタイム持続中に通常攻撃で60回攻撃した時 */
      c.hits += 1;   /* 通常攻撃1回ごと（クレイはSMGなので1射1ヒット） */
      if (c.hits % HITS_FOR_VICTORY === 0) {
        c.victoryUntil = frame + VICTORY_FRAMES;
        var v = VICTORY_IGNORE_DEF * scaleOf(u, 'skill1');
        var until = frame + VICTORY_FRAMES;
        var mates = E.alive(E.team(u));
        for (var i = 0; i < mates.length; i++) {
          E.buff(mates[i], 'clay-victory:' + u.pos, 'ignoreDefDmgPct', v, 'up', until,
            { maxStacks: VICTORY_STACKS, label: 'ヴィクトリークライ' });
        }
      }
    },

    onBurst: function (u, E, frame) {
      /* 「通常攻撃を防御力無視ダメージとして適用」は engine 側に
       * ダメージ計算前のフックが無いため未実装。 */
    }
  };
})();
