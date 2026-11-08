/* ナユタ (id 163 / org 172)
 *
 * パーサが表現できていない部分だけを実装する。
 *  - 3秒ごとの記憶吸収スタック（最大30）と、適用時の味方バフ／自分回復
 *  - 記憶吸収スタック量別の3段階効果（2/10/30スタック）
 *  - 戦闘開始時の不動心：不屈9秒（戦闘中1回）
 *  - バーストの記憶燃焼（武器変更・チャージ1.8秒固定・弾数無限10秒）
 *  - 記憶燃焼中のフルチャージ攻撃：敵全体150%＋対象へ380.46%追加
 *
 * パーサ側が動かしているバーストの味方バフ／敵全体ダメージ／記憶吸収の命中率
 * バフは触らない。HP回復均等分配はエンジンに回復分配の仕組みが無いので実装しない。
 */
(function () {
  function pick(u, E, frame) {
    var es = E.alive(E.enemies(u));
    if (!es.length) return null;
    var taunt = es.filter(function (x) { return x.tauntUntil >= frame; });
    if (taunt.length) {
      taunt.sort(function (a, b) { return a.pos - b.pos; });
      return taunt[0];
    }
    var right = u.weapon === 'SR';
    es.sort(function (a, b) { return right ? b.pos - a.pos : a.pos - b.pos; });
    return es[0];
  }

  function absorbApplied(u, E, frame, st) {
    var team = E.team(u), i;

    // 記憶吸収が適用される時、味方全体に
    // ・コアダメージ25.15%▲：5秒間維持
    // ・スキル発動者基準で攻撃力30.16%▲：5秒間維持
    for (i = 0; i < team.length; i++) {
      var a = team[i];
      if (!a.alive) continue;
      E.buff(a, 'ny-core-' + a.pos, 'coreDmgPct', 25.15, 'up', frame + 5 * E.FPS);
      E.buff(a, 'ny-atk-' + a.pos, 'atkFlat',
        E.atkEff(u) * 0.3016, 'up', frame + 5 * E.FPS);
    }

    // 記憶吸収が適用される時、自分に 最終最大HPに比例して25%回復
    E.heal(u, u.hpMax * 0.25, frame);

    // 記憶吸収スタック量別の効果（下位効果のスタック適用）
    if (st.absorb >= 2 && !st.tier1) {
      st.tier1 = true;
      E.buff(u, 'ny-tier1', 'atkPct', 15.2, 'up', Infinity);
    }
    if (st.absorb >= 10 && !st.tier2) {
      st.tier2 = true;
      E.buff(u, 'ny-tier2', 'atkDmgPct', 20.27, 'up', Infinity);
    }
    if (st.absorb >= 30 && !st.tier3) {
      st.tier3 = true;
      E.buff(u, 'ny-tier3', 'coreDmgPct', 21.05, 'up', Infinity);
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[163] = {
    /* ナユタ：150%はここで実装 */
    suppress: { skill1: [3] },
    init: function (u, E) {
      u.nyState = {
        absorb: 0,
        nextAbsorb: 3 * E.FPS,
        tier1: false, tier2: false, tier3: false,
        burnUntil: -1,
        baseMagazine: Math.floor(Number(u.char.stats && u.char.stats.magazine) || 0)
      };
      // 不動心：不屈 9秒間維持（戦闘中1回）
      u.indomitableUntil = Math.max(u.indomitableUntil, 9 * E.FPS);
    },

    tick: function (u, E, frame) {
      var st = u.nyState;
      if (!st) return;

      // 3秒ごとに自分に 記憶吸収1スタック（最大30）
      if (frame >= st.nextAbsorb) {
        st.nextAbsorb += 3 * E.FPS;
        if (st.absorb < 30) {
          st.absorb += 1;
          absorbApplied(u, E, frame, st);
        }
      }

      // 記憶燃焼の終了
      if (st.burnUntil >= 0 && frame > st.burnUntil) {
        st.burnUntil = -1;
        delete u.chargeFixed;
        u.firing.magazine = st.baseMagazine;
        u.firing.shotsInMagazine = 0;
      }
    },

    onBurst: function (u, E, frame) {
      var st = u.nyState;
      if (!st) return;
      // 記憶燃焼：使用武器変更
      //   チャージ時間1.8秒固定 / 維持10秒 / 装弾数無限
      st.burnUntil = frame + 10 * E.FPS;
      u.chargeFixed = Math.round(1.8 * E.FPS);
      u.firing.magazine = Infinity;
      u.firing.shotsInMagazine = 0;
    },

    onShot: function (u, E, frame, shot) {
      var st = u.nyState;
      if (!st || st.burnUntil < frame) return;

      var target = pick(u, E, frame);

      // 通常ダメージ：最終攻撃力の275.18%（フルチャージ250%）
      // 通常射撃が既に武器ダメージ分（8.73%）を与えているので差分だけ足す。
      var weaponMult = (u.char.stats && u.char.stats.weaponDamage) || 0;
      var chargeMult = ((u.char.stats && u.char.stats.maxCharge) || 250) / 100;
      var extra = 275.18 - weaponMult / chargeMult;
      if (target && target.alive) {
        E.damage(u, target, frame, { multiplierPct: extra, chargeMult: chargeMult });
      }

      // フルチャージして攻撃した時、自分が記憶燃焼状態なら、敵全体に
      // ・最終攻撃力の150%のダメージ
      var es = E.alive(E.enemies(u));
      for (var i = 0; i < es.length; i++) {
        E.damage(u, es[i], frame, { multiplierPct: 150 });
      }
      // 対象がターゲットなら、同じ敵に 380.46% の追加ダメージ
      if (target && target.alive) {
        E.damage(u, target, frame, { multiplierPct: 380.46 });
      }
    }
  };
})();
