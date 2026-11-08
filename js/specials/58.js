/* レーベル (id 58 / org 179, AR / B1 / 防御型 / 鉄甲) — 宝物なし
 *
 * 妄想 / 妄想崩壊 / 妄想共有 の状態機械。
 *
 * パーサが既に動かしているもの（ここでは触らない）:
 *   - 戦闘開始時のバリア「妄想：発動者の最終最大HPの30.15%」（= 妄想状態の開始）
 *   - バーストの最大HP20.26%▲：10秒間維持
 *
 * パーサで表現できていない部分:
 *   - 「自分が妄想状態でなければ」妄想を再展開する条件。
 *     パーサは通常攻撃時・バースト時のバリアを無条件に張るので、
 *     この2ブロックの効果だけ空にして、状態を見て自前で張る。
 *   - 「妄想状態が終了した時」の妄想崩壊（最大2回）。
 *     妄想状態 = 自分が展開したバリアが残っている間。バリアが0になった
 *     フレームで、気絶 1秒×妄想崩壊回数と想像失恋を付与する。
 *   - skill2「自分が妄想状態の時に限り、自分に」
 *       バーストゲージのチャージ速度70.4%▲ / 攻撃力93.39%▲ /
 *       電撃コードの敵から受けるダメージ70.4%▼（いずれも持続）
 *   - skill2「戦闘開始時、自分を除く味方全体に
 *       電撃コードの敵から受けるダメージ70.4%▼：5秒間維持：戦闘中1回発動」
 *   - バースト「妄想共有：自分が展開したバリアに無敵付与：10秒間維持」と、
 *     「自分が妄想共有状態の時に限り、自分を除く味方全体に
 *       スキル発動者基準で攻撃力80.36%▲：持続」
 *
 * 実装していないもの:
 *   - 想像失恋の「単一攻撃対象から除外」。engine の pickTarget には対象を
 *     外す口が無いため、u.illusionUntil を立てるだけでターゲット選択には
 *     影響しない（他キャラの隠れ身と同じ扱い）。
 *
 * 近似:
 *   - 「妄想状態」は engine にバリアの所有者が無いため、u.shield > 0 で判定する。
 *     味方が張ったバリアでも妄想中とみなす。
 *   - 「電撃コードの敵から受けるダメージ70.4%▼」は engine の takenDmgPct が
 *     攻撃元の属性を見ないため、電撃の敵が生きている間だけ付与する。
 */
(function () {
  'use strict';

  var FPS = 60;
  var BARRIER_PCT = 30.15;      /* 原文: 発動者の最終最大HPの30.15%のバリア */
  var DELUSION_ATK = 93.39;     /* 原文: 攻撃力93.39%▲ */
  var DELUSION_GAUGE = 70.4;    /* 原文: バーストゲージのチャージ速度70.4%▲ */
  var ELEC_TAKEN_DOWN = 70.4;   /* 原文: 電撃コードの敵から受けるダメージ70.4%▼ */
  var SHARE_ATK = 80.36;        /* 原文: 発動者基準で攻撃力80.36%▲ */
  var SHARE_SECONDS = 10;       /* 原文: 妄想共有：10秒間維持 */
  var START_DEBUFF_SECONDS = 5; /* 原文: 5秒間維持 */
  var COLLAPSE_MAX = 2;         /* 原文: 妄想崩壊：最大2回 */

  /* このユニット専用にスキル定義を複製する（SKILL_DB は全ユニットで共有） */
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

  function hasElectricEnemy(u, E) {
    var foes = E.enemies(u) || [];
    for (var i = 0; i < foes.length; i++) {
      if (foes[i].alive && foes[i].element === '電撃') return true;
    }
    return false;
  }

  function grantDelusion(u, E, frame) {
    var s = u.label;
    /* 妄想：発動者の最終最大HPの30.15%のバリア（持続） */
    u.shield = Math.max(u.shield, Math.round(u.hpMax * BARRIER_PCT / 100));
    s.delusion = true;
    E.event({ frame: frame, kind: 'label-delusion', side: u.side, unit: u.name });
  }

  (window.SPECIALS = window.SPECIALS || {})[58] = {
    init: function (u, E) {
      u.label = {
        delusion: u.shield > 0,
        collapse: 0,
        shareUntil: -1,
        teamBuffDone: false
      };

      var sk = copySkills(u);
      if (sk && sk.skill1) {
        for (var i = 0; i < sk.skill1.blocks.length; i++) {
          var t = sk.skill1.blocks[i].trigger || {};
          /* 「自分が妄想状態でなければ」を自前で判定するため、
           * 通常攻撃時／バースト時の無条件バリアを止める */
          if (t.kind === 'attack' || t.kind === 'burst') {
            sk.skill1.blocks[i].effects = [];
          }
        }
      }
    },

    tick: function (u, E, frame) {
      var s = u.label;
      if (!s) return;

      /* 戦闘開始時、自分を除く味方全体に
       * 電撃コードの敵から受けるダメージ70.4%▼：5秒間維持：戦闘中1回発動 */
      if (!s.teamBuffDone) {
        s.teamBuffDone = true;
        if (hasElectricEnemy(u, E)) {
          var allies0 = E.alive(E.team(u));
          for (var i0 = 0; i0 < allies0.length; i0++) {
            var a0 = allies0[i0];
            if (a0 === u) continue;
            E.buff(a0, 'label-team-elec:' + u.pos + ':' + a0.pos, 'takenDmgPct',
              ELEC_TAKEN_DOWN, 'down', frame + START_DEBUFF_SECONDS * FPS, {});
          }
        }
      }

      /* 妄想 = 自分が展開したバリアが残っている間。
       * バリアが 0 になった瞬間を「妄想状態が終了した時」とする。 */
      var had = s.delusion;
      if (had && !(u.shield > 0)) {
        s.delusion = false;
        if (s.collapse < COLLAPSE_MAX) {
          s.collapse += 1;
          var secs = s.collapse;                  /* 1秒 × 妄想崩壊回数 */
          var until = frame + secs * FPS;
          /* 効果2：気絶：1秒×妄想崩壊回数分だけ維持 */
          u.stunUntil = Math.max(u.stunUntil, until);
          /* 効果1：想像失恋（単一攻撃対象から除外）。
           * engine の pickTarget に除外の口が無いので状態だけ持つ。 */
          u.illusionUntil = Math.max(u.illusionUntil == null ? -1 : u.illusionUntil, until);
          E.event({ frame: frame, kind: 'label-collapse', side: u.side, unit: u.name,
                    count: s.collapse });
        }
      }
      s.delusion = u.shield > 0;

      /* 妄想状態の時に限り、自分に 3種のバフ（持続） */
      if (s.delusion) {
        E.buff(u, 'label-delusion-gauge', 'burstGaugePct', DELUSION_GAUGE, 'up',
          Infinity, { aura: true });
        E.buff(u, 'label-delusion-atk', 'atkPct', DELUSION_ATK, 'up',
          Infinity, { aura: true });
        if (hasElectricEnemy(u, E)) {
          E.buff(u, 'label-delusion-elec', 'takenDmgPct', ELEC_TAKEN_DOWN, 'down',
            Infinity, { aura: true });
        }
      }

      /* 妄想共有：10秒間
       *   ・自分を除く味方全体に 発動者基準で攻撃力80.36%▲
       *   ・自分が展開したバリアに無敵付与（= バリアが減らない） */
      if (frame <= s.shareUntil) {
        var flat = E.atkEff(u) * SHARE_ATK / 100;
        var allies = E.alive(E.team(u));
        for (var i = 0; i < allies.length; i++) {
          var a = allies[i];
          if (a === u) continue;
          E.buff(a, 'label-share:' + u.pos + ':' + a.pos, 'atkFlat', flat, 'up',
            Infinity, { aura: true });
        }
        if (u.shield > 0) {
          /* バリア単位の無敵は engine に無いので、バリアが残っている間の
           * 被ダメージを 0 にする（結果としてバリアも減らない）。 */
          u.invulnUntil = Math.max(u.invulnUntil, frame + 1);
        }
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = u.label;
      if (!s) return;
      /* 通常攻撃をした時、自分が妄想状態でなければ妄想を再展開 */
      if (!s.delusion && !(u.shield > 0)) grantDelusion(u, E, frame);
    },

    onBurst: function (u, E, frame) {
      var s = u.label;
      if (!s) return;
      /* バーストスキルを使用した時、自分が妄想状態でなければ妄想を再展開 */
      if (!s.delusion && !(u.shield > 0)) grantDelusion(u, E, frame);
      /* 妄想共有：10秒間維持 */
      s.shareUntil = frame + SHARE_SECONDS * FPS;
      E.event({ frame: frame, kind: 'label-share', side: u.side, unit: u.name });
    }
  };
})();
