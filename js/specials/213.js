/* ラプラス：アルティメットヒーロー (id 213, RL, B3, 火力型) — 宝物なし
 *
 * パーサで表現できなかった部分:
 *   - skill2「オーバーエネルギー」: 通常攻撃で12回攻撃するごとに +5%（最大100%）。
 *     100%になったら初期化して段階を1つ上げ、段階別の最大HP効果を
 *     「下位効果のスタック適用」で累積付与する（1段階2% / 2段階3% / 3段階7% / 4段階10.5%）。
 *     → パーサは「オーバーエネルギー5%▲」も「段階増加」も unparsed、
 *       段階別の maxHpPct は trigger=unknown のブロックにあり発火しない。
 *   - burst「自分がオーバーエネルギー状態1段階以上なら、照準線に最も近い敵1機に
 *     最終攻撃力の934.76%×オーバーエネルギー段階の追加ダメージ」は unparsed。
 *
 * パーサ／エンジンが既に処理しているので実装しないもの:
 *   - ウォームアップ（チャージ速度10%×5スタック）は js/gauge.js の
 *     isLaplaceUH 分岐（1ヒットごとに +10%、5ヒットで上限）が既に掛けている。
 *     ここで重ねるとチャージ速度を二重計上するので触らない。
 *   - 使用武器変更（エレクトリックパワー·フル·フルチャージ）は js/data.js の
 *     このキャラの stats が既に magazine=120 / skill1 multiplier=9.45 を持っており、
 *     変形後の武器として扱われている。追加のダメージ補正はしない。
 *
 * 不明点:
 *   - 「段階」の上限。4段階までの効果しか原文に無いので 4 で止める。
 */
(function () {
  'use strict';

  var FPS = 60;

  function pickTargetOf(u, E, frame) {
    try {
      var t = E.pickTarget(u, E.enemies(u), frame);
      if (t) return t;
    } catch (e) { /* 2引数版 */ }
    try { return E.pickTarget(u, frame) || null; } catch (e2) { return null; }
  }

  (window.SPECIALS = window.SPECIALS || {})[213] = {
    init: function (u, E) {
      u.laplaceUH = {
        shots: 0,          // 通常攻撃の回数
        over: 0,           // オーバーエネルギー（0..100）
        stage: 0,          // 段階（0..4）
        stageApplied: {}   // 付与済みの段階別効果
      };
    },

    tick: function (u, E, frame) {},

    onShot: function (u, E, frame, shot) {
      var st = u.laplaceUH;
      if (!st) return;

      st.shots += 1;
      // 通常攻撃で12回攻撃した時 → オーバーエネルギー5%
      if (st.shots % 12 !== 0) return;
      st.over += 5;
      if (st.over < 100) return;

      // 100%に到達: 初期化して段階を1つ上げる
      st.over = 0;
      if (st.stage >= 4) return;
      st.stage += 1;

      // 段階別効果は下位効果のスタック適用（1段階..現在段階までを累積）
      var hpPct = { 1: 2, 2: 3, 3: 7, 4: 10.5 };
      for (var s = 1; s <= st.stage; s++) {
        if (st.stageApplied[s]) continue;
        st.stageApplied[s] = true;
        E.buff(u, 'laplace-stage-' + s, 'maxHpPct', hpPct[s], 'up', Infinity,
               { label: s + '段階' });
      }
      E.event({ frame: frame, kind: 'laplace-overenergy', side: u.side, unit: u.name,
                stage: st.stage });
    },

    onBurst: function (u, E, frame) {
      var st = u.laplaceUH;
      if (!st || st.stage < 1) return;
      // 934.76% × 段階 の追加ダメージ（照準線に最も近い敵1機 = 通常の狙い）
      var t = pickTargetOf(u, E, frame);
      if (t) {
        E.damage(u, t, frame, { multiplierPct: 934.76 * st.stage, isBurst: true });
        E.event({ frame: frame, kind: 'laplace-burst-extra', side: u.side, unit: u.name,
                  stage: st.stage, target: t.name });
      }
    }
  };
})();
