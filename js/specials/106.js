/* マクスウェル (id 106 / org 101, SR, B3, 鉄甲, 火力型)
 *
 * パーサで表現できていない部分:
 *   - burst「使用武器変更」の本体。原文は
 *       チャージ時間：2秒
 *       ダメージ：最終攻撃力の813.42%
 *       フルチャージダメージ：300%のダメージ
 *       最大装弾数：1発
 *       追加効果：貫通特化
 *     で、持続時間の記述が無い。持続時間を推測で作らないため、
 *     「最大装弾数1発」= 変更後の武器で1発撃つまで、として実装する。
 *     撃ち終わったら元の武器（char.stats.weaponDamage / maxCharge / magazine）へ戻す。
 *
 *   - 使用武器変更はこのユニットだけのものなので、共有オブジェクトである
 *     u.char / u.char.stats を直接書き換えず、init で複製してから書き換える。
 *
 * 実装していないもの（engine 側に受け皿が無い）:
 *   - skill2「ニケを除いた敵が5機以上の時のみ」… アリーナの敵はニケ5機なので
 *     条件を満たさない（原文どおり発動しない）。パーサも trigger=unknown で未発動。
 *
 * パーサが既に動かしているもの（触らない）:
 *   - skill1 の FB 発動時「チャージ速度4.48%▲ / 攻撃力43.1%▲」の上位2機。
 */
(function () {
  'use strict';

  var CHARGE_FRAMES = 2 * 60;      /* 原文: チャージ時間2秒 */
  var WEAPON_DAMAGE = 813.42;      /* 原文: 最終攻撃力の813.42% */
  var MAX_CHARGE = 300;            /* 原文: フルチャージダメージ300% */
  var MAX_AMMO = 1;                /* 原文: 最大装弾数1発 */

  /* チャージ時間ぶんに、通常の「チャージ後の旋回・発射」フレームを足す。
   * engine の chargeFixed は射撃周期そのものを置き換えるため。 */
  function turnFrames(u) {
    var f = u.firing;
    if (!f) return 0;
    var gap = (f.baseIntervalFrames || 0) - (f.baseChargeFrames || 0);
    return gap > 0 ? gap : 0;
  }

  function baseStats(u) {
    var st = (u.char && u.char.stats) || {};
    return {
      weaponDamage: st.weaponDamage,
      maxCharge: st.maxCharge,
      magazine: u.firing ? u.firing.magazine : 0
    };
  }

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  (window.SPECIALS = window.SPECIALS || {})[106] = {
    init: function (u, E) {
      /* このユニット専用に char を複製する（もう片方のチームの同じキャラに波及させない） */
      if (u.char) {
        u.char = Object.assign({}, u.char);
        u.char.stats = Object.assign({}, u.char.stats);
      }
      u.maxwell = {
        active: false,
        saved: null
      };
    },

    tick: function (u, E, frame) { },

    onShot: function (u, E, frame, shot) {
      var m = u.maxwell;
      if (!m || !m.active) return;

      /* 変更後の武器で1発撃ったら元に戻す（最大装弾数1発）。
       * engine の射撃ループはダメージ計算を終えてから onShot を呼ぶので、
       * このフレームのダメージには変更後の値が使われている。 */
      m.active = false;
      var s = m.saved || {};
      if (s.weaponDamage != null) u.char.stats.weaponDamage = s.weaponDamage;
      if (s.maxCharge != null) u.char.stats.maxCharge = s.maxCharge;
      if (u.firing) {
        u.firing.magazine = s.magazine;
        u.firing.shotsInMagazine = 0;
        if (u.firing.character) u.firing.character.hasPenetration = s.penetration;
      }
      delete u.chargeFixed;
      /* engine は変更後の chargeFixed で次フレームを決めたあとに onShot を呼ぶ。
       * 元の武器に戻したので、通常の射撃間隔で次弾を撃ち直す。 */
      if (u.firing) u.firing.nextFrame = frame + u.firing.interval;
      E.event({ frame: frame, kind: 'maxwell-weapon-end', side: u.side, unit: u.name });
    },

    onBurst: function (u, E, frame) {
      var m = u.maxwell;
      if (!m) return;
      if (!m.active) {
        m.saved = baseStats(u);
        m.saved.penetration = !!(u.firing && u.firing.character && u.firing.character.hasPenetration);
      }
      m.active = true;

      var sf = scaleOf(u, 'burst');
      u.char.stats.weaponDamage = WEAPON_DAMAGE * sf;
      u.char.stats.maxCharge = MAX_CHARGE * sf;
      u.chargeFixed = CHARGE_FRAMES + turnFrames(u);
      if (u.firing) {
        /* 変更後の武器はチャージ時間2秒。バースト直後から溜め直す。 */
        u.firing.nextFrame = frame + u.chargeFixed;
        u.firing.magazine = MAX_AMMO;
        u.firing.shotsInMagazine = 0;
        /* 追加効果：貫通特化（Gauge の着弾数計算は firing.character を見る） */
        if (u.firing.character) u.firing.character.hasPenetration = true;
      }

      E.event({ frame: frame, kind: 'maxwell-weapon', side: u.side, unit: u.name });
    }
  };
})();
