/* アイン (id 97 / org 126, SR, B3, 火力型, 電撃)
 *
 * 原文の状態機械:
 *   戦闘開始時 : ニアフェザー4機展開
 *   バースト   : ニアフェザー6機展開
 *   ニアフェザーが展開された状態なら、ランダムの敵1機に
 *     ニアフェザー攻撃：最終攻撃力の90.81%の防御力無視ダメージ
 *   （展開されたニアフェザーはそれぞれ独立した維持時間を持ち、
 *     展開数が増えるとニアフェザーの攻撃頻度が増える ← research/gw410878.txt）
 *
 * 実装するもの:
 *   - ニアフェザー展開数（4 / 6）
 *   - skill2「フルチャージして攻撃した時、チャージダメージ80%▲：1発間維持」の解除。
 *     パーサは持続指定を落として恒久バフにしているので、次の1射で外す。
 *
 * 実装しないもの:
 *   - ニアフェザー攻撃そのもの: 原文に攻撃間隔の数値が無い
 *     （「攻撃頻度が増える」としか書かれておらず、推測値を置けない）
 *   - burst「最終防御力が最も高い敵10機に」の対象数: 敵は5機なので実質全体。
 *     パーサが count=10 で処理しており追加不要。
 */
(function () {
  'use strict';

  (window.SPECIALS = window.SPECIALS || {})[97] = {
    init: function (u, E) {
      u.ain = { feathers: 4 };   /* 戦闘開始時、ニアフェザー4機展開 */
    },

    tick: function (u, E, frame) {
      /* 展開数は onBurst で増える。維持時間は原文に無いので減らさない。 */
    },

    onShot: function (u, E, frame, shot) {
      /* 「チャージダメージ80%▲：1発間維持」を、その1発を撃ち終えた時点で外す。
       * パーサのキーは <side><pos>:skill2:1:...（skill2 の2番目のブロック）。 */
      /* engine のキーは <side><pos>:<slot>:<block>:stat:<stat>。
       * skill2 の2番目のブロック（1発間）だけを外す。slot が undefined に
       * なっている現状でも動くよう、block 番号で判定する。 */
      u.buffs = u.buffs.filter(function (b) {
        if (b.stat !== 'chargeDmgPct') return true;
        return b.key.indexOf(':1:stat:chargeDmgPct') < 0;
      });
    },

    onBurst: function (u, E, frame) {
      var s = u.ain;
      if (!s) return;
      s.feathers = 6;   /* ニアフェザー6機展開 */
      E.event({ frame: frame, kind: 'near-feather', side: u.side, unit: u.name,
                feathers: s.feathers });
    }
  };
})();
