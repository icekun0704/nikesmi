/* アビスタ (id 216 / org 188)
 *
 * パーサが表現できていない部分だけを実装する。
 *  - スターゲイザー状態（バーストで自分に付与・持続）の保持と、
 *    フルバーストタイム終了時の解除
 *  - スキル1「フルバーストタイムが終了した時、自分に
 *    最終最大HPの3.52%回復：1秒間隔：10秒間維持」
 *    （パーサは1回だけ回復するので、残り9回分を実装）
 *  - スキル2「フルバーストタイムが発動した時、自分のHPが25%以上で
 *    スターゲイザー状態なら、自分に 現在のHP20%▼」
 *
 * 「自分のアイドル」は原文に定義が無いため対象を決められず実装しない。
 * 「バースト再突入1段階」はエンジンに再突入の仕組みが無いため実装しない。
 */
(function () {
  function removePrefix(unit, prefix) {
    if (!unit || !unit.buffs) return;
    for (var i = unit.buffs.length - 1; i >= 0; i--) {
      if (String(unit.buffs[i].key).indexOf(prefix) === 0) unit.buffs.splice(i, 1);
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[216] = {
    init: function (u, E) {
      u.avi = {
        gaze: false,
        gazeUntil: -1,
        fbFrame: -1,
        lastBurstFrame: -1,
        fbApplied: false,
        heals: []
      };
    },

    tick: function (u, E, frame) {
      var st = u.avi;
      if (!st) return;

      // フルバーストタイムの発動
      var lb = E.team(u).lastBurst;
      if (lb && lb.frame !== st.lastBurstFrame) {
        st.lastBurstFrame = lb.frame;
        if (lb.stage === 'B3') {
          st.fbFrame = lb.frame;
          st.fbApplied = false;
          // フルバーストタイムが発動した時、HP25%以上かつスターゲイザー状態なら
          // 自分の現在のHP20%▼
          if (st.gaze && u.alive && (u.hp / u.hpMax) >= 0.25) {
            u.hp = Math.max(1, u.hp - u.hp * 0.20);
          }
        }
      }

      // フルバーストタイム終了時
      if (st.fbFrame >= 0 && !st.fbApplied && frame >= st.fbFrame + 10 * E.FPS) {
        st.fbApplied = true;
        // スターゲイザー解除
        if (st.gaze) {
          st.gaze = false;
          removePrefix(u, u.side + u.pos + ':burst:1:');
        }
        // 最終最大HPの3.52%回復：1秒間隔：10秒間維持
        // （パーサが終了時に1回分を実行済みなので残り9回）
        st.heals.push({ next: frame + E.FPS, until: frame + 9 * E.FPS });
      }

      // 継続回復
      for (var i = st.heals.length - 1; i >= 0; i--) {
        var h = st.heals[i];
        if (frame > h.until) { st.heals.splice(i, 1); continue; }
        if (frame < h.next) continue;
        if (u.alive) E.heal(u, u.hpMax * 0.0352, frame);
        h.next += E.FPS;
      }
    },

    onBurst: function (u, E, frame) {
      if (!u.avi) return;
      // スターゲイザー（スキル発動者基準で最大HP26.4%▲：持続）
      u.avi.gaze = true;
    }
  };
})();
