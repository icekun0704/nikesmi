/* エクシア (id 99 / org 18)
 *
 * ハッキングコード収集。
 *   最後の弾丸（またはフルチャージ攻撃）が命中した時、自分に
 *     ハッキングコード収集：攻撃力16.8%→28%▲：5スタック：15秒
 *   その状態で最後の弾丸が命中した時、対象に 攻撃力13.77%▼ / 防御力13.77%▼
 *
 * 最後の弾丸かどうかは、装弾が尽きた直後の1発で判定する。
 */
(function () {
  (window.SPECIALS = window.SPECIALS || {})[99] = {
  /* ハッキングコードの攻撃力バフと、対象への攻撃力・防御力デバフはここで実装している */
  suppress: { skill1: [0], skill2: [0] },
    init: function (u, E) { u.exia = { stacks: 0, until: -1, charged: false }; },

    onShot: function (u, E, frame) {
      var st = u.exia;
      var last = shot_is_last(u);

      if (last) {
        st.stacks = Math.min(5, st.stacks + 1);
        st.until = frame + 15 * E.FPS;
        st.charged = true;
        E.buff(u, 'exia-hack', 'atkPct', 16.8 + (st.stacks >= 5 ? 11.2 : 0), 'up', st.until);
      } else if (st.charged && frame <= st.until) {
        // 状態中は対象の攻撃力・防御力を下げる
        var t = u._lastTarget;
        if (t && t.alive) {
          E.buff(t, 'exia-down-atk-' + u.pos + ':' + t.pos, 'atkPct', 13.77, 'down', frame + 5 * E.FPS);
          E.buff(t, 'exia-down-def-' + u.pos + ':' + t.pos, 'defPct', 13.77, 'down', frame + 5 * E.FPS);
        }
      }
    },

    tick: function (u, E, frame) {
      if (u.exia.until > 0 && frame > u.exia.until) {
        u.exia.until = -1;
        u.exia.stacks = 0;
        u.exia.charged = false;
      }
    }
  };

  /* 装弾が尽きた直後の1発（発射前に判定するので残弾1で真） */
  function shot_is_last(u) {
    var f = u.firing;
    if (!isFinite(f.magazine) || f.magazine <= 0) return false;
    return f.shotsInMagazine >= f.magazine - 1;
  }
})();
