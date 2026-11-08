/* キロ (id 180, MG, B3, 防御型)
 *
 * 「ナノコーティング」= 自分に張られているバリア（engine では u.shield）で判定する。
 *
 * パーサで表現できなかった部分:
 *   - バースト: ナノコーティング状態なら敵全体へ
 *     「最終最大HPの5%を攻撃力として換算した1150.84%」のダメージ
 *     （攻撃力の代わりに最大HPの5%を使うので、攻撃力との比で倍率を換算する）
 *   - バースト: ナノコーティング状態でなければ最大HP48%▲（20秒）※ trigger=unknown
 *   - バースト: ナノコーティング状態でなければ「次のバリアのHP +17.75 / +26.66 / +35.53%」
 *     （使用回数別。バリアは skill1 のバースト時バリアに上乗せする）
 *   - 通常攻撃200回ごと、ナノコーティング状態ならバリアHPを最終最大HPの2.85%回復
 *
 * パーサが既に動かしているもの（触らない）:
 *   - 戦闘開始時 / バースト時のバリア 21.12%
 */
(window.SPECIALS = window.SPECIALS || {})[180] = {
  init: function (u, E) {
    u.kilo = {
      uses: 0,            // 「使用回数別」のカウント（ナノコーティングなしでバーストした回数）
      nextBarrier: 0,     // 次のバリアに上乗せする%（最大HP比）
      barrierPct: 21.12,  // 現在のバリアの上限（最大HP比）
      lastHitCount: 0
    };
  },

  tick: function (u, E, frame) {
    var k = u.kilo;
    if (!k) return;
    /* バーストで「次のバリアのHP +n%」が指定されていて、そのバリアが張られたら上乗せする。
     * バリアは skill1 のバースト効果（パーサ）が同フレームのうちに張る。 */
    if (k.nextBarrier > 0 && u.shield > 0) {
      u.shield += u.hpMax * k.nextBarrier / 100;
      k.barrierPct += k.nextBarrier;
      E.event({ frame: frame, kind: 'nano-barrier-boost', side: u.side, unit: u.name,
                pct: k.nextBarrier });
      k.nextBarrier = 0;
    }
  },

  onShot: function (u, E, frame, shot) {
    var k = u.kilo;
    if (!k) return;
    /* 通常攻撃で200回攻撃した時、ナノコーティング状態なら
     * スキル発動者の最終最大HPに比例してバリアHP回復2.85% */
    var hits = u.counters.attackHits;
    if (hits >= k.lastHitCount + 200) {
      k.lastHitCount = hits - (hits % 200);
      var cap = u.hpMax * k.barrierPct / 100;
      if (u.shield > 0 && u.shield < cap) {
        u.shield = Math.min(cap, u.shield + u.hpMax * 0.0285);
        E.event({ frame: frame, kind: 'nano-barrier-heal', side: u.side, unit: u.name });
      }
    }
  },

  onBurst: function (u, E, frame) {
    var k = u.kilo;
    if (!k) return;
    /* バースト発動時点のナノコーティング状態で分岐する。
     * （skill1 のバースト時バリアはこのあとパーサが張るので、ここでは見ない） */
    var coated = u.shield > 0;

    if (coated) {
      /* 最終最大HPの5%を攻撃力として換算した1150.84%のダメージ（敵全体） */
      var atk = E.atkEff(u);
      var ratio = atk > 0 ? (u.hpMax * 0.05) / atk : 0;
      var foes = E.alive(E.enemies(u));
      for (var i = 0; i < foes.length; i++) {
        E.damage(u, foes[i], frame, { multiplierPct: 1150.84 * ratio, isBurst: true });
      }
      E.event({ frame: frame, kind: 'nano-burst', side: u.side, unit: u.name, targets: foes.length });
    } else {
      /* 最大HP48%▲：20秒間維持 */
      E.buff(u, 'kilo-hp', 'maxHpPct', 48, 'up', frame + 20 * E.FPS, {});

      /* 使用回数別: 1回 17.75 / 2回 26.66 / 3回 35.53（4回目以降は3回目と同じ段階） */
      k.uses += 1;
      var steps = [17.75, 26.66, 35.53];
      k.nextBarrier = steps[Math.min(steps.length, k.uses) - 1];
    }
  }
};
