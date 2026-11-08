/* マルチャーナ：マリンスタディ (id 214 / org 194)
 *
 * 実装する状態機械: ホイッスルのスタック、警戒対象、高リスク対象
 *
 * 原文 skill1:
 *   フルバーストタイムが発動した時、直前に自分がバーストスキルを使用していれば
 *   最終最大HPが最も高い敵1機に
 *   ・効果1：最終攻撃力の3789.25%の追加ダメージ
 *   ・効果2：対象が生存している時、警戒対象：攻撃力10.56%▼：10秒間維持
 *   通常攻撃が20回命中した時、対象が高リスク対象状態なら、対象に
 *   ・最終攻撃力の152.68%の追加ダメージ
 * 原文 skill2:
 *   戦闘開始時、自分に
 *   ・ホイッスル：攻撃力32.73%▲：5スタック：持続
 *   ・ホイッスルスタック量4個▲
 *   ラプチャーが3機以下の状態を5秒間維持するたび、自分に
 *   ・ホイッスル：攻撃力32.73%▲：5スタック：持続
 *   ラプチャーが6機以上の状態を1秒間維持するたび（※5vs5では成立しない）
 *   ・ペンくん緊急出動：敵全体に最終攻撃力の214.36%の追加ダメージ／ホイッスル1個▼
 *   ラプチャーが出現または破壊された時、ラプチャーが5機以下の場合、自分に
 *   ・有利コードの攻撃ダメージ20.41%▲：持続
 * 原文 burst:
 *   電撃コードの敵全体に ・高リスク対象：防御力10.56%▼：20秒間維持
 *
 * パーサ側の扱い:
 *   - 「ホイッスル」は battleStart の1スタック分だけ常時攻撃力+32.73%として付与済み。
 *     ここでは 2 スタック目以降だけを加算する（二重計上しない）。
 *   - 高リスク対象の防御力デバフはパーサが全敵に付与している（本来は電撃コードのみ）。
 *     追加ダメージの条件判定だけをこちらで行う。
 *   - ラプチャー6機以上・ラプチャー出現/破壊は 5vs5 のアリーナでは起こらないため実装しない。
 */
(function () {
  'use strict';

  var WHISTLE_START = 4;         /* 戦闘開始時のスタック量 */
  var WHISTLE_MAX = 5;           /* 5スタック */
  var WHISTLE_ATK = 32.73;       /* 1スタックあたりの攻撃力 */
  var WHISTLE_EVERY = 5 * 60;    /* 3機以下を5秒間維持するたび */
  var EXTRA_FB = 3789.25;        /* 警戒対象指定の追加ダメージ */
  var EXTRA_20HIT = 152.68;      /* 高リスク対象への20ヒット毎の追加ダメージ */
  var HIGH_RISK_FRAMES = 20 * 60;

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

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

  /* パーサは「フルバーストタイムが発動した時、直前に自分がバーストスキルを
   * 使用していれば」のブロックを trigger=always として解釈し、戦闘開始時に
   * 最高最大HPの敵へ攻撃力10.56%▼ を付与してしまっている。
   * 本来のタイミングで撃ち直すため、ユニット専用にスキル定義を複製して
   * そのブロックの効果だけを取り除く。 */
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
      if ((blocks[i].trigger || {}).kind !== 'always') continue;
      blocks[i].effects = (blocks[i].effects || []).filter(function (e) {
        if (e.op === 'extra' && Math.abs(e.value - 3789.25) < 1e-6) return false;
        if (e.op === 'stat' && e.stat === 'atkPct' && e.dir === 'down' &&
            Math.abs(e.value - 10.56) < 1e-6) return false;
        return true;
      });
    }
  }

  function isHighRisk(u, target, frame) {
    var list = u.mar && u.mar.highRisk;
    if (!list) return false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].unit === target && list[i].until >= frame) return true;
    }
    return false;
  }

  (window.SPECIALS = window.SPECIALS || {})[214] = {
    /* E.pickTarget は README では (u, frame)、engine の実装は (u, enemies, frame)。 */
    _target: function (u, E, frame) {
      if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
      try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
    },

    init: function (u, E) {
      neutraliseParserBlock(u);
      u.mar = {
        whistle: WHISTLE_START,
        whistleNext: WHISTLE_EVERY,
        highRisk: []
      };
    },

    tick: function (u, E, frame) {
      var m = u.mar;
      if (!m) return;

      /* ラプチャーが3機以下の状態を5秒間維持するたび → ホイッスル+1 */
      if (frame >= m.whistleNext) {
        if (E.alive(E.enemies(u)).length <= 3 && m.whistle < WHISTLE_MAX) {
          m.whistle += 1;
        }
        m.whistleNext = frame + WHISTLE_EVERY;
      }

      /* ホイッスル：攻撃力32.73%×スタック（1スタック目はパーサ側が付与済み） */
      var extra = WHISTLE_ATK * Math.max(0, m.whistle - 1) * scaleOf(u, 'skill2');
      setBuff(u, E, 'mar-whistle', 'atkPct', extra, Infinity, { label: 'ホイッスル' });
    },

    onShot: function (u, E, frame, shot) {
      var m = u.mar;
      if (!m) return;
      /* 通常攻撃が20回命中した時、対象が高リスク対象状態なら追加ダメージ */
      if (u.counters.attackHits > 0 && u.counters.attackHits % 20 === 0) {
        var t = this._target(u, E, frame);
        if (t && isHighRisk(u, t, frame)) {
          E.damage(u, t, frame, { multiplierPct: EXTRA_20HIT * scaleOf(u, 'skill1') });
        }
      }
    },

    onBurst: function (u, E, frame) {
      var m = u.mar;
      if (!m) return;

      /* フルバーストタイム発動時、直前に自分がバーストスキルを使用していれば
       * 最終最大HPが最も高い敵1機に 3789.25% の追加ダメージ。
       * 自分が B3 のバーストを使った瞬間がちょうどフルバーストの発動条件。 */
      if (u.burstStageUsed === 'B3') {
        var enemies = E.alive(E.enemies(u));
        if (enemies.length) {
          var best = enemies[0];
          for (var i = 1; i < enemies.length; i++) {
            if (enemies[i].hpMax > best.hpMax) best = enemies[i];
          }
          E.damage(u, best, frame, { multiplierPct: EXTRA_FB * scaleOf(u, 'skill1') });
          /* 対象が生存している時、警戒対象：攻撃力10.56%▼：10秒間維持 */
          if (best.alive) {
            E.buff(best, 'mar-alert:' + u.pos, 'atkPct', 10.56 * scaleOf(u, 'skill1'),
              'down', frame + 10 * E.FPS, { label: '警戒対象' });
          }
        }
      }

      /* 電撃コードの敵全体に 高リスク対象（20秒間） */
      var live = E.alive(E.enemies(u));
      m.highRisk = [];
      for (var j = 0; j < live.length; j++) {
        if (live[j].element === '電撃') {
          m.highRisk.push({ unit: live[j], until: frame + HIGH_RISK_FRAMES });
        }
      }
    }
  };
})();
