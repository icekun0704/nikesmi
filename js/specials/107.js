/* ミルク (id 107 / org 12, SR, B1, 火力型, 水冷)
 *
 * 原文の状態機械:
 *   skill1: 20秒ごとに、攻撃力が最も高い味方2機に 攻撃力31.83%▲：10秒間維持
 *   skill2: 自分のHPが80%以上の時のみ、味方全体に
 *           クリティカルダメージ11.13%▲：持続
 *   burst : 味方全体に 攻撃ダメージの16.16%回復：10秒間維持
 *
 * パーサの扱い:
 *   - skill1 の periodic は trigger.seconds が文字列（"20秒<G>→パッシブ</>"）のため
 *     engine の周期計算が NaN になり、毎フレーム発動してしまう。
 *     このユニットの skillState だけ trigger.seconds を数値に直して周期を戻す
 *     （効果そのものはパーサのものをそのまま使う。二重計上しない）。
 *   - skill2 は trigger=unknown で未発動。HP条件付きのオーラとして毎フレーム判定。
 *   - burst の lifesteal は duration を無視して恒久設定される。10秒後に戻す。
 *
 * 宝物版の差し替え行（バーストCT20秒▼ / 受けるHP回復量75.5%▲ /
 * フルチャージ10回でバーストCT2.83秒▼）は、このキャラが宝物でないため対象外。
 */
(function () {
  'use strict';

  var CRIT_DMG_PCT = 11.13;
  var LIFESTEAL_PCT = 16.16;
  var LIFESTEAL_FRAMES = 10 * 60;

  /* trigger.seconds が文字列の periodic を数値に直す（このユニット限定）。 */
  function fixPeriodicSeconds(u) {
    if (!u.skillState) return;
    for (var i = 0; i < u.skillState.length; i++) {
      var sk = u.skillState[i];
      for (var b = 0; b < sk.blocks.length; b++) {
        var bs = sk.blocks[b];
        var t = bs.block && bs.block.trigger;
        if (!t || t.kind !== 'periodic') continue;
        if (typeof t.seconds !== 'string') continue;
        var m = t.seconds.match(/(\d+(?:\.\d+)?)/);
        bs.block = Object.assign({}, bs.block, {
          trigger: Object.assign({}, t, { seconds: m ? parseFloat(m[1]) : null })
        });
      }
    }
  }

  function st(u) {
    if (!u.milk) {
      u.milk = {
        lsUntil: -1,
        lsApplied: false,
        lsUnits: []
      };
    }
    return u.milk;
  }

  (window.SPECIALS = window.SPECIALS || {})[107] = {
    init: function (u, E) {
      st(u);
      fixPeriodicSeconds(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);

      /* 自分のHPが80%以上の時のみ、味方全体に クリダメ11.13%▲（持続） */
      if ((u.hp / u.hpMax) * 100 >= 80) {
        var team = E.alive(E.team(u));
        for (var m = 0; m < team.length; m++) {
          E.buff(team[m], 'milk-crit:' + u.side + u.pos + ':' + team[m].pos,
            'critDmgPct', CRIT_DMG_PCT, 'up', frame + 1, { aura: true });
        }
      }

      /* burst の lifesteal 16.16% を10秒で解除 */
      if (s.lsUntil >= 0 && !s.lsApplied) {
        s.lsApplied = true;
        var all = E.alive(E.team(u));
        for (var k = 0; k < all.length; k++) {
          if (all[k].lifestealPct >= LIFESTEAL_PCT) s.lsUnits.push(all[k]);
        }
      }
      if (s.lsUntil >= 0 && frame > s.lsUntil) {
        s.lsUntil = -1;
        s.lsApplied = false;
        for (var r = 0; r < s.lsUnits.length; r++) {
          var t = s.lsUnits[r];
          if (t.lifestealPct === LIFESTEAL_PCT) t.lifestealPct = 0;
        }
        s.lsUnits = [];
        E.event({ frame: frame, kind: 'milk-lifesteal-end', side: u.side, unit: u.name });
      }
    },

    onBurst: function (u, E, frame) {
      var s = st(u);
      /* 「攻撃ダメージの16.16%回復：10秒間維持」はパーサが lifesteal として
       * 全味方に恒久設定する。10秒後に戻すためのタイマーだけ持つ。 */
      s.lsUntil = frame + LIFESTEAL_FRAMES;
      s.lsApplied = false;
      s.lsUnits = [];
    }
  };
})();
