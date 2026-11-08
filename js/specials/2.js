/* アニス：スター (id 2 / org 187)
 *
 * スキル1は「部隊構成による効果：該当効果のみ適用」で、編成によって2通りに分かれる。
 *
 *   A) 自分を除く基本バースト段階1の味方が【いない】場合 — 私だけの星
 *      ・自分に 攻撃力40.01%▲（解除不可）
 *      ・味方全体に バーストスキルクールタイム7.48秒▼
 *   B) 【いる】場合 — みんなの星
 *      ・自分がバースト再突入1段階に変更（バースト連鎖は gauge.js 側が処理済み）
 *
 * どちらの場合も、戦闘開始時から自分が生存している限り
 * 味方全体のバーストゲージのチャージ速度 +6%。
 * （パーサは条件を読めず発動しないので、ここで入れる）
 */
(function () {
  function hasOtherB1(u, E) {
    var team = E.team(u);
    for (var i = 0; i < team.length; i++) {
      var a = team[i];
      if (a === u || !a.alive) continue;
      var st = String(a.char && a.char.burstStage || '');
      if (/B1/.test(st) && !/B123/.test(st)) return true;
    }
    return false;
  }

  (window.SPECIALS = window.SPECIALS || {})[2] = {
    init: function (u, E) {
      u.anisStar = { mode: hasOtherB1(u, E) ? 'everyone' : 'onlyme', cdApplied: false };

      // 戦闘開始時、味方全体に バーストゲージのチャージ速度6%▲（自分が生存している限り）
      var team = E.team(u);
      for (var i = 0; i < team.length; i++) {
        if (!team[i].alive) continue;
        E.buff(team[i], 'anis-gauge-' + team[i].pos, 'burstGaugePct', 6, 'up', Infinity);
      }

      if (u.anisStar.mode === 'onlyme') {
        E.buff(u, 'anis-solo', 'atkPct', 40.01, 'up', Infinity);
      }
    },

    tick: function (u, E, frame) {
      var st = u.anisStar;
      if (st.mode !== 'onlyme' || st.cdApplied) return;
      // 味方全体のバーストクールタイムを7.48秒短縮（1回）
      var team = E.team(u);
      for (var i = 0; i < team.length; i++) {
        var a = team[i];
        if (a === u || !a.alive) continue;
        a.burstReadyAt = Math.max(0, a.burstReadyAt - 7.48 * E.FPS);
      }
      st.cdApplied = true;
    }
  };
})();
