/* エレグ (id 187 / org 112, MG, B2, 支援型)
 *
 * パーサで表現できていない部分:
 *   - 「対象がブームインストール状態なら」という条件。
 *     ブームインストールはバーストで照準線に最も近い敵に付く（防御力35.64%▼：10秒）。
 *     パーサはこの状態を持っておらず、スキル1/2のカウンターを無条件で発動させるので、
 *     この2ブロックを止めて、条件付きで撃ち直す。
 *       · 通常攻撃が100回命中した時 → 対象と周囲の敵2機に 91.03% の分配ダメージ
 *       · 通常攻撃が60回命中した時 → 味方全体に 発動者基準 攻撃力13.09%▲：5秒
 *
 * 実装していないもの:
 *   - スキル1「敵の発射体を攻撃する時、該当の発射体に与えるダメージ59.66%▲」
 *     engine に発射体（敵の弾）の概念が無い。
 *   - スキル2「ターゲットが出現した時、味方全体に バーストゲージのチャージ100%：
 *     戦闘中1回発動」… 『ターゲット』はレイド/射撃場の的で、アリーナには存在しない
 *     （js/docs.js / 他の固有実装と同じ解釈）。
 *   - バーストの分配ダメージ39.74%▲／79.2%ダメージ／防御力35.64%▼ はパーサが処理済み。
 */
(function () {
  'use strict';

  var HITS_S1 = 100;            /* 原文: 通常攻撃が100回命中した時 */
  var HITS_S2 = 60;             /* 原文: 通常攻撃が60回命中した時 */
  var S1_DMG_PCT = 91.03;       /* 原文: 最終攻撃力の91.03%の分配ダメージ */
  var S1_SPLASH = 2;            /* 原文: 周囲の敵2機 */
  var S2_ATK_PCT = 13.09;       /* 原文: スキル発動者基準で攻撃力13.09%▲ */
  var S2_SECONDS = 5;           /* 原文: 5秒間維持 */

  /* E.pickTarget は README では (u, frame)、engine の実装は (u, enemies, frame)。 */
  function primaryTarget(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  /* 対象と、位置が近い敵を最大 n 機 */
  function targetAndNeighbours(u, E, target, n) {
    if (!target) return [];
    var list = E.alive(E.enemies(u)).filter(function (e) { return e !== target; });
    list.sort(function (a, b) {
      return Math.abs(a.pos - target.pos) - Math.abs(b.pos - target.pos);
    });
    return [target].concat(list.slice(0, n));
  }

  function cloneSkills(u) {
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (!src || !u.skillState) return;
    u.skills = JSON.parse(JSON.stringify(src));
    for (var s = 0; s < u.skillState.length; s++) {
      var st = u.skillState[s];
      var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
      if (!arr) continue;
      for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[187] = {
    init: function (u, E) {
      cloneSkills(u);
      /* 無条件で走っている2つのカウンターを止める */
      if (u.skills) {
        if (u.skills.skill1 && u.skills.skill1.blocks[1]) {
          u.skills.skill1.blocks[1].trigger = { kind: 'disabled' };
        }
        if (u.skills.skill2 && u.skills.skill2.blocks[0]) {
          u.skills.skill2.blocks[0].trigger = { kind: 'disabled' };
        }
      }
      u.eleg = { hits: 0, installTarget: null, installUntil: -1, installFrame: -1 };
    },

    tick: function (u, E, frame) {
      var s = u.eleg;
      if (!s) return;

      /* ブームインストールはバーストの「防御力35.64%▼：10秒」として敵1機に付く。
       * バースト処理はこのフレームの tick より前に走っているので、
       * 「このフレームで新しく付いた defPct ダウンのバフ」がそれ。
       * （バフのキーは engine 側の都合でスロット名が入らないことがあるため、
       *  キーではなく stat / dir / refreshed で見る） */
      if (s.installFrame === frame) {
        var foes = E.alive(E.enemies(u));
        for (var i = 0; i < foes.length && !s.installTarget; i++) {
          var bs = foes[i].buffs || [];
          for (var b = 0; b < bs.length; b++) {
            var buf = bs[b];
            if (buf.stat !== 'defPct' || buf.dir !== 'down') continue;
            if (buf.refreshed !== frame) continue;
            if (buf.until < frame) continue;
            s.installTarget = foes[i];
            s.installUntil = buf.until;
            break;
          }
        }
      }
      if (s.installTarget && (!s.installTarget.alive || frame > s.installUntil)) {
        s.installTarget = null;
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = u.eleg;
      if (!s) return;

      var prev = s.hits;
      s.hits += (shot && shot.hits) || 0;

      var t = primaryTarget(u, E, frame);
      var installed = !!(s.installTarget && t === s.installTarget &&
                         t.alive && frame <= s.installUntil);

      /* ---- 100回命中：ブームインストール状態の対象に分配ダメージ */
      if (Math.floor(s.hits / HITS_S1) > Math.floor(prev / HITS_S1) && installed) {
        var hits = targetAndNeighbours(u, E, t, S1_SPLASH);
        for (var i = 0; i < hits.length; i++) {
          E.damage(u, hits[i], frame, { multiplierPct: S1_DMG_PCT, isDistributed: true });
        }
        E.event({ frame: frame, kind: 'eleg-boom', side: u.side, unit: u.name });
      }

      /* ---- 60回命中：ブームインストール状態の対象なら味方全体に攻撃力 */
      if (Math.floor(s.hits / HITS_S2) > Math.floor(prev / HITS_S2) && installed) {
        var until = frame + S2_SECONDS * E.FPS;
        var flat = E.atkEff(u) * S2_ATK_PCT / 100;
        var allies = E.alive(E.team(u));
        for (var a = 0; a < allies.length; a++) {
          E.buff(allies[a], 'eleg-fast-charge', 'atkFlat', flat, 'up', until, {});
        }
        E.event({ frame: frame, kind: 'eleg-fast-charge', side: u.side, unit: u.name });
      }
    },

    onBurst: function (u, E, frame) {
      var s = u.eleg;
      if (!s) return;
      /* ブームインストールの対象は、このフレームのバースト処理で決まる。
       * tick（バースト処理より後）で拾う。 */
      s.installTarget = null;
      s.installUntil = -1;
      s.installFrame = frame;
    }
  };
})();
