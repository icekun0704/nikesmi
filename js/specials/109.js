/* トロニー (id 109, SR, B3, 火力型) — 宝物なし
 *
 * パーサで表現できなかった部分:
 *   - skill1「蓄積爆破」: フルチャージ攻撃が命中した時、T.Ronyボンバー状態の敵が
 *     いなければ対象に蓄積爆破を付与。5秒間、自分が与えたダメージの50%を蓄積し、
 *     最大（最終攻撃力の1536%）に達したら周囲の敵全体に分配ダメージを与えて解除。
 *     → パーサは5行すべて unparsed（状態機械なので表現不能）。
 *   - skill2 の2ブロックは trigger=unknown のため発火しない。
 *     「フルチャージして5回攻撃した時」→ 自分に 分配ダメージ51.84%▲ 10秒
 *     「フルチャージして5回命中した時」→ 対象に 防御力9.59%▼ 10秒
 *     （数値は SKILL_DB に入っているがエンジンからは一度も発火しないので、ここで付与する）
 *   - burst「蓄積爆破のダメージ蓄積割合62.83%▲：10秒間維持」は unparsed。
 *     蓄積割合を 50% → 50+62.83% として扱う。
 *
 * 不明点（推測で埋めていないもの）:
 *   - 「周囲の敵全体」の範囲。エンジンに爆風半径の指定が無いため敵全体に分配する。
 *   - 蓄積割合62.83%▲ が加算か乗算か（原文に記述なし）。加算とした。
 */
(function () {
  'use strict';

  var FPS = 60;

  /* E.pickTarget は README では (u, frame)、engine の実装は (u, enemies, frame)。 */
  function pickTargetOf(u, E, frame) {
    try {
      var t = E.pickTarget(u, E.enemies(u), frame);
      if (t) return t;
    } catch (e) { /* 2引数版 */ }
    try { return E.pickTarget(u, frame) || null; } catch (e2) { return null; }
  }

  (window.SPECIALS = window.SPECIALS || {})[109] = {
    init: function (u, E) {
      u.trony = {
        bomb: null,        // { target, until, stored, max }
        ratioUntil: -1,    // バースト中の蓄積割合アップ
        lastDamage: 0,
        fcShots: 0,
        fcHits: 0
      };
    },

    tick: function (u, E, frame) {
      var st = u.trony;
      if (!st) return;

      var dealt = u.damageDealt || 0;
      var delta = dealt - st.lastDamage;
      st.lastDamage = dealt;

      var bomb = st.bomb;
      if (!bomb) return;

      if (!bomb.target.alive || frame > bomb.until) { st.bomb = null; return; }

      // 効果2: 自分の攻撃ダメージの50%分蓄積
      var ratio = frame <= st.ratioUntil ? (0.5 + 0.6283) : 0.5;
      if (delta > 0) bomb.stored += delta * ratio;

      // 効果1/3: 最大蓄積量（最終攻撃力の1536%）に到達したら分配ダメージで解除
      if (bomb.stored >= bomb.max) {
        var foes = E.alive(E.enemies(u));
        var atk = E.atkEff(u);
        if (foes.length && atk > 0) {
          var per = bomb.stored / foes.length;
          for (var i = 0; i < foes.length; i++) {
            E.damage(u, foes[i], frame, { multiplierPct: per / atk * 100, isDistributed: true });
          }
        }
        E.event({ frame: frame, kind: 'trony-bomb', side: u.side, unit: u.name, pos: u.pos });
        st.bomb = null;
      }
    },

    onShot: function (u, E, frame, shot) {
      var st = u.trony;
      if (!st) return;
      if (!shot || !shot.hits) return;
      // フルチャージ攻撃（SR / RL）のみ
      if (u.weapon !== 'SR' && u.weapon !== 'RL') return;

      st.fcShots += 1;
      st.fcHits += shot.hits;

      // skill2: フルチャージして5回攻撃した時 → 自分に分配ダメージ51.84%▲
      if (st.fcShots % 5 === 0) {
        E.buff(u, 'trony-s2-shot', 'distributedDmgPct', 51.84, 'up', frame + 10 * FPS, {});
      }
      // skill2: フルチャージして5回命中した時 → 対象に防御力9.59%▼
      if (st.fcHits % 5 === 0) {
        var t = pickTargetOf(u, E, frame);
        if (t) E.buff(t, 'trony-s2-hit', 'defPct', 9.59, 'down', frame + 10 * FPS, {});
      }

      // skill1: T.Ronyボンバー状態の敵がいなければ、対象に蓄積爆破を付与
      if (!st.bomb) {
        var target = pickTargetOf(u, E, frame);
        if (target && target.alive) {
          st.bomb = {
            target: target,
            until: frame + 5 * FPS,
            stored: 0,
            max: E.atkEff(u) * 15.36
          };
          // 付与より前のダメージは蓄積しない
          st.lastDamage = u.damageDealt || 0;
        }
      }
    },

    onBurst: function (u, E, frame) {
      if (u.trony) u.trony.ratioUntil = frame + 10 * FPS;
    }
  };
})();
