/* ミランダ（宝物） (id 146, SMG, B1, 支援型)
 *
 * パーサで表現できなかった部分:
 *   - burst の対象指定「自分を除く攻撃力が最も高い味方1機 → 2機
 *     （対象が足りない場合、自分も対象となる）」。
 *     パーサは「自分」に撃ってしまうので、正しい対象へ付け直す。
 *       → 攻撃力40.4% / クリティカルダメージ56.23%（10秒）
 *   - skill2（宝物）「フルバーストタイムが発動した時、自分を除く攻撃力が最も高い
 *     味方1機に（対象が足りない場合、自分も対象となる）
 *     クリティカル確率85.42%▲：1発間維持」。
 *     パーサは trigger=unknown で発動しない。
 *
 * 宝物1/2/3 の行はこの形態（treasure=true）にのみ付くので、そのまま実装している。
 */
(window.SPECIALS = window.SPECIALS || {})[146] = {
  init: function (u, E) {
    u.miranda = {
      burstFrame: -1,
      burstTargets: null,
      critShot: null,     /* { target, shotsAt } */
      lastFb: -1
    };
  },

  /* 自分を除く味方を攻撃力の高い順に。足りなければ自分を足す。 */
  _pickTop: function (u, E, n) {
    var mates = E.alive(E.team(u)).filter(function (m) { return m !== u; });
    mates.sort(function (a, b) { return E.atkEff(b) - E.atkEff(a); });
    var out = mates.slice(0, n);
    if (out.length < n) out.push(u);
    return out;
  },

  tick: function (u, E, frame) {
    var s = u.miranda;
    if (!s) return;
    var base = u.side + u.pos + ':';

    /* ---- バーストの付け直し（パーサが「自分」に置いた分をいったん外す） */
    if (s.burstFrame === frame && s.burstTargets) {
      var selfIncluded = s.burstTargets.indexOf(u) >= 0;
      if (!selfIncluded) {
        var ka = base + 'burst:0:stat:atkPct';
        var kc = base + 'burst:0:stat:critDmgPct';
        u.buffs = u.buffs.filter(function (b) {
          return b.key.indexOf(ka) !== 0 && b.key.indexOf(kc) !== 0;
        });
      }
      s.burstFrame = -1;
      s.burstTargets = null;
    }

    /* ---- フルバースト発動時（バースト3段階突入）の宝物 skill2 */
    var lb = u.team && u.team.lastBurst;
    if (lb && lb.stage === 'B3' && lb.frame === frame && frame !== s.lastFb) {
      s.lastFb = frame;
      var t = this._pickTop(u, E, 1)[0];
      if (t) {
        E.buff(t, 'miranda-crit', 'critRate', 85.42, 'up', Infinity, { label: '宝物skill2' });
        s.critShot = { target: t, shotsAt: t.shots };
        E.event({ frame: frame, kind: 'miranda-crit', side: u.side, unit: u.name, target: t.name });
      }
    }

    /* ---- 「1発間維持」: 対象が1発撃ったら解除 */
    if (s.critShot) {
      var target = s.critShot.target;
      if (!target.alive || target.shots > s.critShot.shotsAt) {
        for (var i = 0; i < target.buffs.length; i++) {
          if (target.buffs[i].key === 'miranda-crit') target.buffs[i].until = frame;
        }
        s.critShot = null;
      }
    }
  },

  onShot: function () { /* 通常攻撃に固有処理なし */ },

  onBurst: function (u, E, frame) {
    var s = u.miranda;
    if (!s) return;
    /* 自分を除く攻撃力上位2機（足りなければ自分） */
    var targets = this._pickTop(u, E, 2);
    s.burstFrame = frame;
    s.burstTargets = targets;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      /* 自分はパーサが既に同じ値・同じ時間で付けているので二重にしない */
      if (t === u) continue;
      E.buff(t, 'miranda-burst-atk', 'atkPct', 40.4, 'up', frame + 10 * E.FPS, { label: '宝物burst' });
      E.buff(t, 'miranda-burst-critdmg', 'critDmgPct', 56.23, 'up', frame + 10 * E.FPS, {});
    }
  }
};
