/* マスト (id 153 / org 57, SMG, B2, 支援型)
 *
 * パーサで表現できていない部分:
 *   - スキル1「自分のHPが70%以下の時に限り、
 *       自分と自分を除く最終攻撃力が最も高い味方2機に
 *       クリティカルダメージ50.94%▲：持続」
 *     パーサは trigger:always として戦闘開始時に味方2機へ配ってしまい、
 *     自分が対象から外れ、HP70%以下の条件も見ていない。
 *     開始時にそのぶんを剥がし、条件を満たすあいだ配り直す。
 *   - スキル2「戦闘開始時、自分と自分を除く攻撃力が最も高い味方2機に
 *       クリティカル確率23.56%▲：30秒間維持」
 *     パーサは味方2機にしか配らない（自分が抜けている）。自分ぶんを足す。
 *   - バースト「自分と自分を除く攻撃力が最も高い味方2機に
 *       最大HPのみ86.2%▲：7秒／クリティカルダメージ25.19%▲：7秒」
 *     同じくパーサは味方2機にしか配らない。自分ぶんを足す。
 *
 * 実装していないもの:
 *   - スキル1「通常クリティカル攻撃が2回命中した時、対象に
 *       海風：スキル発動者基準で防御力1.9%▼：50スタック：3秒間維持」
 *     と、バーストの「海風状態の対象に 暴風：4.52%×7秒」。
 *     クリティカルだったかどうかを engine の外から観測する口が無い
 *     （dealDamage が内部で乱数を引いており、結果を API に出していない）。
 *     推測でクリティカル率を別に振ることはしない。
 */
(function () {
  'use strict';

  var CDMG_PCT = 50.94;        /* 原文: クリティカルダメージ50.94%▲ */
  var HP_THRESHOLD = 70;       /* 原文: 自分のHPが70%以下 */
  var CRATE_PCT = 23.56;       /* 原文: クリティカル確率23.56%▲ */
  var CRATE_SECONDS = 30;      /* 原文: 30秒間維持 */
  var BURST_CDMG_PCT = 25.19;  /* 原文: クリティカルダメージ25.19%▲ */
  var BURST_HP_PCT = 86.2;     /* 原文: 最大HPのみ86.2%▲ */
  var BURST_SECONDS = 7;       /* 原文: 7秒間維持 */

  function topAtkAllies(u, E, count) {
    var list = E.alive(E.team(u)).filter(function (a) { return a !== u; });
    list.sort(function (a, b) { return E.atkEff(b) - E.atkEff(a); });
    return list.slice(0, count);
  }

  /* engine の buff key は `side+pos:スロット:ブロック番号:...` だが、
   * 現状の engine はスロット名が undefined になることがあるので両方見る。 */
  function removePrefix(unit, prefixes, stat) {
    if (!unit || !unit.buffs) return;
    for (var i = unit.buffs.length - 1; i >= 0; i--) {
      var b = unit.buffs[i];
      if (stat && b.stat !== stat) continue;
      var key = String(b.key);
      for (var k = 0; k < prefixes.length; k++) {
        if (key.indexOf(prefixes[k]) === 0) { unit.buffs.splice(i, 1); break; }
      }
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[153] = {
    init: function (u, E) {
      u.mast = { patched: false };
      /* スキル2：自分のぶんのクリティカル確率（パーサは味方2機にだけ配る） */
      E.buff(u, 'mast-crate-self', 'critRate', CRATE_PCT, 'up',
        CRATE_SECONDS * E.FPS, {});
    },

    tick: function (u, E, frame) {
      var s = u.mast;
      if (!s) return;

      /* 戦闘開始時にパーサが配ったスキル1の常時バフを剥がす */
      if (!s.patched) {
        s.patched = true;
        var team = E.team(u);
        var prefixes = [u.side + u.pos + ':skill1:1:', u.side + u.pos + ':undefined:1:'];
        for (var i = 0; i < team.length; i++) removePrefix(team[i], prefixes, 'critDmgPct');
      }

      /* スキル1：HP70%以下のあいだ、自分＋攻撃力上位2機にクリティカルダメージ */
      if (u.hpMax > 0 && u.hp / u.hpMax * 100 <= HP_THRESHOLD) {
        var targets = [u].concat(topAtkAllies(u, E, 2));
        for (var t = 0; t < targets.length; t++) {
          var a = targets[t];
          if (!a.alive) continue;
          E.buff(a, 'mast-s1-cdmg', 'critDmgPct', CDMG_PCT, 'up',
            frame + 2, { aura: true });
        }
      }
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) {
      var until = frame + BURST_SECONDS * E.FPS;

      /* 味方2機のぶんはパーサが配る。自分のぶんだけ足す。 */
      E.buff(u, 'mast-burst-hp', 'hpFlat', u.hpMaxBase * BURST_HP_PCT / 100,
        'up', until, {});
      E.buff(u, 'mast-burst-cdmg', 'critDmgPct', BURST_CDMG_PCT, 'up', until, {});
    }
  };
})();
