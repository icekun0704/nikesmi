/* 雪子 (id 183 / org 199, MG, B3, 火力型, 灼熱)
 *
 * 原文の状態機械:
 *   skill1 戦闘開始時: ペルソナ・コノハナサクヤ（持続・解除不可）
 *     効果1: 3秒ごとに味方全体に メディア：スキル発動者の最終最大HPの5.7%回復
 *   skill1 戦闘開始時およびフルバースト終了時: 自分に 攻撃力65.37%▲（15秒）
 *   skill1 1moreが適用された時: 敵全体に 400.31% の分配ダメージ
 *   skill2 バースト使用時: 真紅の華（解除条件：フルバースト終了時）
 *     効果1: 3秒ごとに味方全体に メディラマ：最終最大HPの5.7%回復
 *   skill2 1moreが適用された時: 基本バースト段階3のペルソナ状態の味方に
 *     追撃：スキル発動者基準で攻撃力80.25%▲（25秒）
 *   burst 対象が風圧コードなら自分に 1more：攻撃力45.33%▲（10秒）
 *
 * パーサの扱いと本ファイルの補正:
 *   - 回復は「3秒ごと」を無視して1回だけ撃つ（trigger=battleStart / burst）。
 *     周期回復を自前で撃つ。
 *   - skill1 の攻撃力65.37% は原文の「15秒問維持」（誤字）を解釈できず恒久バフに
 *     なるので、15秒後に外し、以後はフルバースト終了時に撃ち直す。
 *   - 真紅の華の 分配ダメージ90.01% / 被ダメージ17.95%▼ はパーサが恒久で置く。
 *     フルバースト終了時に外す（原文の解除条件）。
 *
 * 実装しないもの:
 *   - 真紅の守護「水冷コードの敵から受けるダメージ17.95%▼」の属性条件:
 *     engine の takenDmgPct は攻撃者の属性を見ないため、全属性に軽減が乗る。
 *   - 1more の発生条件の詳細（「対象が風圧コードなら」）は、バーストの
 *     分配ダメージ対象に風圧コードが1機でもいれば成立として扱う。
 */
(function () {
  'use strict';

  var FB_FRAMES = 10 * 60;
  var HEAL_PCT = 5.7;
  var HEAL_EVERY = 3 * 60;

  /* ペルソナ状態の判定。ペルソナを持つのは 183 / 223 / 224 の3人だけで、
   * いずれも「持続：解除不可」で戦闘中ずっとペルソナ状態。 */
  function isPersona(a) {
    if (!a || !a.char) return false;
    try { return JSON.stringify(a.char.skillText || {}).indexOf('ペルソナ') >= 0; }
    catch (e) { return false; }
  }
  function isB3(a) {
    return a && a.char && String(a.char.burstStage || '').indexOf('B3') >= 0;
  }

  function st(u) {
    if (!u.yukiko) {
      u.yukiko = {
        nextPersonaHeal: HEAL_EVERY,
        battleAtkCleared: false,
        fbSeen: -1,
        fbEnd: -1,
        crimsonUntil: -1,
        nextCrimsonHeal: -1,
        oneMoreUntil: -1
      };
    }
    return u.yukiko;
  }

  /* engine のバフキーは <side><pos>:<slot>:<block>:stat:<stat>。
   * 現状 <slot> が undefined になっているため、両方の形を受ける。 */
  function atBlock(u, b, idx) {
    var base = u.side + u.pos + ':';
    return b.key.indexOf(base + 'undefined:' + idx + ':') === 0 ||
      b.key.indexOf(base + 'skill1:' + idx + ':') === 0 ||
      b.key.indexOf(base + 'skill2:' + idx + ':') === 0;
  }

  function healAll(u, E, frame) {
    var allies = E.alive(E.team(u));
    var amount = u.hpMax * HEAL_PCT / 100;
    for (var i = 0; i < allies.length; i++) E.heal(allies[i], amount, frame);
  }

  (window.SPECIALS = window.SPECIALS || {})[183] = {
    init: function (u, E) {
      st(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);

      /* 戦闘開始時の1回ぶんはパーサが自分にだけ撃っているので、
       * 0フレーム目に味方（自分以外）へ同じ5.7%を配る。 */
      if (frame === 0) {
        var initMates = E.alive(E.team(u));
        for (var im = 0; im < initMates.length; im++) {
          if (initMates[im] === u) continue;
          E.heal(initMates[im], u.hpMax * HEAL_PCT / 100, frame);
        }
      }

      /* ペルソナ・コノハナサクヤ：3秒ごとに味方全体 5.7%回復（永続） */
      if (frame >= s.nextPersonaHeal) {
        s.nextPersonaHeal += HEAL_EVERY;
        healAll(u, E, frame);
      }

      /* 戦闘開始時の攻撃力65.37% は15秒で切れる（パーサは恒久で置く） */
      if (!s.battleAtkCleared && frame >= 15 * E.FPS) {
        s.battleAtkCleared = true;
        u.buffs = u.buffs.filter(function (b) {
          return !(b.stat === 'atkPct' && atBlock(u, b, 1));
        });
      }

      /* 真紅の華の周期回復（3秒ごと）。パーサが burst で1回撃っているので
       * 最初の周期は3秒後から。 */
      if (s.crimsonUntil >= 0 && frame <= s.crimsonUntil && frame >= s.nextCrimsonHeal) {
        s.nextCrimsonHeal += HEAL_EVERY;
        healAll(u, E, frame);
      }

      /* 真紅の華の「効果2/効果3」は原文では自分だけだが、パーサは対象を
       * 味方全体にしている。味方に付いたぶんは同フレームのうちに外す。 */
      if (s.crimsonUntil >= 0) {
        var mates = E.team(u) || [];
        for (var mi = 0; mi < mates.length; mi++) {
          var mate = mates[mi];
          if (!mate || mate === u) continue;
          mate.buffs = mate.buffs.filter(function (b) {
            if (b.stat !== 'distributedDmgPct' && b.stat !== 'takenDmgPct') return true;
            return !atBlock(u, b, 1);
          });
        }
      }

      /* フルバースト終了の検出 */
      var team = E.team(u) || [];
      var lb = team.lastBurst;
      if (lb && lb.stage === 'B3' && lb.frame !== s.fbSeen) {
        s.fbSeen = lb.frame;
        s.fbEnd = lb.frame + FB_FRAMES;
      }
      if (s.fbEnd >= 0 && frame >= s.fbEnd) {
        s.fbEnd = -1;

        /* フルバースト終了時、自分に 攻撃力65.37%▲：15秒間維持 */
        E.buff(u, 'yukiko-fb-atk', 'atkPct', 65.37, 'up', frame + 15 * E.FPS, {});

        /* 真紅の華 解除 */
        if (s.crimsonUntil >= 0) {
          s.crimsonUntil = -1;
          s.nextCrimsonHeal = -1;
          u.buffs = u.buffs.filter(function (b) {
            if (b.stat !== 'distributedDmgPct' && b.stat !== 'takenDmgPct') return true;
            return !atBlock(u, b, 1);
          });
        }
        E.event({ frame: frame, kind: 'yukiko-fb-end', side: u.side, unit: u.name });
      }
    },

    onBurst: function (u, E, frame) {
      var s = st(u);

      /* 真紅の華：フルバースト終了まで */
      s.crimsonUntil = frame + FB_FRAMES;
      s.nextCrimsonHeal = frame + HEAL_EVERY;

      /* 「対象が風圧コードなら自分に 1more」。
       * バーストの対象（敵全体）に風圧コードがいるかで判定する。 */
      var foes = E.alive(E.enemies(u));
      var wind = false;
      for (var i = 0; i < foes.length; i++) {
        if (foes[i].element === '風圧') { wind = true; break; }
      }
      if (!wind) return;

      s.oneMoreUntil = frame + 10 * E.FPS;

      /* 1more：攻撃力45.33%▲：10秒間維持 */
      E.buff(u, 'yukiko-1more', 'atkPct', 45.33, 'up', frame + 10 * E.FPS, {});

      /* 1moreが適用された時、敵全体に 最終攻撃力の400.31%の分配ダメージ */
      for (var d = 0; d < foes.length; d++) {
        E.damage(u, foes[d], frame, { multiplierPct: 400.31, isDistributed: true });
      }

      /* 1moreが適用された時、自分を除く基本バースト段階3のペルソナ状態の味方に
       * 追撃：スキル発動者基準で攻撃力80.25%▲：25秒間維持 */
      var amount = E.atkEff(u) * 0.8025;
      var allies = E.alive(E.team(u));
      for (var a = 0; a < allies.length; a++) {
        var m = allies[a];
        if (m === u || !isB3(m) || !isPersona(m)) continue;
        E.buff(m, 'yukiko-chase:' + u.side + u.pos + ':' + m.pos,
          'atkFlat', amount, 'up', frame + 25 * E.FPS, {});
      }

      E.event({ frame: frame, kind: 'yukiko-1more', side: u.side, unit: u.name,
                targets: foes.length });
    }
  };
})();
