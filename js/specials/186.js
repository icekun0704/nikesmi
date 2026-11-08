/* ソーダ (id 186, MG, B1)
 *
 * パーサで表現できなかった部分:
 *   - スキル1「メイド精神：最大HP13%▲：5スタック：10秒間維持」。
 *     原文は1回のトリガで5スタック付与だが、engine の buff() は
 *     再適用のたびに1スタックずつしか積まない。10秒間維持・180発ごと
 *     という原文の数値では1スタックずつ積むことは起こり得ないので、
 *     メイド精神が付いている間は常に5スタックに揃える。
 *   - スキル2「自分がメイド精神のフルスタック状態なら、味方全体に
 *     スキル発動者の最終最大HPの12.71%回復」が trigger:unknown。
 *     スキル2（12秒周期）の発動タイミングで判定して回復する。
 *   - バースト「灼熱コードの味方全体に スタック可能バフのスタック量1個▲」
 *     （op:'stackBoost' は未処理）。灼熱の味方のスタック可能バフ
 *     （maxStacks > 1 のもの）の上限を1増やす。
 *
 * 実装していないもの: なし（上記の解釈は原文の「5スタック」に従う）。
 */
(function () {
  'use strict';

  function st(u) {
    if (!u.soda) u.soda = { nextHeal: 0 };
    return u.soda;
  }

  /* メイド精神のバフは applyEffect が label を渡さないため、
   * 原文の数値（最大HP13%▲・5スタック）で見分ける。 */
  function isMaid(b) {
    return b && b.stat === 'maxHpPct' && b.value === 13 && (b.maxStacks || 1) >= 5;
  }

  function maidStacks(u) {
    var bs = u.buffs || [];
    for (var i = 0; i < bs.length; i++) {
      if (isMaid(bs[i]) && bs[i].until >= u.now) return bs[i].stacks || 1;
    }
    return 0;
  }

  (window.SPECIALS = window.SPECIALS || {})[186] = {
    init: function (u, E) {
      st(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);

      // メイド精神は1回のトリガで5スタック
      var bs = u.buffs || [];
      for (var i = 0; i < bs.length; i++) {
        if (isMaid(bs[i]) && bs[i].until >= frame) {
          bs[i].stacks = Math.max(bs[i].stacks || 1, 5);
        }
      }

      // スキル2（12秒周期）：フルスタックなら味方全体を12.71%回復
      if (frame >= s.nextHeal) {
        s.nextHeal = frame + 12 * E.FPS;
        if (maidStacks(u) >= 5) {
          var team = E.team(u) || [];
          var amount = u.hpMax * 0.1271;
          for (var j = 0; j < team.length; j++) {
            if (team[j].alive) E.heal(team[j], amount, frame);
          }
          E.event({ frame: frame, kind: 'soda-maid-heal', side: u.side, unit: u.name });
        }
      }
    },

    onBurst: function (u, E, frame) {
      // 灼熱コードの味方全体：スタック可能バフのスタック上限 +1
      var team = E.team(u) || [];
      for (var i = 0; i < team.length; i++) {
        var a = team[i];
        if (!a.alive || a.element !== '灼熱') continue;
        var bs = a.buffs || [];
        for (var j = 0; j < bs.length; j++) {
          if ((bs[j].maxStacks || 1) > 1) bs[j].maxStacks += 1;
        }
      }
    }
  };
})();
