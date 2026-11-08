/* 千束 (id 164 / org 181, SMG, B3, 火力型, 鉄甲)
 *
 * 原文の状態機械: 超感覚（0〜100%の独自ゲージ）
 *   戦闘開始時 / バースト使用時 : 超感覚100%チャージ
 *   2秒ごと                    : 超感覚1%▼
 *   自分が超感覚状態なら（下位効果のスタック適用）:
 *     100%のとき : 射撃予測：無敵 2秒間
 *     70%以上    : 攻撃力53.69%▲
 *     55%以上    : 防御力無視ダメージ48.62%▲
 *     25%以上    : 命中率22.37%▲
 *
 * パーサは「自分が超感覚状態なら」を trigger=unknown にしているため、
 * 上記の段階効果は一切発動していない（burst の攻撃力73.16%だけは動く）。
 *
 * 実装しないもの:
 *   - skill2「バースト使用時、通常攻撃を防御力無視ダメージに変更：10秒間維持」
 *     … engine は通常攻撃のダメージ計算を済ませてから onShot を呼ぶので差し替え不可
 */
(function () {
  'use strict';

  var DRAIN_FRAMES = 2 * 60;   /* 2秒ごとに1%▼ */
  var INVULN_FRAMES = 2 * 60;  /* 射撃予測：無敵 2秒 */

  function st(u) {
    if (!u.chisato) {
      u.chisato = { gauge: 100, invulnGranted: false };
    }
    return u.chisato;
  }

  (window.SPECIALS = window.SPECIALS || {})[164] = {
    init: function (u, E) {
      st(u);   /* 戦闘開始時：超感覚100%チャージ */
    },

    tick: function (u, E, frame) {
      var s = st(u);

      /* 2秒ごとに 超感覚1%▼ */
      if (frame > 0 && frame % DRAIN_FRAMES === 0 && s.gauge > 0) {
        s.gauge = Math.max(0, s.gauge - 1);
      }

      /* 段階別の効果（下位効果も同時に適用＝しきい値ごとに独立） */
      var g = s.gauge;
      if (g >= 25) {
        E.buff(u, 'chisato-hit', 'hitRate', 22.37, 'up', frame + 1, { aura: true });
      }
      if (g >= 55) {
        E.buff(u, 'chisato-idef', 'ignoreDefDmgPct', 48.62, 'up', frame + 1, { aura: true });
      }
      if (g >= 70) {
        E.buff(u, 'chisato-atk', 'atkPct', 53.69, 'up', frame + 1, { aura: true });
      }

      /* 100%のとき：射撃予測：無敵 2秒間（100%に到達した時だけ） */
      if (g >= 100) {
        if (!s.invulnGranted) {
          s.invulnGranted = true;
          u.invulnUntil = Math.max(u.invulnUntil, frame + INVULN_FRAMES);
          E.event({ frame: frame, kind: 'chisato-invuln', side: u.side, unit: u.name });
        }
      } else {
        s.invulnGranted = false;
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = st(u);
      if (!s) return;
      /* 「自分が超感覚状態なら」の前提。0%でも状態自体は続くが、
       * 効果のしきい値は tick 側で判定している。
       * skill2 の「通常攻撃を防御力無視ダメージに変更」は engine 非対応。 */
    },

    onBurst: function (u, E, frame) {
      var s = st(u);
      /* 超感覚100%チャージ */
      s.gauge = 100;
      s.invulnGranted = false;
      E.event({ frame: frame, kind: 'chisato-supersense', side: u.side, unit: u.name,
                gauge: s.gauge });
    }
  };
})();
