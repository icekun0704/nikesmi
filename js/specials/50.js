/* パワー (id 50, RL, B3, 火力型)
 *
 * パーサで表現できなかった部分:
 *   - 血の魔人（フルチャージ攻撃ごとに 攻撃力6.4%▲・5スタック・3秒）そのもの
 *     （パーサのブロックは trigger=unknown）
 *   - skill2「18回攻撃した時、血の魔人がフルスタックなら爆発範囲38.61%▲10秒 +
 *     弾丸チャージ100%（戦闘中1回）」。パーサは条件を無視して爆発範囲を毎回付与し、
 *     弾丸チャージは engine 側に処理が無いので、ブロックを空にして自前で処理する。
 *   - バースト「血の魔人がフルスタックなら同じ敵に1584%の追加ダメージ」。
 *     パーサは無条件に敵全体へ与えてしまうので、その効果を外して自前で与える。
 *
 * 弾丸チャージ100% の扱い: 次弾を即座に装填したとみなし、射撃を1フレーム後に前倒しする。
 */
function powerBloodStacks(u) {
  for (var i = 0; i < u.buffs.length; i++) {
    if (u.buffs[i].key === 'power-blood') return u.buffs[i].stacks || 1;
  }
  return 0;
}

(window.SPECIALS = window.SPECIALS || {})[50] = {
  /* 血の魔人フルスタック時の1584%はここで実装している（パーサ側は条件を見ない） */
  suppress: { burst: [1] },
  init: function (u, E) {
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (src) {
      u.skills = JSON.parse(JSON.stringify(src));
      for (var s = 0; s < u.skillState.length; s++) {
        var st = u.skillState[s];
        var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
        if (!arr) continue;
        for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
      }
      if (u.skills.skill2 && u.skills.skill2.blocks[0]) u.skills.skill2.blocks[0].effects = [];
      if (u.skills.burst && u.skills.burst.blocks[1]) u.skills.burst.blocks[1].effects = [];
    }
    u.power = { charged: false };
  },

  tick: function (u, E, frame) {
    /* 血の魔人のスタックは3秒で消える（buff の期限に任せる） */
  },

  onShot: function (u, E, frame, shot) {
    var p = u.power;
    if (!p) return;

    /* フルチャージ攻撃（RL は毎射撃）→ 血の魔人 1スタック（最大5、3秒） */
    E.buff(u, 'power-blood', 'atkPct', 6.4, 'up', frame + 3 * E.FPS, { maxStacks: 5 });

    /* 通常攻撃18回ごと、フルスタックなら 爆発範囲38.61%▲10秒 + 弾丸チャージ100%（1回） */
    var shots = u.counters.attackShots;
    if (shots > 0 && shots % 18 === 0 && powerBloodStacks(u) >= 5) {
      E.buff(u, 'power-range', 'explosionRangePct', 38.61, 'up', frame + 10 * E.FPS, {});
      if (!p.charged) {
        p.charged = true;
        u.firing.nextFrame = frame + 1;
        E.event({ frame: frame, kind: 'power-bulletcharge', side: u.side, unit: u.name });
      }
    }
  },

  onBurst: function (u, E, frame) {
    if (!u.power) return;
    /* 血の魔人フルスタックなら、同じ敵（攻撃力が最も高い敵1機）に1584%の追加ダメージ */
    if (powerBloodStacks(u) < 5) return;
    var foes = E.alive(E.enemies(u));
    if (!foes.length) return;
    foes.sort(function (a, b) { return E.atkEff(b) - E.atkEff(a); });
    E.damage(u, foes[0], frame, { multiplierPct: 1584, ignoreDef: false });
    E.event({ frame: frame, kind: 'power-fullstack-burst', side: u.side, unit: u.name });
  }
};
