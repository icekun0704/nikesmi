/* マルチャーナ (id 66 / org 63)
 *
 * 実装する状態機械: 最後の弾丸命中時のチーム吸血
 *
 * 原文 skill1:
 *   最後の弾丸が命中した時、味方全体に
 *   ・ダメージの10.95%回復：3秒間維持
 *   最後の弾丸が命中した時、最終攻撃力が高い味方2機に
 *   ・受けるHP回復量26.98%▲：3秒間維持
 * 原文 burst:
 *   味方全体に
 *   ・保存：スキル発動者基準で最大HPの27.87%まで超過HP回復量を保存：10秒間維持
 *   ・スキル発動者の防御力の20.9%防御力▲：10秒間維持
 *
 * パーサ側の扱い:
 *   - 1つ目の「ダメージの10.95%回復」は op:unparsed で未実装。ここで実装する。
 *   - 2つ目の「受けるHP回復量26.98%▲」は lastBullet トリガーでパーサが付与済み。触らない。
 *   - burst の防御力バフは付与済み。「保存」は burst 内に回復が無く超過回復が発生しないため保留。
 */
(function () {
  'use strict';

  var LIFESTEAL_PCT = 10.95;
  var LIFESTEAL_FRAMES = 3 * 60;

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  (window.SPECIALS = window.SPECIALS || {})[66] = {
    init: function (u, E) {
      u.marc66 = { ls: [] };
    },

    tick: function (u, E, frame) {
      var m = u.marc66;
      if (!m) return;
      /* 3秒経過した吸血を外す（他の効果で上書きされていない場合のみ） */
      var keep = [];
      for (var i = 0; i < m.ls.length; i++) {
        var rec = m.ls[i];
        if (rec.until < frame) {
          if (rec.unit.lifestealPct === rec.value) rec.unit.lifestealPct = 0;
        } else {
          keep.push(rec);
        }
      }
      m.ls = keep;
    },

    onShot: function (u, E, frame, shot) {
      var m = u.marc66;
      if (!m) return;
      /* 最後の弾丸が命中した時 */
      if (!shot || !shot.reloaded) return;

      var value = LIFESTEAL_PCT * scaleOf(u, 'skill1');
      var mates = E.alive(E.team(u));
      var until = frame + LIFESTEAL_FRAMES;
      for (var i = 0; i < mates.length; i++) {
        var t = mates[i];
        if ((t.lifestealPct || 0) < value) t.lifestealPct = value;
        var found = false;
        for (var j = 0; j < m.ls.length; j++) {
          if (m.ls[j].unit === t) {
            m.ls[j].until = until;
            m.ls[j].value = value;
            found = true;
            break;
          }
        }
        if (!found) m.ls.push({ unit: t, until: until, value: value });
      }
    },

    onBurst: function (u, E, frame) {
      /* 保存は超過回復が発生した時にのみ意味を持つが、burst 自体に回復が無く
       * 他の回復イベントを観測する手段も無いため保留。 */
    }
  };
})();
