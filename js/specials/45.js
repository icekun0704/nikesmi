/* ティア (id 45, RL, B1, 防御型)
 *
 * パーサで表現できなかった部分:
 *   - 遮蔽物のHPの増減（engine の coverStat は op 名だけで処理が無い）
 *       skill2「通常攻撃が5回命中した時」: 遮蔽物最大HP +最大HPの32.75%（5秒）
 *              → 最大HPと現HPを同量増やし、5秒後に元へ戻す
 *       burst「スキル発動者の最終最大HPの21.41%分 遮蔽物HP回復」
 *   - skill1「遮蔽物のHPを回復した時」の2ブロック（trigger=unknown で動かない）
 *       自分: バーストスキルクールタイム -13秒（2スタック・12秒）
 *       味方全体: 攻撃ダメージ +32.11%（10秒）
 *
 * 実装していないもの:
 *   - burst の「バースト再突入1段階」（バースト進行を触る API が無い）
 */
(window.SPECIALS = window.SPECIALS || {})[45] = {
  /* 遮蔽物のHP増減はここで実装している */
  suppressOps: { skill2: { 0: ['coverStat'], 1: ['coverStat'] } },
  init: function (u, E) {
    u.tia = {
      coverBuff: null,     /* { amount, until } */
      cdStacks: [],        /* 期限フレームの配列（最大2） */
      prevCover: u.coverHp,
      hitAnchor: 0,
      pendingCd: 0
    };
  },

  tick: function (u, E, frame) {
    var s = u.tia;
    if (!s) return;

    /* ---- skill2 の遮蔽物最大HPバフの期限切れ */
    if (s.coverBuff && frame >= s.coverBuff.until) {
      u.coverMax -= s.coverBuff.amount;
      if (u.coverHp > u.coverMax) u.coverHp = u.coverMax;
      s.coverBuff = null;
    }

    /* ---- skill1 のクールタイム短縮スタックの期限 */
    s.cdStacks = s.cdStacks.filter(function (f) { return f >= frame; });

    /* ---- バーストCT短縮は fireBurst が burstReadyAt を上書きした後に効かせる */
    if (s.pendingCd > 0) {
      u.burstReadyAt = Math.max(0, u.burstReadyAt - s.pendingCd);
      s.pendingCd = 0;
    }

    s.prevCover = u.coverHp;
  },

  onShot: function (u, E, frame, shot) {
    var s = u.tia;
    if (!s) return;

    /* skill2: 通常攻撃が5回命中するごとに遮蔽物最大HP +最大HPの32.75%（5秒） */
    var hits = u.counters.attackHits;
    if (hits - s.hitAnchor >= 5) {
      s.hitAnchor += 5;
      if (s.coverBuff) {
        s.coverBuff.until = frame + 5 * E.FPS;
      } else {
        var amount = u.hpMax * 0.3275;
        u.coverMax += amount;
        u.coverHp = Math.min(u.coverMax, u.coverHp + amount);
        s.coverBuff = { amount: amount, until: frame + 5 * E.FPS };
        E.event({ frame: frame, kind: 'tia-cover-up', side: u.side, unit: u.name, amount: amount });
      }
    }
  },

  onBurst: function (u, E, frame) {
    var s = u.tia;
    if (!s) return;

    /* burst: 遮蔽物HPを最終最大HPの21.41%回復 */
    var heal = Math.min(u.hpMax * 0.2141, u.coverMax - u.coverHp);
    if (heal > 0) {
      u.coverHp += heal;
      E.event({ frame: frame, kind: 'tia-cover-heal', side: u.side, unit: u.name, amount: heal });
      /* 遮蔽物のHPを回復した時（skill1）: CT -13秒（2スタックまで）と味方の攻撃ダメージ */
      if (s.cdStacks.length < 2) {
        s.pendingCd += 13 * E.FPS;   /* fireBurst の後で tick が適用する */
        s.cdStacks.push(frame + 12 * E.FPS);
      }
      var allies = E.alive(E.team(u));
      for (var i = 0; i < allies.length; i++) {
        E.buff(allies[i], 'tia-atkdmg', 'atkDmgPct', 32.11, 'up', frame + 10 * E.FPS, {});
      }
      E.event({ frame: frame, kind: 'tia-cover-trigger', side: u.side, unit: u.name });
    }
  }
};
