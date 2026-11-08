/* グレイブ (id 36, AR, B2, 支援型)
 *
 * パーサで表現できなかった部分:
 *   - 完全計算（バーストで10秒）: 装弾数無限 / HP 1%▼を1秒ごと
 *     （装弾数無限・貫通特化 はパーサが op 名だけ作って engine 側に処理が無い）
 *   - 完全計算終了時: 残弾数100%減少 + リロード比率50%▼ で「放熱」状態に入る
 *   - 放熱中: 自分の回復 最終最大HP2%/秒、味方全体にバーストゲージ38.96%▲・貫通48.4%▲
 *     （ブロックの trigger が unknown なのでパーサからは発動しない）
 *   - 放熱の解除条件 = 最大装弾リロード完了
 *   - 過熱I（15ヒットごと、atk+15.48%。最大装弾リロード完了で解除）
 *     過熱II（30ヒット、完全計算かつ過熱I のとき atk+20.66%）
 *     過熱III（60ヒット、完全計算かつ過熱II のとき atkDmg+30.8%）
 *
 * 実装していないもの:
 *   - 貫通特化（engine は貫通で追加の敵を撃つ処理を持たない）
 */
(window.SPECIALS = window.SPECIALS || {})[36] = {
  init: function (u, E) {
    var m = u.firing;
    u.grave = {
      calcUntil: -1,        // 完全計算の終了フレーム
      heat: false,          // 放熱中か
      drainNext: -1,
      healNext: -1,
      oh1: false, oh2: false, oh3: false,
      baseMagazine: m.magazine,
      baseReload: m.reloadFrames,
      magInfinite: false
    };
  },

  tick: function (u, E, frame) {
    var g = u.grave;
    if (!g) return;
    var m = u.firing;

    /* ---- 完全計算が終了 → 放熱へ */
    if (g.calcUntil >= 0 && frame > g.calcUntil) {
      g.calcUntil = -1;
      if (g.magInfinite) { m.magazine = g.baseMagazine; g.magInfinite = false; }

      /* 残弾数100%減少 + リロード比率50%▼（リロード時間が2倍）での強制リロード。
       * 放熱はこのリロードが完了するまで続く。 */
      g.heat = true;
      m.reloadFrames = g.baseReload * 2;
      m.shotsInMagazine = 0;
      m.nextFrame = frame + m.reloadFrames;
      m.reloadingUntil = m.nextFrame;
      g.healNext = frame;
      E.event({ frame: frame, kind: 'grave-heat', side: u.side, unit: u.name });
    }

    /* ---- 放熱中: 毎フレーム味方全体へ（持続効果） */
    if (g.heat) {
      var allies = E.alive(E.team(u));
      for (var i = 0; i < allies.length; i++) {
        var a = allies[i];
        E.buff(a, 'grave-gauge', 'burstGaugePct', 38.96, 'up', frame + 2, {});
        E.buff(a, 'grave-pierce', 'pierceDmgPct', 48.4, 'up', frame + 2, {});
      }
      if (frame >= g.healNext) {
        E.heal(u, u.hpMax * 0.02, frame);
        g.healNext = frame + 60;
      }
      /* 解除条件: 最大装弾リロード完了 */
      if (m.reloadingUntil === frame) {
        g.heat = false;
        m.reloadFrames = g.baseReload;
        /* 過熱I は最大装弾リロード完了で解除（パーサは恒久バフとして置いているので外す） */
        var key = u.side + u.pos + ':undefined:0:stat:atkPct';
        u.buffs = u.buffs.filter(function (b) { return b.key.indexOf(key) !== 0; });
        g.oh1 = false;
        E.event({ frame: frame, kind: 'grave-heat-end', side: u.side, unit: u.name });
      }
    }

    /* ---- 完全計算中: 現在HPの1%を1秒ごとに失う（10秒） */
    if (g.calcUntil >= 0 && frame >= g.drainNext) {
      u.hp = Math.max(1, u.hp - u.hpMax * 0.01);
      g.drainNext = frame + 60;
    }
  },

  onShot: function (u, E, frame, shot) {
    var g = u.grave;
    if (!g) return;
    var hits = u.counters.attackHits;

    /* 過熱I: 通常攻撃が15回命中するごと（パーサが atk+15.48 を恒久で置いているので
     * ここでは状態フラグだけ管理する） */
    if (hits > 0 && hits % 15 === 0) g.oh1 = true;

    /* 完全計算中の攻撃命中回数別の効果 */
    if (g.calcUntil >= frame) {
      if (hits >= 30 && g.oh1 && !g.oh2) {
        g.oh2 = true;
        E.buff(u, 'grave-oh2', 'atkPct', 20.66, 'up', Infinity, {});
        E.event({ frame: frame, kind: 'grave-oh2', side: u.side, unit: u.name });
      }
      if (hits >= 60 && g.oh2 && !g.oh3) {
        g.oh3 = true;
        E.buff(u, 'grave-oh3', 'atkDmgPct', 30.8, 'up', Infinity, {});
        E.event({ frame: frame, kind: 'grave-oh3', side: u.side, unit: u.name });
      }
    }
  },

  onBurst: function (u, E, frame) {
    var g = u.grave;
    if (!g) return;
    /* 完全計算: 10秒間。装弾数無限は engine 側の magazine で表現する。 */
    g.calcUntil = frame + 10 * E.FPS;
    g.drainNext = frame + 60;
    if (!g.magInfinite) { u.firing.magazine = Infinity; g.magInfinite = true; }
    E.event({ frame: frame, kind: 'grave-calc', side: u.side, unit: u.name });
  }
};
