/* フローラ (id 177, MG, B2, 支援型, 電撃) — 宝物なし
 *
 * パーサで表現できなかった部分:
 *   - skill1「自分と自分の両隣にいる味方2機」への 心の平和
 *     （1秒ごとに スキル発動者の最終最大HPの1%回復、受けるHP回復量4%▲×5スタック）
 *     パーサは対象を「posの若い2機」にしてしまい、回復も1回だけ・intervalを無視するため、
 *     このブロックの効果を空にして自前で回す。
 *   - skill2「自分の両隣のうち1機がHP90%以下になった時」→ 味方全体にバリア10.22%（10秒）
 *   - skill2「自分の両隣のうち1機のHPが最大になった時」→ 味方全体に
 *     防御力無視ダメージ30.97%▲（5秒）
 *     （どちらも trigger=unknown なのでパーサからは発動しない）
 *
 * 実装していないもの:
 *   - skill1「スタック可能バフ効果のスタック量1個▲」: engine にスタック数を
 *     一律に増やす仕組みが無い。
 *   - 宝物（Treasure1/2/3）専用行はこの形態には付かない。
 */
(window.SPECIALS = window.SPECIALS || {})[177] = {
  /* 回復量バフはここで実装している */
  suppress: { skill1: [0] },
  init: function (u, E) {
    /* スキル定義をこのユニット専用に複製し、誤って解釈されている battleStart ブロックを空にする */
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (src) {
      u.skills = JSON.parse(JSON.stringify(src));
      for (var s = 0; s < u.skillState.length; s++) {
        var st = u.skillState[s];
        var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
        if (!arr) continue;
        for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
      }
      if (u.skills.skill1 && u.skills.skill1.blocks[0]) {
        u.skills.skill1.blocks[0].effects = [];
      }
    }

    var team = E.team(u);
    var members = [u];
    if (team[u.pos - 1]) members.push(team[u.pos - 1]);
    if (team[u.pos + 1]) members.push(team[u.pos + 1]);

    u.flora = {
      members: members,        // 心の平和の対象（自分＋両隣）
      healNext: 0,
      neighborLow: false,      // 両隣のHP90%以下の判定の前回値
      neighborFull: true,
      shield: null
    };
  },

  tick: function (u, E, frame) {
    var f = u.flora;
    if (!f) return;

    /* ---- 心の平和: 1秒ごとに最終最大HPの1%回復 + 被回復量4%×5スタック */
    if (frame >= f.healNext) {
      f.healNext = frame + 60;
      for (var i = 0; i < f.members.length; i++) {
        var m = f.members[i];
        if (!m.alive) continue;
        E.heal(m, u.hpMax * 0.01, frame);
        var b = E.buff(m, 'flora-peace:' + u.pos + ':' + m.pos, 'recoveryTakenPct',
          4, 'up', frame + 2, { maxStacks: 5 });
        if (b && (b.stacks || 1) < 5) b.stacks = 5;   // 「5スタック」
      }
    }

    /* ---- バリア（10秒）の期限切れ */
    if (f.shield && frame >= f.shield.until) {
      var list = E.alive(E.team(u));
      for (var k = 0; k < list.length; k++) {
        var a = list[k];
        var amt = f.shield.per[a.pos] || 0;
        if (amt > 0 && a.shield > 0) a.shield = Math.max(0, a.shield - amt);
      }
      f.shield = null;
    }

    /* ---- 両隣の状態監視 */
    var team = E.team(u);
    var nLow = false, nFull = true, hasN = false;
    var n1 = team[u.pos - 1], n2 = team[u.pos + 1];
    [n1, n2].forEach(function (n) {
      if (!n || !n.alive) return;
      hasN = true;
      if (n.hp / n.hpMax <= 0.9) nLow = true;
      if (n.hp < n.hpMax) nFull = false;
    });

    if (hasN && nLow) {
      /* 味方全体に スキル発動者の最終最大HPの10.22% のバリア（10秒） */
      var allies = E.alive(E.team(u));
      var amount = u.hpMax * 0.1022;
      var per = f.shield ? f.shield.per : {};
      for (var j = 0; j < allies.length; j++) {
        var t = allies[j];
        t.shield = Math.max(t.shield, amount);
        per[t.pos] = Math.max(per[t.pos] || 0, amount);
      }
      f.shield = { until: frame + 10 * E.FPS, per: per };
    }
    if (hasN && nFull && !f.neighborFull) {
      /* 両隣が最大HPになった → 味方全体に 防御力無視ダメージ30.97%▲（5秒） */
      var al = E.alive(E.team(u));
      for (var q = 0; q < al.length; q++) {
        E.buff(al[q], 'flora-ignoredef', 'ignoreDefDmgPct', 30.97, 'up', frame + 5 * E.FPS, {});
      }
      E.event({ frame: frame, kind: 'flora-full-heal', side: u.side, unit: u.name });
    }
    f.neighborFull = hasN ? nFull : true;
    f.neighborLow = nLow;
  }
};
