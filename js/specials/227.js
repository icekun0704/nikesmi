/* ギルティ：マイティバニー (id 227 / org 201, SR, B3, 火力型)
 *
 * パーサで表現できていない部分:
 *   - バニーモード（スタンス／エンゲージ）の状態機械
 *       戦闘開始時はスタンス。フルチャージ状態を1秒以上維持すると切替。
 *       自分にモードが適用されると、逆モードの味方も同じモードになる
 *       （シン：スウィフトバニー id 228 と同じ u.bunny を共有する）。
 *   - スタンス時の常時効果（解除不可）
 *       攻撃ダメージ20.45%▲／チャージダメージ40%▲
 *   - エンゲージ時：フルチャージ攻撃が命中した対象に
 *       最終攻撃力の370.08%の防御力無視ダメージ
 *   - スタンス時：フルチャージ攻撃が命中した対象に
 *       最終攻撃力の450.89%の追加ダメージ
 *   - バースト「マイティストンプ：使用武器変更
 *       チャージ時間1.5秒に固定／ダメージ101.3%／フルチャージ250%／維持時間1発」
 *     次の1発だけ、チャージ時間を1.5秒にし、武器ダメージを 69.04% → 101.3% に
 *     置き換える（engine に武器を差し替える口が無いので、差分を追加ダメージで与える）。
 *     あわせて「チャージダメージ1400%▲：1発間維持」と
 *     「攻撃ダメージ77.35%▲：10秒間持続」を配る。
 *
 * 実装していないもの:
 *   - エンゲージ時「通常攻撃に防御力無視ダメージを適用」
 *     通常攻撃のダメージ種別を差し替える口が engine に無い。
 *   - マイティストンプの1発にスタンス／エンゲージの追加ダメージを重ねるかは
 *     原文に書かれていないため、重ねていない。
 */
(function () {
  'use strict';

  var STANCE_ATKDMG_PCT = 20.45;   /* 原文: 攻撃ダメージ20.45%▲ */
  var STANCE_CHARGEDMG_PCT = 40;   /* 原文: チャージダメージ40%▲ */
  var ENGAGE_TRUEDMG_PCT = 370.08; /* 原文: 最終攻撃力の370.08%の防御力無視ダメージ */
  var STANCE_EXTRA_PCT = 450.89;   /* 原文: 最終攻撃力の450.89%の追加ダメージ */
  var BURST_ATKDMG_PCT = 77.35;    /* 原文: 攻撃ダメージ77.35%▲：10秒間持続 */
  var BURST_CHARGEDMG_PCT = 1400;  /* 原文: チャージダメージ1400%▲：1発間維持 */
  var STOMP_DMG_PCT = 101.3;       /* 原文: マイティストンプのダメージ101.3% */
  var STOMP_CHARGE_FRAMES = 90;    /* 原文: チャージ時間1.5秒に固定 */
  var STOMP_CHARGE_MULT = 2.5;     /* 原文: フルチャージダメージ250% */
  var BURST_ATKDMG_SECONDS = 10;   /* 原文: 10秒間持続 */

  /* E.pickTarget は README では (u, frame)、engine の実装は (u, enemies, frame)。 */
  function primaryTarget(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  function st(u) {
    if (!u.bunny) u.bunny = { mode: null, hold: 0, carrotUntil: -1, prevChargeFixed: 0 };
    return u.bunny;
  }

  /* モードを適用し、逆モードの味方にも同じモードを配る */
  function setMode(u, E, mode, frame) {
    var s = st(u);
    if (s.mode === mode) return;
    s.mode = mode;
    E.event({ frame: frame, kind: 'bunny-mode', side: u.side, unit: u.name, mode: mode });

    var allies = E.team(u) || [];
    for (var i = 0; i < allies.length; i++) {
      var a = allies[i];
      if (a === u || !a.alive) continue;
      var as = st(a);
      if (as.mode && as.mode !== mode) setMode(a, E, mode, frame);
    }
  }

  function cloneSkills(u) {
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (!src || !u.skillState) return;
    u.skills = JSON.parse(JSON.stringify(src));
    for (var s = 0; s < u.skillState.length; s++) {
      var sk = u.skillState[s];
      var arr = u.skills[sk.slot] && u.skills[sk.slot].blocks;
      if (!arr) continue;
      for (var b = 0; b < sk.blocks.length; b++) sk.blocks[b].block = arr[b];
    }
  }

  function expireBuff(u, key, stat, frame) {
    var bs = u.buffs || [];
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (b.key !== key) continue;
      if (stat && b.stat !== stat) continue;
      if (b.until > frame) b.until = frame;
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[227] = {
    init: function (u, E) {
      cloneSkills(u);
      /* バーストの武器変更・チャージダメージ1400%（永続で入ってしまう）・
       * 攻撃ダメージ77.35%（これも永続）を止めて、ここで配り直す。 */
      if (u.skills && u.skills.burst && u.skills.burst.blocks[0]) {
        u.skills.burst.blocks[0].trigger = { kind: 'disabled' };
      }
      var s = st(u);
      s.mode = 'stance';        /* 戦闘開始時：スタンス状態でなければスタンス */
      s.hold = 0;
      u.mighty = { shots: 0, burstFrame: -1 };
    },

    tick: function (u, E, frame) {
      var s = st(u);
      if (!s) return;

      /* マイティストンプ状態（1発）のあいだはモードを切り替えない。 */
      var stomping = !!(u.mighty && u.mighty.shots > 0);

      /* フルチャージ状態を1秒以上維持したか。
       * engine の射撃モデルでは「次弾までの残りフレームがチャージ所要以下」の間が
       * フルチャージ状態なので、その連続フレームを数える。 */
      if (!stomping && u.firing && u.firing.chargeFrames > 0) {
        var untilShot = u.firing.nextFrame - frame;
        if (untilShot > 0 && untilShot <= u.firing.chargeFrames) s.hold += 1;
        else s.hold = 0;
        if (s.hold >= E.FPS) {
          s.hold = 0;
          setMode(u, E, s.mode === 'stance' ? 'engage' : 'stance', frame);
        }
      } else {
        s.hold = 0;
      }

      /* スタンス時の常時効果（解除不可） */
      if (s.mode === 'stance') {
        E.buff(u, 'mighty-stance-atkdmg', 'atkDmgPct', STANCE_ATKDMG_PCT, 'up', frame + 2, { aura: true });
        E.buff(u, 'mighty-stance-chargedmg', 'chargeDmgPct', STANCE_CHARGEDMG_PCT, 'up', frame + 2, { aura: true });
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = st(u);
      var m = u.mighty;
      if (!s || !m) return;

      var t = primaryTarget(u, E, frame);
      if (!t || !t.alive) return;

      /* ---- マイティストンプの1発 */
      if (m.shots > 0) {
        m.shots = 0;
        var base = (u.char && u.char.stats && u.char.stats.weaponDamage) || 0;
        var diff = STOMP_DMG_PCT - base;
        if (diff > 0) {
          E.damage(u, t, frame, { multiplierPct: diff, chargeMult: STOMP_CHARGE_MULT });
        }
        /* 1発ぶんのチャージダメージを終了させる */
        expireBuff(u, 'mighty-stomp-chargedmg', 'chargeDmgPct', frame);
        E.event({ frame: frame, kind: 'mighty-stomp', side: u.side, unit: u.name });
        return;
      }

      /* ---- バニーモードの追加ダメージ（フルチャージ攻撃＝SRの通常攻撃） */
      if (u.weapon !== 'SR' && u.weapon !== 'RL') return;
      if (s.mode === 'engage') {
        E.damage(u, t, frame, { multiplierPct: ENGAGE_TRUEDMG_PCT, ignoreDef: true });
      } else if (s.mode === 'stance') {
        E.damage(u, t, frame, { multiplierPct: STANCE_EXTRA_PCT });
      }
    },

    onBurst: function (u, E, frame) {
      var m = u.mighty;
      if (!m) return;

      /* マイティストンプ：次の1発だけ武器が変わる */
      m.shots = 1;
      m.burstFrame = frame;
      /* チャージ時間1.5秒固定。次の射撃がそれより早いなら後ろへずらす。 */
      if (u.firing && u.firing.nextFrame < frame + STOMP_CHARGE_FRAMES) {
        u.firing.nextFrame = frame + STOMP_CHARGE_FRAMES;
      }

      /* 追加効果1：チャージダメージ1400%▲：1発間維持
       * 追加効果2：攻撃ダメージ77.35%▲：10秒間持続 */
      E.buff(u, 'mighty-stomp-chargedmg', 'chargeDmgPct',
        BURST_CHARGEDMG_PCT, 'up', frame + BURST_ATKDMG_SECONDS * E.FPS, {});
      E.buff(u, 'mighty-stomp-atkdmg', 'atkDmgPct',
        BURST_ATKDMG_PCT, 'up', frame + BURST_ATKDMG_SECONDS * E.FPS, {});
      E.event({ frame: frame, kind: 'mighty-burst', side: u.side, unit: u.name });
    }
  };
})();
