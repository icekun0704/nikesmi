/* クイーン（真） (id 224 / org 197)
 *
 * 「1more」が彼女の本体。
 *   バーストで対象が風圧コードなら、自分に 1more（攻撃力30.27%▲）が付く。
 *   1more が適用された時、敵全体に 最終攻撃力の548.99% の分配ダメージ。
 *   同じく1moreが適用された時、自分を除く基本バースト段階3の味方全体に
 *   攻撃力35.2%▲（3スタック）。
 *
 * 追撃も同じ548.99%だが、アリーナで追撃を配る手段が無いため実装しない。
 */
(function () {
  var ONEMORE_DMG = 548.99;
  var ONEMORE_ATK = 30.27;
  var ALLY_ATK = 35.2;

  (window.SPECIALS = window.SPECIALS || {})[224] = {
    init: function (u, E) { u.queen = { done: false }; },

    onBurst: function (u, E, frame) {
      // 対象（＝いま狙っている敵）が風圧コードなら1moreが付く
      var t = E.pickTarget(u, frame);
      if (!t || t.element !== '風圧') return;

      E.buff(u, 'queen-1more', 'atkPct', ONEMORE_ATK, 'up', frame + 10 * E.FPS);

      // 1more適用時：敵全体に分配ダメージ
      var es = E.alive(E.enemies(u));
      for (var i = 0; i < es.length; i++) {
        E.damage(u, es[i], frame, { multiplierPct: ONEMORE_DMG, isDistributed: true });
      }

      // 1more適用時：基本バースト段階3の味方全体に攻撃力35.2%（3スタック）
      var team = E.team(u);
      for (var j = 0; j < team.length; j++) {
        var a = team[j];
        if (a === u || !a.alive) continue;
        var st = String(a.char && a.char.burstStage || '');
        if (!/B3/.test(st)) continue;
        E.buff(a, 'queen-baton-' + a.pos, 'atkPct', ALLY_ATK, 'up', frame + 10 * E.FPS);
      }
    }
  };
})();
