/* A2 (id 32 / org 76)
 *
 * バーストの「Bモード」。
 *   ・1秒ごとに自分のHPが減少する代わりに、攻撃力とチャージ速度が増加
 *   ・自分のHPが40%以下ならBモード解除
 *
 * 数値はパース済みのものを使う（攻撃力15.19%▲ / チャージ速度35.88%▲ /
 * HP減少3.99%毎秒）。パーサはこのブロックの発動条件を読めず unknown に
 * しているため、エンジンからは発火しない。ここで補う。
 */
(function () {
  var ATK = 15.19;
  var CHARGE_SPEED = 35.88;
  var DRAIN_PCT = 3.99;     // 毎秒、最大HP比
  var END_HP_RATIO = 0.40;

  (window.SPECIALS = window.SPECIALS || {})[32] = {
    init: function (u, E) { u.a2 = { active: false, lastDrain: -1 }; },

    onBurst: function (u, E, frame) {
      u.a2.active = true;
      u.a2.lastDrain = frame;
    },

    tick: function (u, E, frame) {
      var st = u.a2;
      if (!st.active) return;

      if (u.hp / u.hpMax <= END_HP_RATIO) {
        // Bモード解除。次のフレームでバフが切れるよう、更新を止めるだけ。
        st.active = false;
        return;
      }

      // バフは毎フレーム延長して維持する
      E.buff(u, 'a2-atk', 'atkPct', ATK, 'up', frame + 2);
      E.buff(u, 'a2-cs', 'chargeSpeedPct', CHARGE_SPEED, 'up', frame + 2);

      // 1秒ごとにHPが減る
      if (frame - st.lastDrain >= E.FPS) {
        st.lastDrain = frame;
        u.hp = Math.max(1, u.hp - u.hpMax * DRAIN_PCT / 100);
      }
    }
  };
})();
