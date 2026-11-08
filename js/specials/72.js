/* ソリン：フロストチケット (id 72 / org 175)
 *
 * パーサが表現できていない部分だけを実装する。
 *  - 乗車券（戦闘開始時とバーストスキル使用時に1枚、最大2枚）
 *  - 乗車券1枚につき最大HPのみ10%（スキル発動者基準）を味方全体へ
 *  - HPが15%以下になった味方（乗車券所持）に最終最大HP12.27%回復＋乗車券1枚▼
 *  - 早期割引（戦闘開始から6秒間、このスキルによる乗車券減少を無効）
 *
 * 「バーストスキル使用時」は味方の誰かがバーストスキルを使った時に解釈した。
 * バーストCT7.48秒▼はパーサ（burstCd）が動かしているので触らない。
 */
(function () {
  function setBonus(target, key, stat, value) {
    for (var i = 0; i < target.buffs.length; i++) {
      var b = target.buffs[i];
      if (b.key === key && b.stat === stat) {
        b.value = value; b.dir = 'up'; b.until = Infinity; b.refreshed = target.now;
        return;
      }
    }
    target.buffs.push({
      key: key, stat: stat, value: value, dir: 'up', until: Infinity,
      stacks: 1, maxStacks: 1, aura: false, refreshed: target.now, label: key
    });
  }

  function applyTickets(u, E) {
    var st = u.fcState;
    if (!st) return;
    for (var i = 0; i < st.tickets.length; i++) {
      var t = st.tickets[i];
      // 乗車券の効果：スキル発動者基準で最大HPのみ10%×乗車券の枚数▲
      var v = u.hpMax * 0.10 * t.count;
      setBonus(t.unit, 'fc-ticket-' + t.unit.pos, 'hpFlat', v);
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[72] = {
    init: function (u, E) {
      u.fcState = {
        tickets: [],
        earlyUntil: 6 * E.FPS,   // 早期割引：6秒間維持
        lastBurstSum: 0,
        lastHp: []
      };
      var team = E.team(u);
      for (var i = 0; i < team.length; i++) {
        // 戦闘開始時：乗車券1枚発券（最大2枚まで）
        u.fcState.tickets.push({ unit: team[i], count: 1 });
        u.fcState.lastHp.push(team[i].hp / team[i].hpMax);
      }
      applyTickets(u, E);
    },

    tick: function (u, E, frame) {
      var st = u.fcState;
      if (!st) return;

      // バーストスキル使用時：乗車券1枚発券（最大2枚まで）
      var sum = 0, i;
      for (i = 0; i < st.tickets.length; i++) sum += st.tickets[i].unit.bursts || 0;
      if (sum > st.lastBurstSum) {
        st.lastBurstSum = sum;
        for (i = 0; i < st.tickets.length; i++) {
          if (st.tickets[i].count < 2) st.tickets[i].count += 1;
        }
      }

      // 自分を含む味方の誰かのHPが15%以下になった時
      for (i = 0; i < st.tickets.length; i++) {
        var t = st.tickets[i], a = t.unit;
        if (!a.alive) { continue; }
        var ratio = a.hp / a.hpMax;
        var prev = st.lastHp[i];
        if (ratio <= 0.15 && prev > 0.15 && t.count > 0) {
          // 対象が乗車券を所持している状態なら対象に
          // ・スキル発動者の最終最大HPの12.27%回復
          E.heal(a, u.hpMax * 0.1227, frame);
          // ・乗車券1枚▼（早期割引中は減少しない）
          if (frame >= st.earlyUntil) t.count -= 1;
        }
        st.lastHp[i] = a.hp / a.hpMax;
      }

      applyTickets(u, E);
    }
  };
})();
