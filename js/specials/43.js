/* ベイ（宝物） (id 43, RL, B2)
 *
 * パーサで表現できなかった部分（すべて遮蔽物まわり）:
 *   - バースト「自分の遮蔽物が破壊された状態なら 遮蔽物HP20%で遮蔽物復活：
 *     戦闘中1回発動」
 *   - バースト「スキル発動者の最大HPに比例して遮蔽物最大HP18%▲：20秒間維持」
 *   - フルバースト終了時「遮蔽物HP持続回復2.88%：1秒間隔：5秒間維持」
 *     （trigger:fullBurstEnd の効果は op:'coverStat' で applyEffect が
 *      default:return するため何も起きない）
 *
 * 実装していないもの:
 *   - 「受けるダメージ偏差分配」（スキル1の味方全体／スキル2の遮蔽物）：
 *     偏差分配の割合が原文に無く、engine の shareDamage は均等分配のみ。
 *     entity 側にも比率の情報が無いため実装しない。
 *   - バースト1段階突入時の「遮蔽物が破壊されていれば20%回復」の条件：
 *     パーサは burstStage トリガで無条件に回復を撃ってしまっており、
 *     回復は取り消せないため補正しない（過剰回復のまま）。
 */
(function () {
  'use strict';

  function st(u) {
    if (!u.bay) {
      u.bay = {
        reviveUsed: false,
        coverBoostAmt: 0,
        coverBoostUntil: -1,
        fbEnd: -1,
        regenNext: -1,
        regenLeft: 0
      };
    }
    return u.bay;
  }

  (window.SPECIALS = window.SPECIALS || {})[43] = {
  /* 遮蔽物の回復・復活・最大HPはここで実装している */
  suppress: { skill2: [1], burst: [0, 1] },
    init: function (u, E) {
      st(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);

      // 遮蔽物最大HPバフの失効
      if (s.coverBoostUntil >= 0 && frame > s.coverBoostUntil) {
        u.coverMax = Math.max(0, u.coverMax - s.coverBoostAmt);
        if (u.coverHp > u.coverMax) u.coverHp = u.coverMax;
        s.coverBoostAmt = 0;
        s.coverBoostUntil = -1;
      }

      // フルバースト終了を検出（B3 発動の600フレーム後）
      var team = E.team(u) || [];
      var lb = team.lastBurst;
      if (lb && lb.stage === 'B3' && lb.frame === frame) {
        s.fbEnd = frame + 600;
      }
      if (s.fbEnd >= 0 && frame >= s.fbEnd) {
        s.fbEnd = -1;
        s.regenNext = frame;
        s.regenLeft = 5;     // 1秒間隔・5秒間
      }

      // 遮蔽物HP持続回復 2.88%
      if (s.regenLeft > 0 && frame >= s.regenNext) {
        s.regenNext = frame + 60;
        s.regenLeft -= 1;
        u.coverHp = Math.min(u.coverMax, u.coverHp + u.hpMax * 0.0288);
      }
    },

    onBurst: function (u, E, frame) {
      var s = st(u);

      // 遮蔽物が破壊されていれば20%で復活（戦闘中1回）
      if (u.coverHp <= 0 && !s.reviveUsed) {
        s.reviveUsed = true;
        u.coverHp = Math.round(u.coverMax * 0.20);
        E.event({ frame: frame, kind: 'cover-revive', side: u.side, unit: u.name });
      }

      // 遮蔽物最大HP +18%（最終最大HP基準）：20秒間維持
      var base = u.coverMax - s.coverBoostAmt;
      s.coverBoostAmt = Math.round(u.hpMax * 0.18);
      u.coverMax = base + s.coverBoostAmt;
      if (u.coverHp > u.coverMax) u.coverHp = u.coverMax;
      s.coverBoostUntil = frame + 20 * E.FPS;
    }
  };
})();
