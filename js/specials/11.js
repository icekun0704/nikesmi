/* エミリア (id 11, RL, B3, 火力型)
 *
 * パーサで表現できなかった部分:
 *   - skill1「自分の最終最大装弾数1発当たりのチャージダメージ2.01%▲：1発間維持」。
 *     パーサは 2.01% を恒久バフとして置いてしまう。本来は
 *     「最終最大装弾数 × 2.01%」を次の1発ぶんだけ。
 *   - バースト「氷結の魔女」の チャージ速度300%▼ / チャージダメージ1300.53%▲。
 *     どちらも "1発間維持" なのにパーサは恒久で置くので、次の1発で解除する。
 *
 * 実装していないもの:
 *   - skill1 の「チャージ速度13.01%」（engine の射撃間隔は固定で、
 *     chargeSpeedPct を見る処理が無い）
 *   - skill2 の「自分が与えたダメージ量の58.99%分本体に固定ダメージ」
 *     （engine に固定ダメージを与える API が無い）
 */
(window.SPECIALS = window.SPECIALS || {})[11] = {
  init: function (u, E) {
    u.emilia = {
      s1Active: false,
      s1At: -1,
      iceActive: false,
      iceAt: -1
    };
  },

  tick: function (u, E, frame) {
    var s = u.emilia;
    if (!s) return;
    var base = u.side + u.pos + ':';

    /* パーサが恒久で置いた skill1 のチャージダメージ2.01%を外す（自前で管理する） */
    var k1 = base + 'skill1:0:stat:chargeDmgPct';
    for (var i = u.buffs.length - 1; i >= 0; i--) {
      if (u.buffs[i].key.indexOf(k1) === 0) u.buffs.splice(i, 1);
    }

    /* 1発ぶんの効果は、その1発を撃ち終わったら解除 */
    if (s.s1Active && u.shots > s.s1At) {
      s.s1Active = false;
      this._expire(u, 'emilia-s1', frame);
    }
    if (s.iceActive && u.shots > s.iceAt) {
      s.iceActive = false;
      this._expire(u, base + 'burst:0:stat:chargeDmgPct', frame);
      this._expire(u, base + 'burst:0:stat:chargeSpeedPct', frame);
      E.event({ frame: frame, kind: 'emilia-ice-end', side: u.side, unit: u.name });
    }
  },

  onShot: function (u, E, frame, shot) {
    var s = u.emilia;
    if (!s) return;
    /* RL の通常攻撃はすべてフルチャージ攻撃 */
    var mag = Math.round((u.char.stats && u.char.stats.magazine ? u.char.stats.magazine : 0) *
      (1 + E.sumStat(u, 'magazinePct') / 100) + E.sumStat(u, 'magazineFlat'));
    if (mag > 0) {
      E.buff(u, 'emilia-s1', 'chargeDmgPct', 2.01 * mag, 'up', Infinity, { label: '装弾数1発当たり' });
      s.s1Active = true;
      s.s1At = u.shots;
    }
  },

  onBurst: function (u, E, frame) {
    var s = u.emilia;
    if (!s) return;
    /* 氷結の魔女は次の1発ぶんだけ */
    s.iceActive = true;
    s.iceAt = u.shots;
    E.event({ frame: frame, kind: 'emilia-ice', side: u.side, unit: u.name });
  },

  /* 同じ key を持つバフをそのフレームで失効させる */
  _expire: function (u, key, frame) {
    for (var i = 0; i < u.buffs.length; i++) {
      if (u.buffs[i].key.indexOf(key) === 0) u.buffs[i].until = frame;
    }
  }
};
