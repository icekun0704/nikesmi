/* ドロシー (id 139 / org 8, AR / B1 / 支援型 / 水冷) — 宝物なし
 *
 * パーサが既に動かしているもの（ここでは触らない）:
 *   - skill1 最後の弾丸時の味方全体 バーストクールタイム1.56秒▼
 *   - skill2 敵全体への焦土化 216%（分配ダメージ）
 *
 * パーサで表現できていない部分:
 *   - バースト「烙印」：指定した敵1機が受けているダメージを10秒間累計し、
 *     維持終了後に累計ダメージを敵全体へ分配ダメージとして与える。
 *     累計の上限は発動者の最終攻撃力の8900.83%（分配ダメージ増加効果ぶん増える）。
 *   - バースト「発現」：10秒間、スキル2のクールタイムを2秒に変更する。
 *   - バースト「貫通特化」は engine に通常攻撃を貫通へ変える口が無いため
 *     実装していない（パーサの op:pierceSpecial も engine は無視する）。
 *
 * 実装上の注意:
 *   - skill2 の周期は SKILL_DB では trigger.seconds が "20秒" という文字列で、
 *     engine の `(trig.seconds || sk.ct || 20) * FPS` が NaN になり毎フレーム
 *     発動してしまう。このユニット専用の複製だけ数値（20 / 発現中は 2）に直す。
 *   - 烙印の累計値は「対象の damageTaken の増分」で近似する（バリア／遮蔽物が
 *     吸った分は engine の damageTaken に入らない）。分配ダメージは
 *     「決められたダメージ量を敵の数で等分する」仕様（用語集）に従い、
 *     累計値を生存敵数で割った量を、各敵の (攻撃力−防御力) に対する倍率へ
 *     換算して与える。
 *
 * 実装していないもの:
 *   - skill1「敵のパーツを攻撃する時、該当のパーツに与えるダメージ50.68%▲」。
 *     アリーナにパーツが無い。
 */
(function () {
  'use strict';

  var FPS = 60;
  var BRAND_SECONDS = 10;      /* 原文: 烙印：10秒間維持 */
  var BRAND_CAP_PCT = 8900.83; /* 原文: 最大累計量は発動者の最終攻撃力の8900.83% */
  var MANIFEST_SECONDS = 10;   /* 原文: 発現：10秒間維持 */
  var MANIFEST_CD = 2;         /* 原文: 発現：スキル2のクールタイム2秒 */
  var BASE_CD = 20;            /* パース結果のスキル2周期（原文の20秒） */

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

  function skill2State(u) {
    for (var s = 0; s < u.skillState.length; s++) {
      if (u.skillState[s].slot === 'skill2') return u.skillState[s];
    }
    return null;
  }

  /* skill2 の periodic トリガー（このユニット専用の複製） */
  function skill2Trigger(u) {
    var st = skill2State(u);
    if (!st) return null;
    for (var b = 0; b < st.blocks.length; b++) {
      var t = st.blocks[b].block && st.blocks[b].block.trigger;
      if (t && t.kind === 'periodic') return t;
    }
    return null;
  }

  function primaryTarget(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  function resolveBrand(u, E, frame) {
    var s = u.dorothy;
    var b = s && s.brand;
    if (!b) return;
    s.brand = null;

    var cap = E.atkEff(u) * BRAND_CAP_PCT / 100 *
      (1 + E.sumStat(u, 'distributedDmgPct') / 100);
    var accum = (b.target.damageTaken || 0) - b.start;
    if (accum < 0) accum = 0;
    if (accum > cap) accum = cap;
    if (accum <= 0) return;

    var foes = E.alive(E.enemies(u));
    if (!foes.length) return;
    var each = accum / foes.length;      /* 分配：敵の数で等分 */
    var atk = E.atkEff(u);
    for (var i = 0; i < foes.length; i++) {
      var f = foes[i];
      var def = f.def * (1 + E.sumStat(f, 'defPct') / 100);
      var base = Math.max(1, atk - def);
      E.damage(u, f, frame, {
        multiplierPct: (each / base) * 100,
        isDistributed: true
      });
    }
    E.event({ frame: frame, kind: 'dorothy-brand', side: u.side, unit: u.name,
              amount: accum, targets: foes.length });
  }

  (window.SPECIALS = window.SPECIALS || {})[139] = {
    init: function (u, E) {
      u.dorothy = { brand: null, manifestUntil: -1 };

      copySkills(u);
      /* skill2 の周期を数値にする（NaN で毎フレーム発動してしまうため） */
      var trig = skill2Trigger(u);
      if (trig) trig.seconds = BASE_CD;
    },

    tick: function (u, E, frame) {
      var s = u.dorothy;
      if (!s) return;

      /* 発現：10秒間、スキル2のクールタイムが2秒になる */
      var trig = skill2Trigger(u);
      if (trig) {
        var want = frame <= s.manifestUntil ? MANIFEST_CD : BASE_CD;
        if (trig.seconds !== want) trig.seconds = want;
      }

      /* 烙印の維持終了 → 累計ダメージを分配 */
      if (s.brand && frame > s.brand.until) resolveBrand(u, E, frame);
    },

    onShot: function () { /* 通常攻撃に固有処理なし */ },

    onBurst: function (u, E, frame) {
      var s = u.dorothy;
      if (!s) return;

      /* 烙印：指定された敵対象1機（= 通常攻撃で狙っている相手） */
      var target = primaryTarget(u, E, frame);
      if (target) {
        /* 前の烙印が残っていれば先に精算する */
        if (s.brand) resolveBrand(u, E, frame);
        s.brand = {
          target: target,
          start: target.damageTaken || 0,
          until: frame + BRAND_SECONDS * FPS
        };
        E.event({ frame: frame, kind: 'dorothy-brand-start', side: u.side,
                  unit: u.name, target: target.name, pos: target.pos });
      }

      /* 発現：スキル2のクールタイム2秒（10秒間） */
      s.manifestUntil = frame + MANIFEST_SECONDS * FPS;
      var st2 = skill2State(u);
      if (st2 && st2.nextPeriodic > frame + MANIFEST_CD * FPS) {
        st2.nextPeriodic = frame + MANIFEST_CD * FPS;
      }
      E.event({ frame: frame, kind: 'dorothy-manifest', side: u.side, unit: u.name });
    }
  };
})();
