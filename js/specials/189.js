/* エマ：タクティカル・アップ (id 189 / org 163, MG, B1, 支援型)
 *
 * パーサで表現できていない部分:
 *   - 環境コントロール（スキル1）の周期
 *       戦闘開始時／30秒ごとに10秒間（ASフォーメーション適用中は再発動周期 -20秒 = 10秒）。
 *       発動中は敵全体の受けるダメージ +3.9%、味方全体に最終最大HPの2.32%を1秒ごとに回復。
 *       パーサはこれを「自分だけ」に1回配って終わるので、そのブロックを止めて回し直す。
 *   - 陽動（スキル1）「敵出現時、自分に ヘイト：敵全体を挑発：持続」
 *     アリーナでは戦闘開始時に敵が揃っているため、開始時から挑発状態にする。
 *     ASフォーメーション適用中は「陽動発動不可」なので解除する。
 *   - LTフォーメーション（スキル2）「自分が生存している限り、同じ部隊の味方全体に
 *       クリティカルダメージ23.51%▲：持続」「味方全体に 発射体爆発ダメージ2.32%▲：持続」
 *     パーサは自分にだけ配っている。同じ部隊（Absolute = エマ/ウンファ/ベスティーと
 *     そのタクティカル・アップ版）へ配り直す。
 *   - ASフォーメーション適用中（= 同じ部隊のウンファ：タクティカル・アップが生存）の追加効果
 *       「味方全体に 防御力無視ダメージ30.97%▲：持続」
 *       「味方全体に 発射体爆発ダメージ3.09%▲：持続」
 *       「自分に 陽動発動不可」／「自分に 環境コントロール再発動周期20秒▼」
 *     パーサは条件を見ずに開始時に配ってしまうので、止めて条件付きで配る。
 *   - バースト「自分が環境コントロール状態なら、自分に
 *       環境コントロール強化（ダメージ増加倍率を効果量100%ぶん上乗せ）
 *       受けるHP回復量29.04%▲：味方全体」
 *     10秒間だけ環境コントロールの受けるダメージ増加を 3.9% → 7.8% にし、
 *     味方全体の受ける回復量を +29.04% する。
 *
 * パーサが処理済みなので触らないもの:
 *   - バーストの戦場コントロール（発動者基準 攻撃力40.07%▲：10秒）
 *
 * 実装していないもの:
 *   - 「環境コントロール効果中に出現した敵を含む」… アリーナに途中出現は無い。
 *   - 「発射体爆発ダメージ」は engine が読まない stat（数値だけ保持する）。
 */
(function () {
  'use strict';

  var ENV_SECONDS = 10;         /* 原文: 10秒間維持 */
  var ENV_INTERVAL = 30;        /* 原文: 再発動周期30秒 */
  var ENV_INTERVAL_AS = 10;     /* 原文: 再発動周期20秒▼（30 - 20） */
  var ENV_TAKEN_PCT = 3.9;      /* 原文: 受けるダメージ3.9%▲ */
  var ENV_HEAL_PCT = 2.32;      /* 原文: 最終最大HPの2.32%持続回復 */
  var ENHANCE_HEAL_PCT = 29.04; /* 原文: 受けるHP回復量29.04%▲ */
  var LT_CDMG_PCT = 23.51;      /* 原文: クリティカルダメージ23.51%▲ */
  var LT_PROJ_PCT = 2.32;       /* 原文: 発射体爆発ダメージ2.32%▲ */
  var AS_TRUEDMG_PCT = 30.97;   /* 原文: 防御力無視ダメージ30.97%▲ */
  var AS_PROJ_PCT = 3.09;       /* 原文: 発射体爆発ダメージ3.09%▲ */

  /* 同じ部隊（Absolute）: エマ174 / ウンファ90 / ベスティー41 /
   * エマ:TU189 / ウンファ:TU114 / ベスティー:TU87 */
  var ABSOLUTE = [174, 90, 41, 189, 114, 87];
  var AS_FORMATION_SOURCE = 114;  /* ウンファ：タクティカル・アップ */

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

  function hasAsFormation(u, E) {
    var team = E.alive(E.team(u));
    for (var i = 0; i < team.length; i++) {
      if (team[i].id === AS_FORMATION_SOURCE) return true;
    }
    return false;
  }

  (window.SPECIALS = window.SPECIALS || {})[189] = {
    init: function (u, E) {
      cloneSkills(u);
      if (u.skills) {
        /* スキル1: 環境コントロール（自分だけに1回配られる） */
        if (u.skills.skill1 && u.skills.skill1.blocks[0]) {
          u.skills.skill1.blocks[0].trigger = { kind: 'disabled' };
        }
        /* スキル2: LTフォーメーション本体と、ASフォーメーション時の追加効果 */
        if (u.skills.skill2) {
          if (u.skills.skill2.blocks[0]) {
            u.skills.skill2.blocks[0].trigger = { kind: 'disabled' };
          }
          if (u.skills.skill2.blocks[1]) {
            u.skills.skill2.blocks[1].trigger = { kind: 'disabled' };
          }
        }
        /* バースト: 環境コントロール強化（受ける回復量を自分に永続で配ってしまう） */
        if (u.skills.burst && u.skills.burst.blocks[1]) {
          u.skills.burst.blocks[1].trigger = { kind: 'disabled' };
        }
      }
      u.emmaTU = { enhanceUntil: -1, lastBurstFrame: -1 };
    },

    tick: function (u, E, frame) {
      var s = u.emmaTU;
      if (!s) return;

      var as = hasAsFormation(u, E);
      var interval = (as ? ENV_INTERVAL_AS : ENV_INTERVAL) * E.FPS;
      var windowStart = Math.floor(frame / interval) * interval;
      var inWindow = frame - windowStart <= ENV_SECONDS * E.FPS;
      var windowEnd = windowStart + ENV_SECONDS * E.FPS;

      /* ---- 陽動：ASフォーメーション適用中は発動不可 */
      if (as) {
        if (u.tauntUntil > frame) u.tauntUntil = -1;
      } else {
        u.tauntUntil = Infinity;   /* ヘイト：敵全体を挑発（持続） */
      }

      /* ---- LTフォーメーション：同じ部隊の味方にクリティカルダメージ（オーラ） */
      var team = E.alive(E.team(u));
      for (var i = 0; i < team.length; i++) {
        var a = team[i];
        if (ABSOLUTE.indexOf(a.id) >= 0) {
          E.buff(a, 'emma-lt-cdmg', 'critDmgPct', LT_CDMG_PCT, 'up', frame + 2, { aura: true });
        }
        E.buff(a, 'emma-lt-proj', 'projectileDmgPct', LT_PROJ_PCT, 'up', frame + 2, { aura: true });
      }

      /* ---- ASフォーメーション適用中の追加効果 */
      if (as) {
        for (var j = 0; j < team.length; j++) {
          E.buff(team[j], 'emma-as-truedmg', 'ignoreDefDmgPct',
            AS_TRUEDMG_PCT, 'up', frame + 2, { aura: true });
          E.buff(team[j], 'emma-as-proj', 'projectileDmgPct',
            AS_PROJ_PCT, 'up', frame + 2, { aura: true });
        }
      }

      /* ---- 環境コントロール：敵全体の受けるダメージ増加と、味方の持続回復 */
      if (inWindow) {
        var foes = E.alive(E.enemies(u));
        var boosted = s.enhanceUntil > frame;
        for (var f = 0; f < foes.length; f++) {
          E.buff(foes[f], 'emma-env', 'takenDmgPct',
            ENV_TAKEN_PCT, 'up', windowEnd, {});
          if (boosted) {
            /* 環境コントロール強化：ダメージ増加倍率を効果量100%ぶん上乗せ */
            E.buff(foes[f], 'emma-env-boost', 'takenDmgPct',
              ENV_TAKEN_PCT, 'up', Math.min(s.enhanceUntil, windowEnd), {});
          }
        }
        if (frame > windowStart && (frame - windowStart) % E.FPS === 0) {
          var allies = E.alive(E.team(u));
          for (var h = 0; h < allies.length; h++) {
            E.heal(allies[h], u.hpMax * ENV_HEAL_PCT / 100, frame);
          }
        }
      }
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) {
      var s = u.emmaTU;
      if (!s) return;

      /* 自分が環境コントロール状態か */
      var as = hasAsFormation(u, E);
      var interval = (as ? ENV_INTERVAL_AS : ENV_INTERVAL) * E.FPS;
      var windowStart = Math.floor(frame / interval) * interval;
      if (frame - windowStart > ENV_SECONDS * E.FPS) return;

      var until = frame + ENV_SECONDS * E.FPS;
      s.enhanceUntil = until;

      /* 環境コントロール強化：味方全体の受けるHP回復量 +29.04% */
      var allies = E.alive(E.team(u));
      for (var i = 0; i < allies.length; i++) {
        E.buff(allies[i], 'emma-env-heal', 'recoveryTakenPct',
          ENHANCE_HEAL_PCT, 'up', until, {});
      }
      E.event({ frame: frame, kind: 'emma-enhance', side: u.side, unit: u.name });
    }
  };
})();
