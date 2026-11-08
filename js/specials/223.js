/* アイギス (id 223 / org 198, SMG, B2, 支援型, 鉄甲)
 *
 * 原文の状態機械:
 *   skill2 バーストスキル使用時、自分が生存している限り
 *     パピヨンハート（持続・解除不可）
 *       効果1: 味方全体に マハタルカジャ：スキル発動者基準で攻撃力21.12%▲
 *       効果2: 味方全体に マハラクカジャ：スキル発動者基準で防御力21.12%▲
 *       解除条件: フルバーストタイムが終了した時
 *
 * パーサの扱い:
 *   - 対象が side:'self' になっているため、21.12%▲ がアイギス自身にしか乗らない。
 *   - 「スキル発動者基準」が basis:'self' として解釈され、割合バフになっている。
 *   - 解除条件が無く、恒久バフになっている。
 *
 * 本ファイルでは、味方（自分を除く）に「発動者の最終攻撃力／最終防御力の21.12%」を
 * 固定値で配り、フルバースト終了時に自分・味方ぶんとも外す。
 * （自分ぶんはパーサの割合バフをそのまま使い、二重計上を避ける）
 */
(function () {
  'use strict';

  var FB_FRAMES = 10 * 60;

  function st(u) {
    if (!u.aigis) u.aigis = { fbSeen: -1, fbEnd: -1 };
    return u.aigis;
  }

  function defEff(u, E) {
    return u.def * (1 + E.sumStat(u, 'defPct') / 100);
  }

  function clearBuffs(u, E) {
    /* パーサが自分に置いた skill2 の 攻撃力/防御力21.12%。
     * engine のキーは現状 slot が undefined になり、skill1 の恒久バフ
     * （同じ21.12%）と同じキーに統合されてしまう。その場合は skill1 ぶんが
     * 残るのが正しいので、slot 名を持つキーだけを外す。 */
    var p = u.side + u.pos + ':skill2:0:';
    u.buffs = u.buffs.filter(function (b) {
      if (b.key.indexOf(p) !== 0) return true;
      return !(b.stat === 'atkPct' || b.stat === 'defPct');
    });

    /* 味方に配った固定値バフ */
    var allies = E.team(u) || [];
    for (var i = 0; i < allies.length; i++) {
      var a = allies[i];
      if (!a) continue;
      var prefix = 'aigis-buff:' + u.side + u.pos + ':';
      a.buffs = a.buffs.filter(function (b) { return b.key.indexOf(prefix) !== 0; });
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[223] = {
    init: function (u, E) {
      st(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);
      var team = E.team(u) || [];
      var lb = team.lastBurst;
      if (lb && lb.stage === 'B3' && lb.frame !== s.fbSeen) {
        s.fbSeen = lb.frame;
        s.fbEnd = lb.frame + FB_FRAMES;
      }
      if (s.fbEnd >= 0 && frame >= s.fbEnd) {
        s.fbEnd = -1;
        clearBuffs(u, E);
        E.event({ frame: frame, kind: 'aigis-buff-end', side: u.side, unit: u.name });
      }
    },

    onBurst: function (u, E, frame) {
      var atk = E.atkEff(u) * 0.2112;
      var def = defEff(u, E) * 0.2112;
      var allies = E.alive(E.team(u));
      for (var i = 0; i < allies.length; i++) {
        var a = allies[i];
        if (a === u) continue;   /* 自分ぶんはパーサの割合バフが担当 */
        var prefix = 'aigis-buff:' + u.side + u.pos + ':' + a.pos;
        E.buff(a, prefix + ':atk', 'atkFlat', atk, 'up', Infinity, {});
        E.buff(a, prefix + ':def', 'defFlat', def, 'up', Infinity, {});
      }
      E.event({ frame: frame, kind: 'aigis-buff', side: u.side, unit: u.name });
    }
  };
})();
