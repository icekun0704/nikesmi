/* エレグ：ブーム・アンド・ショック (id 188, MG, B3)
 *
 * パーサで表現できなかった部分:
 *   - 幽霊キャプチャー（スタック）そのもの
 *     · 戦闘開始時、ランダムな敵1機に憑依（6秒）。味方全体の累計100ヒットで1スタック（最大13）
 *     · 憑依は6秒ごとに再発動する
 *   - スタック別の水冷コード味方全体への効果
 *     · 1以上: スキル発動者基準で攻撃力16.2%▲（発動者の攻撃力×16.2%を平坦値で付与）
 *     · 4以上: 有利コードの攻撃ダメージ35%▲（elementDmgPct）
 *   - 最大スタック（13）で幽霊キャプチャーが発動した時、敵全体へ1100%
 *   - バーストの「800%×6回（スタック13なら13回）」とスタック消費（6▼・最低1 / 9▼）
 *     パーサは6回/13回の区別も回数も表現できず、しかも両ブロックを毎回発動させて
 *     しまうため、このユニット専用にスキル定義を複製してバーストのダメージ効果を外し、
 *     ここで撃ち直す。
 */
(window.SPECIALS = window.SPECIALS || {})[188] = {
  init: function (u, E) {
    /* スキル定義をこのユニット専用に複製（SKILL_DB は共有なので書き換えない） */
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (src) {
      u.skills = JSON.parse(JSON.stringify(src));
      for (var s = 0; s < u.skillState.length; s++) {
        var st = u.skillState[s];
        var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
        if (!arr) continue;
        for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
      }
      if (u.skills.burst) {
        for (var i = 0; i < u.skills.burst.blocks.length; i++) {
          u.skills.burst.blocks[i].effects = [];
        }
      }
    }
    u.elegg = {
      count: 0,            // 幽霊キャプチャー数
      possessUntil: 0,
      nextPossess: 0,
      lastTotalHits: 0,
      pickIndex: 0,
      burstIndex: 0
    };
  },

  tick: function (u, E, frame) {
    var g = u.elegg;
    if (!g) return;

    /* ---- 憑依（6秒ごとに再発動、対象はランダムな敵1機） */
    if (frame >= g.nextPossess) {
      var foes = E.alive(E.enemies(u));
      g.nextPossess = frame + 6 * E.FPS;
      g.possessUntil = frame + 6 * E.FPS;
      if (foes.length) {
        var t = foes[g.pickIndex % foes.length];
        g.pickIndex += 1;
        g.possess = t;
        E.event({ frame: frame, kind: 'elegg-possess', side: u.side, unit: u.name, target: t.name });
      }
    }

    /* ---- 味方全体の累計命中回数100回ごとに幽霊キャプチャー +1（最大13） */
    var total = 0, team = E.team(u);
    for (var i = 0; i < team.length; i++) total += team[i].counters.attackHits;
    if (total - g.lastTotalHits >= 100) {
      g.lastTotalHits += 100 * Math.floor((total - g.lastTotalHits) / 100);
      if (g.count >= 13) {
        /* 最大スタックの状態で幽霊キャプチャー発動 → 敵全体へ1100% */
        var es = E.alive(E.enemies(u));
        for (var k = 0; k < es.length; k++) {
          E.damage(u, es[k], frame, { multiplierPct: 1100 });
        }
        E.event({ frame: frame, kind: 'elegg-max-capture', side: u.side, unit: u.name });
      } else {
        g.count += 1;
        E.event({ frame: frame, kind: 'elegg-capture', side: u.side, unit: u.name, count: g.count });
      }
    }

    /* ---- スタック数別の効果（水冷コードの味方全体） */
    if (g.count >= 1) {
      var flat = E.atkEff(u) * 0.162;   // スキル発動者基準
      var allies = E.alive(E.team(u));
      for (var a = 0; a < allies.length; a++) {
        var m = allies[a];
        if (m.element !== '水冷') continue;
        E.buff(m, 'elegg-atk', 'atkFlat', flat, 'up', frame + 2, {});
        if (g.count >= 4) {
          E.buff(m, 'elegg-elem', 'elementDmgPct', 35, 'up', frame + 2, {});
        }
      }
    }
  },

  onBurst: function (u, E, frame) {
    var g = u.elegg;
    if (!g) return;
    var hits, consume;
    if (g.count >= 13) {
      hits = 13; consume = 9;          // 幽霊キャプチャー数9▼
    } else {
      hits = 6; consume = 6;           // 幽霊キャプチャー数6▼（最低1を維持）
    }
    g.burstIndex = 0;
    for (var i = 0; i < hits; i++) {
      var foes = E.alive(E.enemies(u));
      if (!foes.length) break;
      var t = foes[(g.burstIndex + i) % foes.length];
      E.damage(u, t, frame, { multiplierPct: 800, isBurst: true });
    }
    g.burstIndex += hits;
    g.count = g.count >= 13 ? g.count - consume : Math.max(1, g.count - consume);
    E.event({ frame: frame, kind: 'elegg-consume', side: u.side, unit: u.name, count: g.count, hits: hits });
  }
};
