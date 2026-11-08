/* チャイム (id 218 / org 173)
 *
 * 実装する状態機械: 「自分の王」の指定と、王への継続バフ
 *
 * 「自分の王」の定義（ゲーム内用語）:
 *   チャイムがいただく王とはクラウンを指す
 *   → 味方のクラウン（js/data.js の id 178）が王。
 *
 * 原文 skill1:
 *   戦闘開始時自分の王に ・請願：スキル発動者基準で攻撃力46.46%▲：持続
 * 原文 skill2:
 *   フルバーストタイムが発動した時、自分の王に
 *   ・日課報告：通常攻撃ダメージ46.22%倍率▲：10秒間維持
 * 原文 burst:
 *   味方全体に ・バースト再突入2段階 ・最大装弾数20%▲：10秒間維持
 *   自分の王に ・忠心：攻撃ダメージ92.44%▲：10秒間維持
 *
 * パーサ側の扱い:
 *   - 請願は trigger=unknown のため未付与。ここで実装する。
 *   - 日課報告は unparsed。ここで実装する。
 *   - burst の忠心（92.44%）は target=self として解釈されチャイム自身に付与されている。
 *     王（クラウン）には付与されていないので、王に対して実装する（二重計上にはならない）。
 *   - 通常攻撃ダメージの「倍率▲」は engine に専用ステータスが無いため
 *     atkDmgPct（与ダメージ増加）で近似する。
 *   - 「バースト再突入2段階」はバーストゲージ／連鎖側の仕組みで、engine に実装が無い。
 */
(function () {
  'use strict';

  var KING_ID = 178;   /* クラウン */
  var FB_FRAMES = 10 * 60;
  var PETITION_ATK = 46.46;
  var DAILY_ATK_DMG = 46.22;
  var DAILY_FRAMES = 10 * 60;
  var LOYALTY_ATK_DMG = 92.44;
  var LOYALTY_FRAMES = 10 * 60;

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  /* burst の「忠心：攻撃ダメージ92.44%▲：10秒間維持」は target=self として
   * 解釈され、チャイム自身に付与されている。本来は「自分の王」（クラウン）へ
   * 付与する効果なので、ユニット専用にスキル定義を複製して取り除き、
   * 王に対して撃ち直す。 */
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
    var blocks = (u.skills.burst && u.skills.burst.blocks) || [];
    for (var i = 0; i < blocks.length; i++) {
      blocks[i].effects = (blocks[i].effects || []).filter(function (e) {
        if (e.op === 'stat' && e.stat === 'atkDmgPct' && Math.abs(e.value - 92.44) < 1e-6) return false;
        return true;
      });
    }
  }

  function kingOf(u, E) {
    var mates = E.alive(E.team(u));
    for (var i = 0; i < mates.length; i++) {
      if (mates[i].char && mates[i].char.id === KING_ID) return mates[i];
    }
    return null;
  }

  function fullBurstFrame(u, frame) {
    var lb = u.team && u.team.lastBurst;
    if (!lb || lb.stage !== 'B3') return -1;
    return (frame >= lb.frame && frame <= lb.frame + FB_FRAMES) ? lb.frame : -1;
  }

  (window.SPECIALS = window.SPECIALS || {})[218] = {
    init: function (u, E) {
      neutraliseParserBlock(u);
      u.chime = { petitioned: false, fbFrame: -1 };
    },

    tick: function (u, E, frame) {
      var c = u.chime;
      if (!c) return;
      var king = kingOf(u, E);
      if (!king) return;

      /* 戦闘開始時: 請願（スキル発動者基準＝チャイムの攻撃力の46.46%を固定値で） */
      if (!c.petitioned) {
        var flat = E.atkEff(u) * (PETITION_ATK * scaleOf(u, 'skill1')) / 100;
        E.buff(king, 'chime-petition', 'atkFlat', flat, 'up', Infinity, { label: '請願' });
        c.petitioned = true;
      }

      /* フルバーストタイムが発動した時: 日課報告 */
      var fb = fullBurstFrame(u, frame);
      if (fb >= 0 && fb !== c.fbFrame) {
        c.fbFrame = fb;
        E.buff(king, 'chime-daily', 'atkDmgPct', DAILY_ATK_DMG * scaleOf(u, 'skill2'),
          'up', frame + DAILY_FRAMES, { label: '日課報告' });
      }
    },

    onShot: function (u, E, frame, shot) {
      /* 通常攻撃そのものの処理は無し */
    },

    onBurst: function (u, E, frame) {
      var king = kingOf(u, E);
      if (!king) return;
      /* 忠心：攻撃ダメージ92.44%▲：10秒間維持 */
      E.buff(king, 'chime-loyalty', 'atkDmgPct', LOYALTY_ATK_DMG * scaleOf(u, 'burst'),
        'up', frame + LOYALTY_FRAMES, { label: '忠心' });
    }
  };
})();
