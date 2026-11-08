/* ディーゼル (id 175 / org 54)
 *
 * パーサが表現できていない部分だけを実装する。
 *  - スキル2「通常攻撃が100回命中した時、自分に
 *    イチゴキャンディ：最大装弾数56.7%▲：10スタック：10秒間維持」
 *    （パーサではトリガー不明で落ちている）
 *  - スキル1「フルバーストタイム持続中に撃たれたら、自分に
 *    スキル発動者の最終最大HPの11.02%を回復」
 *
 * 「スタック解除後、味方全体に弾丸チャージ86.62%」はエンジンに弾丸チャージの
 * 概念が無いため実装しない。バーストの挑発はパーサが動かしているので触らない。
 */
(function () {
  function addStack(u, E, frame) {
    var b = E.buff(u, 'dsl-ichigo', 'magazinePct', 56.7, 'up', frame + 10 * E.FPS, { maxStacks: 10 });
    if (b && (b.stacks || 1) >= 10) u.dsl.maxed = true;
    u.dsl.stacks = b ? (b.stacks || 1) : 0;
  }

  (window.SPECIALS = window.SPECIALS || {})[175] = {
    init: function (u, E) {
      u.dsl = {
        hits: 0,
        stacks: 0,
        maxed: false,
        fbFrame: -1,
        lastBurstFrame: -1,
        lastHp: u.hp
      };
    },

    tick: function (u, E, frame) {
      var st = u.dsl;
      if (!st) return;

      // フルバーストタイムの発動（直前に B3 バーストが撃たれた）
      var lb = E.team(u).lastBurst;
      if (lb && lb.frame !== st.lastBurstFrame) {
        st.lastBurstFrame = lb.frame;
        if (lb.stage === 'B3') st.fbFrame = lb.frame;
      }

      // フルバーストタイム持続中に撃たれたら、最終最大HPの11.02%回復
      var fbActive = st.fbFrame >= 0 && frame <= st.fbFrame + 10 * E.FPS;
      if (fbActive && u.alive && u.hp < st.lastHp) {
        E.heal(u, u.hpMax * 0.1102, frame);
      }
      st.lastHp = u.hp;
    },

    onShot: function (u, E, frame, shot) {
      var st = u.dsl;
      if (!st || !shot) return;
      st.hits += (shot.hits || 0);
      // 通常攻撃が100回命中した時
      while (st.hits >= 100) {
        st.hits -= 100;
        addStack(u, E, frame);
      }
    }
  };
})();
