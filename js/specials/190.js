/* デルタ：ニンジャシーフ (id 190, MG, B2, 防御型)
 *
 * パーサで表現できなかった部分:
 *   - skill2 の分岐「味方に自分を除く防御型がいない場合 / いる場合」。
 *     パーサは両方のブロックを同時に発動させてしまうので、ここで片方を打ち消す。
 *       いない → ヘイト（敵全体を挑発：持続）
 *       いる   → 忍法注射器（状態フラグ。回復11.22%はパーサの lifesteal）
 *   - 忍法救急キット（4秒ごと、注射器状態のみ）
 *       4秒間「受けた回復」を蓄積し、終了時に味方全体へ蓄積量ぶん回復。
 *       最大蓄積量 = 最終攻撃力の165.28%（バーストで10秒間 +20.13%）。
 *   - バースト「自分がヘイト状態なら → 次のバリアのHP +20.13%：(10秒)」
 *     次のシールド増加に +20.13% を上乗せする。
 *
 * 実装していないもの:
 *   - 忍法カモフラージュ「単一攻撃対象から除外」。engine の pickTarget には
 *     割り込む口が無いため、状態フラグだけ立てて効果は付けていない。
 */
(window.SPECIALS = window.SPECIALS || {})[190] = {
  init: function (u, E) {
    u.deltaNinja = {
      branch: null,          /* 'hate' | 'syringe' */
      syringe: false,
      nextKit: 0,            /* 次の救急キット開始フレーム */
      kit: null,             /* { start, accum } */
      kitMaxUntil: -1,       /* 最大蓄積量 +20.13% の期限 */
      nextBarrierUntil: -1,  /* 次のバリア +20.13% の期限 */
      camoUntil: -1,         /* カモフラージュ（engine 側に効果なし） */
      prevShield: 0,
      prevHp: u.hp,
      prevHpMax: u.hpMax
    };
  },

  tick: function (u, E, frame) {
    var s = u.deltaNinja;
    if (!s) return;

    /* ---- 戦闘開始: 自分以外の防御型の有無で分岐する。
     * パーサは両ブロックを発動させているので、選ばれなかった側を打ち消す。 */
    if (frame === 0) {
      var otherDefender = false;
      var team0 = E.team(u);
      for (var i = 0; i < team0.length; i++) {
        if (team0[i] !== u && team0[i].char.classType === '防御型') { otherDefender = true; break; }
      }
      if (otherDefender) {
        s.branch = 'syringe';
        s.syringe = true;
        /* 「いない場合」のバリア（最終最大HPの12.25%）だけを取り消す。
         * 味方が付けたシールドは上書きされていない可能性があるので、
         * 自分の分と一致するときだけ消す。 */
        var own = u.hpMax * 0.1225;
        if (Math.abs(u.shield - own) <= own * 0.01) u.shield = 0;
      } else {
        s.branch = 'hate';
        u.tauntUntil = Infinity;   /* ヘイト: 敵全体を挑発（持続） */
        /* 「いる場合」の注射器（11.22%）だけを取り消す */
        if (Math.abs(u.lifestealPct - 11.22) < 0.01) u.lifestealPct = 0;
      }
      E.event({ frame: frame, kind: 'delta-branch', side: u.side, unit: u.name, branch: s.branch });
    }

    /* ---- 受けた回復の蓄積（救急キットの4秒間だけ）
     * HP の増加分から最大HPの増加分を差し引いて「回復」だけを取り出す。 */
    var gained = (u.hp - s.prevHp) - (u.hpMax - s.prevHpMax);
    if (gained > 0 && s.kit) s.kit.accum += gained;
    s.prevHp = u.hp;
    s.prevHpMax = u.hpMax;

    /* ---- 忍法救急キット: 4秒ごと */
    if (s.syringe) {
      if (!s.kit && frame >= s.nextKit) {
        s.kit = { start: frame, accum: 0 };
        s.nextKit = frame + 4 * E.FPS;
        E.event({ frame: frame, kind: 'delta-kit', side: u.side, unit: u.name });
      }
      if (s.kit && frame >= s.kit.start + 4 * E.FPS) {
        var bonus = frame <= s.kitMaxUntil ? 0.2013 : 0;
        var cap = E.atkEff(u) * 1.6528 * (1 + bonus);
        var amount = Math.min(s.kit.accum, cap);
        s.kit = null;
        if (amount > 0) {
          var allies = E.alive(E.team(u));
          for (var a = 0; a < allies.length; a++) E.heal(allies[a], amount, frame);
          E.event({ frame: frame, kind: 'delta-kit-heal', side: u.side, unit: u.name, amount: amount });
        }
        /* 自分が受け取った分を次のキットに二重で数えない */
        s.prevHp = u.hp;
        s.prevHpMax = u.hpMax;
      }
    }

    /* ---- 「次のバリアのHP +20.13%」: シールドが増えたときに上乗せする */
    if (u.shield > s.prevShield) {
      if (frame <= s.nextBarrierUntil) {
        u.shield += (u.shield - s.prevShield) * 0.2013;
        E.event({ frame: frame, kind: 'delta-barrier-up', side: u.side, unit: u.name });
      }
      s.prevShield = u.shield;
    } else {
      s.prevShield = u.shield;
    }
  },

  onShot: function () { /* 通常攻撃に固有処理なし */ },

  onBurst: function (u, E, frame) {
    var s = u.deltaNinja;
    if (!s) return;
    if (s.branch === 'hate') s.nextBarrierUntil = frame + 10 * E.FPS;   /* ヘイト状態 */
    if (s.syringe) s.kitMaxUntil = frame + 10 * E.FPS;                  /* 忍法注射器状態 */
  }
};
