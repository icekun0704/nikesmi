/* ラプンツェル：サンクチュアリ (id 232 / org 205, RL / B2 / 支援型 / 灼熱) — 宝物なし
 *
 * パーサが既に動かしているもの（ここでは触らない）:
 *   - skill1 フルチャージ攻撃時の味方全体回復 3.9%
 *   - skill1 フルバースト時の味方全体 攻撃ダメージ27.45%▲：10秒
 *   - skill2 フルバースト時の味方全体 発動者基準 攻撃力29.17%▲：10秒
 *   - skill2 フルチャージ攻撃時の照準線に最も近い敵1機へ 220.7%追加ダメージ
 *
 * パーサで表現できていない部分:
 *   - バーストの分岐「自分がナノ粒子消耗状態でなければ → 戦闘不能者数別の効果」
 *     パーサは3ブロックを毎回すべて発動させてしまうので、効果を空にして
 *     ここで1つだけ選ぶ。
 *       戦闘不能の味方が3機以上 → ナノ粒子投与
 *         ・HP96%で復活：戦闘中1回発動
 *         ・発動者基準 攻撃力101.37%▲ / 防御力221.76%▲：10秒（戦闘中1回発動）
 *       戦闘不能の味方が2機以下 → 味方全体に 発動者基準 攻撃力34.84%▲：10秒
 *       自分がナノ粒子消耗状態 → 味方全体に 発動者基準 攻撃力34.84%▲：10秒
 *   - ナノ粒子投与を使用した時、自分に
 *       ・バーストスキルクールタイム40秒▲：解除不可（次のバーストを40秒遅らせる）
 *       ・ナノ粒子消耗：防御力10%▲：持続：解除不可：復活後も維持
 *   - パーサの op:revive は engine 側で「発動者自身」にしか付かず、既に
 *     戦闘不能になっている味方を復活させられないため、上の分岐で自前に行う。
 *
 * 実装していないもの:
 *   - skill2「フルチャージ状態を1秒以上維持した時」（共用バリア /
 *     ゴッデスブレッシング 防御力42.24%▲）。engine は RL のチャージ60F・
 *     次弾まで76F で自動射撃するため、フルチャージ状態の保持は16Fしかなく
 *     1秒（60F）に届かない。原文どおりの条件を書いても発動しない。
 *   - skill1「チャージ速度増加効果無効 / 減少効果無効」。engine はチャージ速度
 *     バフを読まないため効果を持たない。
 */
(function () {
  'use strict';

  var FPS = 60;
  var REVIVE_PCT = 96;        /* 原文: ナノ粒子投与：HP96%で復活 */
  var ATK_PCT = 101.37;       /* 原文: 発動者基準で攻撃力101.37%▲ */
  var DEF_PCT = 221.76;       /* 原文: 発動者基準で防御力221.76%▲ */
  var TEAM_ATK_PCT = 34.84;   /* 原文: 発動者基準で攻撃力34.84%▲ */
  var DEPLETED_DEF = 10;      /* 原文: ナノ粒子消耗：防御力10%▲ */
  var CD_PENALTY = 40;        /* 原文: バーストスキルクールタイム40秒▲ */
  var BUFF_SECONDS = 10;      /* 原文: 10秒間維持 */

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

  /* engine の defEff 相当（API には公開されていない） */
  function defEff(u, E) {
    return u.def * (1 + E.sumStat(u, 'defPct') / 100);
  }

  function teamAtk(u, E, frame, pct) {
    var flat = E.atkEff(u) * pct / 100;   /* スキル発動者基準 */
    var allies = E.alive(E.team(u));
    for (var i = 0; i < allies.length; i++) {
      E.buff(allies[i], 'sanc-atk:' + u.pos + ':' + allies[i].pos, 'atkFlat', flat,
        'up', frame + BUFF_SECONDS * FPS, {});
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[232] = {
    init: function (u, E) {
      u.sanc = { depleted: false, adminUsed: false, cdPenalty: 0 };

      var sk = copySkills(u);
      if (sk && sk.burst) {
        /* 戦闘不能者数で分岐するので、パーサが毎回撃つ3ブロックを止める */
        for (var i = 0; i < sk.burst.blocks.length; i++) {
          sk.burst.blocks[i].effects = [];
        }
      }
    },

    tick: function (u, E, frame) {
      var s = u.sanc;
      if (!s) return;
      /* ナノ粒子投与の「バーストスキルクールタイム40秒▲」。
       * fireBurst は onBurst の後にバーストクールタイムを設定するので、
       * 同じフレームの tick で上乗せする。 */
      if (s.cdPenalty) {
        u.burstReadyAt += s.cdPenalty * FPS;
        s.cdPenalty = 0;
      }
    },

    onShot: function () { /* 通常攻撃に固有処理なし */ },

    onBurst: function (u, E, frame) {
      var s = u.sanc;
      if (!s) return;

      var team = E.team(u);
      var dead = [];
      for (var i = 0; i < team.length; i++) {
        if (!team[i].alive) dead.push(team[i]);
      }

      if (!s.depleted) {
        if (dead.length >= 3) {
          /* ナノ粒子投与（戦闘中1回発動） */
          if (!s.adminUsed) {
            s.adminUsed = true;
            var flatAtk = E.atkEff(u) * ATK_PCT / 100;   /* 発動者基準 */
            var flatDef = defEff(u, E) * DEF_PCT / 100;  /* 発動者基準 */
            for (var d = 0; d < dead.length; d++) {
              var m = dead[d];
              m.alive = true;
              m.deathFrame = -1;
              m.revived = true;
              m.hp = Math.max(1, Math.round(m.hpMax * REVIVE_PCT / 100));
              E.buff(m, 'sanc-admin-atk:' + u.pos + ':' + m.pos, 'atkFlat', flatAtk,
                'up', frame + BUFF_SECONDS * FPS, {});
              E.buff(m, 'sanc-admin-def:' + u.pos + ':' + m.pos, 'defFlat', flatDef,
                'up', frame + BUFF_SECONDS * FPS, {});
              E.event({ frame: frame, kind: 'sanc-revive', side: u.side, unit: u.name,
                        target: m.name, pos: m.pos, hpPct: REVIVE_PCT });
            }
            /* ナノ粒子消耗：防御力10%▲：持続：解除不可：復活後も維持 */
            s.depleted = true;
            E.buff(u, 'sanc-depleted', 'defPct', DEPLETED_DEF, 'up', Infinity, {});
            /* バーストスキルクールタイム40秒▲：解除不可 */
            s.cdPenalty = CD_PENALTY;
            E.event({ frame: frame, kind: 'sanc-admin', side: u.side, unit: u.name });
            return;
          }
          /* 既に使用済み（通常は depleted になっている）ので下の分岐へ */
        }
        /* 戦闘不能の味方が2機以下：味方全体に 発動者基準 攻撃力34.84%▲ */
        teamAtk(u, E, frame, TEAM_ATK_PCT);
        return;
      }

      /* 自分がナノ粒子消耗状態：味方全体に 発動者基準 攻撃力34.84%▲ */
      teamAtk(u, E, frame, TEAM_ATK_PCT);
    }
  };
})();
