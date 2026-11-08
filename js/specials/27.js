/* ミカ：スノーバディ (id 27, SMG, B1, 支援型)
 *
 * パーサで表現できなかった部分:
 *   - skill1「自分が整理整頓のフルスタック状態なら、味方全体に 最大装弾数40%▲：持続」。
 *     パーサは trigger=unknown で一度も発動しない。
 *     整理整頓はパーサが 15秒・最大10スタックで管理しているので、
 *     そのスタック数を見てフルスタックのあいだ常時オーラとして付与する。
 *   - skill2「通常攻撃が150回命中した時、味方全体に
 *     スタック可能バフ効果のスタック量1個▲」。
 *     パーサの stackBoost は op 名だけで engine に処理が無い。
 *     スタック可能なバフ（maxStacks > 1）のスタックを1増やす。
 */
(window.SPECIALS = window.SPECIALS || {})[27] = {
  init: function (u, E) {
    u.mika = { hitAnchor: 0, full: false };
  },

  _organizeStacks: function (u) {
    for (var i = 0; i < u.buffs.length; i++) {
      var b = u.buffs[i];
      if (b.stat === 'takenDmgPct' && b.dir === 'down' && b.stacks >= 10) return b.stacks;
    }
    return 0;
  },

  tick: function (u, E, frame) {
    var s = u.mika;
    if (!s) return;

    /* 整理整頓フルスタック → 味方全体に最大装弾数 +40%（オーラ） */
    var stacks = this._organizeStacks(u);
    if (stacks >= 10) {
      if (!s.full) {
        s.full = true;
        E.event({ frame: frame, kind: 'mika-org-full', side: u.side, unit: u.name });
      }
      var allies = E.alive(E.team(u));
      for (var i = 0; i < allies.length; i++) {
        E.buff(allies[i], 'mika-magazine', 'magazinePct', 40, 'up', frame + 2, { aura: true });
      }
    } else {
      s.full = false;
    }
  },

  onShot: function (u, E, frame, shot) {
    var s = u.mika;
    if (!s) return;
    /* skill2: 通常会攻撃が150回命中するごと */
    var hits = u.counters.attackHits;
    while (hits - s.hitAnchor >= 150) {
      s.hitAnchor += 150;
      var allies = E.alive(E.team(u));
      for (var i = 0; i < allies.length; i++) {
        var list = allies[i].buffs;
        for (var b = 0; b < list.length; b++) {
          if (list[b].maxStacks > 1) {
            list[b].maxStacks += 1;
            list[b].stacks = Math.min(list[b].maxStacks, (list[b].stacks || 1) + 1);
          }
        }
      }
      E.event({ frame: frame, kind: 'mika-stack-boost', side: u.side, unit: u.name });
    }
  },

  onBurst: function () { /* バースト効果はパーサが処理済み */ }
};
