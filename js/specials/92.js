/* クエンシー：エスケープクイーン (id 92 / org 134)
 *
 * ルート探索の3段階。
 *   通常攻撃2回ごとに、いまの段階のスタックを積む
 *     1段階: 命中率1.36% / 攻撃力2.45% を10スタックまで（2秒）
 *     2段階: 命中率2.71% / 攻撃力4.9% を10スタックまで（1秒）
 *     3段階: 命中率4.08% / 攻撃力7.36% を 5スタックまで（0.5秒）
 *   フルスタックになると次の段階へ進み、その段階の常時効果を得る
 *     1段階フル: 分配ダメージ49.58%
 *     2段階フル: コアダメージ25.25%（アリーナにコアは無いので実質なし）
 *     3段階フル: クリティカル確率16.73%
 */
(function () {
  var TIERS = [
    { hr: 1.36, atk: 2.45, max: 10, dur: 2.0, full: { stat: 'distributedDmgPct', value: 49.58 } },
    { hr: 2.71, atk: 4.90, max: 10, dur: 1.0, full: { stat: 'coreDmgPct', value: 25.25 } },
    { hr: 4.08, atk: 7.36, max: 5,  dur: 0.5, full: { stat: 'critRate', value: 16.73 } }
  ];

  (window.SPECIALS = window.SPECIALS || {})[92] = {
    init: function (u, E) { u.quencey = { attacks: 0, tier: 0, stacks: 0, done: [false, false, false] }; },

    onShot: function (u, E, frame) {
      var st = u.quencey;
      st.attacks += 1;
      if (st.attacks % 2 !== 0) return;
      if (st.tier >= TIERS.length) return;

      var t = TIERS[st.tier];
      st.stacks += 1;

      // スタックぶんのバフ（同じキーで上書きして持続だけ更新）
      E.buff(u, 'q-hr', 'hitRate', t.hr * st.stacks, 'up', frame + Math.round(t.dur * E.FPS));
      E.buff(u, 'q-atk', 'atkPct', t.atk * st.stacks, 'up', frame + Math.round(t.dur * E.FPS));

      if (st.stacks >= t.max) {
        // フルスタック：段階の常時効果を得て、次の段階へ
        if (!st.done[st.tier]) {
          st.done[st.tier] = true;
          E.buff(u, 'q-full-' + st.tier, t.full.stat, t.full.value, 'up', Infinity);
        }
        st.tier += 1;
        st.stacks = 0;
      }
    }
  };
})();
