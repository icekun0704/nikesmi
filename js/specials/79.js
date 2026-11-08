/* アスカ (id 79, AR, B3, 火力型)
 *
 * パーサで表現できなかった部分:
 *   - skill1「回復効果が適用された時、自分に 攻撃力96.98%▲：25秒間維持」。
 *     trigger=unknown なので一度も発動しない。HPが回復したことを見て発動させる。
 *   - skill2「フルバーストタイムが発動した時、自分がバリア適用状態なら自分に
 *     有利コードの攻撃ダメージ30.02%▲：10秒間維持」の「バリア適用状態」の判定。
 *     パーサは条件を見ずに必ず付けるので、シールドが無いときは外す。
 *
 * 実装していないもの:
 *   - 「バリアに与えるダメージ601.01%」（アリーナにバリアを持つ敵がいない／
 *     engine に barrierDmgPct を見る処理が無い）
 *   - 「コアダメージ60.07%」（アリーナにコアヒットが無い）
 *   - burst の「貫通特化」（数値の無い状態名で、engine に対応処理が無い）
 */
(window.SPECIALS = window.SPECIALS || {})[79] = {
  init: function (u, E) {
    u.asuka = {
      prevHp: u.hp,
      prevHpMax: u.hpMax,
      lastFb: -1
    };
  },

  tick: function (u, E, frame) {
    var s = u.asuka;
    if (!s) return;
    var base = u.side + u.pos + ':';

    /* ---- 回復効果が適用された時（HPの増加分から最大HPの増加分を差し引く） */
    var gained = (u.hp - s.prevHp) - (u.hpMax - s.prevHpMax);
    s.prevHp = u.hp;
    s.prevHpMax = u.hpMax;
    if (gained > 0) {
      var fresh = false;
      for (var i = 0; i < u.buffs.length; i++) {
        if (u.buffs[i].key === 'asuka-heal-atk' && u.buffs[i].until > frame) { fresh = true; break; }
      }
      E.buff(u, 'asuka-heal-atk', 'atkPct', 96.98, 'up', frame + 25 * E.FPS, { label: '回復時攻撃力' });
      if (!fresh) E.event({ frame: frame, kind: 'asuka-heal', side: u.side, unit: u.name });
    }

    /* ---- フルバースト発動時: バリア適用状態でなければ skill2 のバフを外す */
    var lb = u.team && u.team.lastBurst;
    if (lb && lb.stage === 'B3' && lb.frame === frame && frame !== s.lastFb) {
      s.lastFb = frame;
      if (u.shield <= 0) {
        var key = base + 'skill2:0:stat:elementDmgPct';
        u.buffs = u.buffs.filter(function (b) {
          return !(b.key.indexOf(key) === 0 && Math.abs(b.value - 30.02) < 0.001);
        });
        E.event({ frame: frame, kind: 'asuka-no-barrier', side: u.side, unit: u.name });
      }
    }
  },

  onShot: function () { /* 通常攻撃に固有処理なし */ },

  onBurst: function () { /* バースト効果はパーサが処理済み */ }
};
