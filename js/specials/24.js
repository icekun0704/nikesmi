/* ソーダ：トゥインクルバニー (id 24 / org 121)
 *
 * 実装する状態機械: ゴールデンチップのスタック量
 *
 * 原文 skill1:
 *   戦闘開始時、自分に ・ゴールデンチップのスタック量50個▲
 *   フルバーストタイム持続中に通常攻撃で3回攻撃した時、自分に
 *   ・ゴールデンチップ：クリティカルダメージ1.32%▲：50スタック：持続
 *   フルバーストタイム中に通常攻撃で3回攻撃した時、
 *   自分と自分を除く最終攻撃力が最も高い味方1機に
 *   ・攻撃ダメージ10.51%▲：2秒間維持
 * 原文 skill2:
 *   バースト3段階突入時、味方全体に ・ゴールデンチップのスタック量別の効果、下位効果のスタック適用
 *   1段階：10スタック以上 → 時間延長Ⅰ：フルバーストタイムの持続時間2秒▲
 *   2段階：20スタック以上 → 時間延長Ⅱ：フルバーストタイムの持続時間3秒▲
 *   フルバーストタイムの持続中、通常攻撃をした時、照準線に最も近い敵1機に
 *   1段階：時間延長Ⅰ状態なら ・最終攻撃力の52.04%のダメージ
 *   2段階：時間延長Ⅱ状態なら ・最終攻撃力の85.02%のダメージ
 * 原文 burst:
 *   効果適用後、ゴールデンチップのスタック量17個▼
 *   2段階：20スタック以上なら 命中率38.91%▲：15秒間維持
 *   3段階：30スタック以上なら 攻撃力65.25%▲：15秒間維持
 *
 * パーサ側の扱い:
 *   - burst の 2/3段階（命中率・攻撃力）は条件抜きで毎回付与されている。二重計上しない。
 *   - skill1 の「攻撃ダメージ10.51%」は trigger=always として戦闘開始時に一度だけ付与されている。
 *     本来のトリガー（FB中の3回攻撃ごと）で改めて付与する（同じブロックの取りこぼしを補う）。
 *   - フルバーストタイムの延長（時間延長Ⅰ/Ⅱ）は engine に FB の残り時間を触る API が
 *     無いため、時間延長の「状態」だけを保持し、ダメージ段階の判定に使う。
 */
(function () {
  'use strict';

  var FB_FRAMES = 10 * 60;
  var CHIP_MAX = 50;
  var CHIP_START = 50;
  var CHIP_BURST_COST = 17;
  var CRIT_DMG_PER_CHIP = 1.32;
  var ATK_DMG_3HIT = 10.51;
  var ATK_DMG_3HIT_FRAMES = 2 * 60;
  var EXT1_MIN = 10;
  var EXT2_MIN = 20;
  var EXT1_DMG = 52.04;
  var EXT2_DMG = 85.02;

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  /* パーサは「フルバーストタイム中に通常攻撃で3回攻撃した時」の
   * 攻撃ダメージ10.51% を trigger=always として解釈し、戦闘開始時に一度だけ
   * 味方へ付与してしまっている。本来のトリガーで撃ち直すため、ユニット専用に
   * スキル定義を複製してその効果だけを取り除く。 */
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
    var blocks = (u.skills.skill1 && u.skills.skill1.blocks) || [];
    for (var i = 0; i < blocks.length; i++) {
      blocks[i].effects = (blocks[i].effects || []).filter(function (e) {
        if (e.op === 'stat' && e.stat === 'atkDmgPct' && Math.abs(e.value - 10.51) < 1e-6) return false;
        return true;
      });
    }
    /* burst の 2/3段階（20/30スタック条件）もパーサは無条件で付与している。
     * スタック量で判定し直すため取り除く。 */
    var bb = (u.skills.burst && u.skills.burst.blocks) || [];
    for (var k = 0; k < bb.length; k++) {
      bb[k].effects = (bb[k].effects || []).filter(function (e) {
        if (e.op === 'stat' && e.stat === 'hitRate' && Math.abs(e.value - 38.91) < 1e-6) return false;
        if (e.op === 'stat' && e.stat === 'atkPct' && Math.abs(e.value - 65.25) < 1e-6) return false;
        return true;
      });
    }
  }

  function fullBurstFrame(u, frame) {
    var lb = u.team && u.team.lastBurst;
    if (!lb || lb.stage !== 'B3') return -1;
    return (frame >= lb.frame && frame <= lb.frame + FB_FRAMES) ? lb.frame : -1;
  }

  /* E.buff は値を Math.max でしか上げないので、スタック減少を反映できるよう
   * 自分で持っているバフの value を直接書き換える。 */
  function setBuff(u, E, key, stat, value, until, opts) {
    var b = null;
    for (var i = 0; i < u.buffs.length; i++) {
      if (u.buffs[i].key === key && u.buffs[i].stat === stat) { b = u.buffs[i]; break; }
    }
    if (!b) b = E.buff(u, key, stat, value, 'up', until, opts || {});
    b.value = value;
    b.dir = 'up';
    b.until = until;
    b.refreshed = u.now;
    return b;
  }

  (window.SPECIALS = window.SPECIALS || {})[24] = {
    /* E.pickTarget は README では (u, frame)、engine の実装は (u, enemies, frame)。 */
    _target: function (u, E, frame) {
      if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
      try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
    },

    init: function (u, E) {
      neutraliseParserBlock(u);
      u.soda = {
        chips: CHIP_START,
        atkCount: 0,
        fbFrame: -1,
        pendingChips: null,
        ext1: false,
        ext2: false,
        extUntil: -1
      };
    },

    tick: function (u, E, frame) {
      var s = u.soda;
      if (!s) return;

      var fb = fullBurstFrame(u, frame);
      if (fb >= 0 && fb !== s.fbFrame) {
        s.fbFrame = fb;
        var at = s.pendingChips == null ? s.chips : s.pendingChips;
        s.pendingChips = null;
        s.ext1 = at >= EXT1_MIN;
        s.ext2 = at >= EXT2_MIN;
        s.extUntil = fb + FB_FRAMES;
        s.atkCount = 0;
      }

      /* ゴールデンチップ：クリティカルダメージ1.32%▲（1スタックあたり、上限50） */
      var crit = CRIT_DMG_PER_CHIP * Math.min(CHIP_MAX, s.chips) * scaleOf(u, 'skill1');
      setBuff(u, E, 'soda-chip-critdmg', 'critDmgPct', crit, Infinity, { label: 'ゴールデンチップ' });
    },

    onShot: function (u, E, frame, shot) {
      var s = u.soda;
      if (!s) return;
      if (fullBurstFrame(u, frame) < 0) return;

      /* フルバースト中に通常攻撃で3回攻撃した時 → ゴールデンチップ+1 */
      s.atkCount += 1;
      if (s.atkCount % 3 === 0) {
        if (s.chips < CHIP_MAX) s.chips += 1;

        /* 自分と自分を除く最終攻撃力が最も高い味方1機に 攻撃ダメージ10.51%▲：2秒間維持 */
        var v = ATK_DMG_3HIT * scaleOf(u, 'skill1');
        var until = frame + ATK_DMG_3HIT_FRAMES;
        E.buff(u, 'soda-chip-atkdmg:self', 'atkDmgPct', v, 'up', until, { label: 'ゴールデンチップ' });
        var mates = E.alive(E.team(u)).filter(function (x) { return x !== u; });
        if (mates.length) {
          mates.sort(function (a, b) { return E.atkEff(b) - E.atkEff(a); });
          E.buff(mates[0], 'soda-chip-atkdmg:' + u.pos, 'atkDmgPct', v, 'up', until,
            { label: 'ゴールデンチップ' });
        }
      }

      /* フルバースト中、時間延長状態に応じて照準線に最も近い敵1機へ追加ダメージ */
      if (frame <= s.extUntil && (s.ext1 || s.ext2)) {
        var target = this._target(u, E, frame);
        if (target) {
          /* 「下位効果のスタック適用」なので Ⅰ と Ⅱ は加算 */
          var mult = 0;
          if (s.ext1) mult += EXT1_DMG * scaleOf(u, 'skill2');
          if (s.ext2) mult += EXT2_DMG * scaleOf(u, 'skill2');
          if (mult > 0) E.damage(u, target, frame, { multiplierPct: mult });
        }
      }
    },

    onBurst: function (u, E, frame) {
      var s = u.soda;
      if (!s) return;
      /* burst のスタック量別効果は減少前に評価される */
      s.pendingChips = s.chips;
      if (s.chips >= 20) {
        /* 2段階：20スタック以上なら 命中率38.91%▲：15秒間維持 */
        E.buff(u, 'soda-burst-hit', 'hitRate', 38.91 * scaleOf(u, 'burst'), 'up',
          frame + 15 * E.FPS, { label: 'ゴールデンチップ2段階' });
      }
      if (s.chips >= 30) {
        /* 3段階：30スタック以上なら 攻撃力65.25%▲：15秒間維持 */
        E.buff(u, 'soda-burst-atk', 'atkPct', 65.25 * scaleOf(u, 'burst'), 'up',
          frame + 15 * E.FPS, { label: 'ゴールデンチップ3段階' });
      }
      /* 効果適用後、ゴールデンチップのスタック量17個▼ */
      s.chips = Math.max(0, s.chips - CHIP_BURST_COST);
    }
  };
})();
