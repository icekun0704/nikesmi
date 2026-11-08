/* トーブ（宝物） (id 141 / org 7*)
 *
 * 実装する状態機械: 応急改造のスタックと、フルスタック時のチームバフ
 *
 * 原文 skill1（宝物版）:
 *   通常攻撃を10回行った時、自分に ・代用弾丸：弾丸チャージ5.31%
 *   代用弾丸が適用される時、味方全体に
 *   ・応急改造：最大装弾数2発▲：3スタック：5秒間維持
 *   ・クリティカルダメージ5.24%▲：5秒間維持
 * 原文 skill2（宝物版）:
 *   自分が応急改造のフルスタック時のみ、味方全体に
 *   ・クリティカル確率10.08%▲：持続
 *   自分が応急改造のフルスタック状態の時のみ、
 *   ショットガンを所持する味方全体に ・攻撃速度42.24%▲：持続
 * 原文 burst:
 *   味方全体に ・その場しのぎの奇跡：攻撃力2.32%▲：応急改造スタックコピー：15秒間維持
 *   ショットガンを所持する味方全体に ・攻撃力24.21%▲：応急改造スタックコピー：15秒間維持
 *
 * パーサ側の扱い:
 *   - 攻撃速度42.24% は periodic トリガーでパーサが味方全体に付与済み（武器種の絞り込み無し）。
 *     二重計上を避けて触らない。
 *   - 弾丸チャージ5.31% は engine に対応ステータスが無い。
 *   - burst の「応急改造スタックコピー」は解釈不能（倍率がスタック連動）のため保留。
 */
(function () {
  'use strict';

  var HITS_PER_BULLET = 10;      /* 通常攻撃を10回行った時 */
  var AC_MAX = 3;                /* 3スタック */
  var AC_FRAMES = 5 * 60;        /* 5秒間維持 */
  var AC_MAGAZINE_FLAT = 2;      /* 最大装弾数2発▲ */
  var AC_CRIT_DMG = 5.24;        /* クリティカルダメージ5.24%▲ */
  var FULL_STACK_CRIT_RATE = 10.08;  /* 宝物版 */

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  function findMag(t, unit) {
    for (var i = 0; i < t.mag.length; i++) {
      if (t.mag[i].unit === unit) return t.mag[i];
    }
    return null;
  }

  function restoreMagazine(t) {
    for (var i = 0; i < t.mag.length; i++) {
      var rec = t.mag[i];
      if (rec.unit.firing && isFinite(rec.unit.firing.magazine)) {
        rec.unit.firing.magazine = rec.base;
      }
    }
    t.mag = [];
  }

  (window.SPECIALS = window.SPECIALS || {})[141] = {
    init: function (u, E) {
      u.tove = { hits: 0, stacks: 0, until: -1, mag: [] };
    },

    tick: function (u, E, frame) {
      var t = u.tove;
      if (!t) return;

      if (frame > t.until && t.stacks > 0) {
        t.stacks = 0;
        restoreMagazine(t);
      }

      /* 自分が応急改造のフルスタック時のみ、味方全体に クリティカル確率10.08%▲：持続 */
      if (t.stacks >= AC_MAX) {
        var mates = E.alive(E.team(u));
        for (var i = 0; i < mates.length; i++) {
          E.buff(mates[i], 'tove-ac-crit:' + u.pos, 'critRate',
            FULL_STACK_CRIT_RATE * scaleOf(u, 'skill2'), 'up', Infinity,
            { aura: true, label: '応急改造' });
        }
      }
    },

    onShot: function (u, E, frame, shot) {
      var t = u.tove;
      if (!t) return;

      /* 通常攻撃を10回行った時 → 代用弾丸 → 応急改造 */
      t.hits += 1;
      if (t.hits % HITS_PER_BULLET !== 0) return;

      if (frame > t.until) {
        t.stacks = 0;
        restoreMagazine(t);
      }
      if (t.stacks < AC_MAX) t.stacks += 1;
      t.until = frame + AC_FRAMES;

      var until = frame + AC_FRAMES;
      var mates = E.alive(E.team(u));
      for (var i = 0; i < mates.length; i++) {
        var ally = mates[i];
        E.buff(ally, 'tove-ac-critdmg:' + u.pos, 'critDmgPct',
          AC_CRIT_DMG * scaleOf(u, 'skill1'), 'up', until,
          { label: '応急改造' });

        /* 応急改造：最大装弾数2発▲（スタック分だけ最大装弾数を増やす）。
         * engine は magazineFlat/magazinePct を「1射撃ごとに再加算」してしまうため
         * バフとして積むと弾数が発散する。ここでは firing.magazine を直接
         * 元の弾数＋スタック分に設定し、期限が切れたら元に戻す。 */
        if (ally.firing && isFinite(ally.firing.magazine) && ally.firing.magazine > 0) {
          var rec = findMag(t, ally);
          if (!rec) {
            rec = { unit: ally, base: ally.firing.magazine };
            t.mag.push(rec);
          }
          var base = Math.floor(Number(ally.char.stats && ally.char.stats.magazine) || 0) || rec.base;
          ally.firing.magazine = base + AC_MAGAZINE_FLAT * t.stacks;
        }
      }
    },

    onBurst: function (u, E, frame) {
      /* burst の攻撃力はパーサが付与済み。「応急改造スタックコピー」は保留。 */
    }
  };
})();
