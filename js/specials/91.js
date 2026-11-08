/* ルドミラ (91 / org 10)
 *
 * パーサで表現できていない部分だけを実装する。
 *
 * 実装:
 *   バースト「自分のHPが50%以上なら味方全体に・防御力12.93%▲：10秒間維持」
 *   … 条件付きブロック (trigger=unknown) で落ちているので、バースト時に
 *     HP割合を見て味方全体へ配る。
 *
 *   スキル2「フルバーストタイムが発動した時、自分に・受けるダメージ57.86%▼：15秒間維持」
 *   … パーサは trigger=always として戦闘開始時に一度しか配らない。
 *     本来はフルバーストごとに更新なので、team.lastBurst（B3 の frame）を見て
 *     フルバースト開始のたびに貼り直す。
 *
 * 未実装: スキル1（最後の弾丸が命中した時）はパーサが lastBullet で処理済み。
 */
(function () {
  'use strict';

  (window.SPECIALS = window.SPECIALS || {})[91] = {
    init: function (u, E) {
      u._ludLastFBFrame = -1;
    },

    tick: function (u, E, frame) {
      var lb = u.team && u.team.lastBurst;
      if (lb && lb.stage === 'B3' && lb.frame !== u._ludLastFBFrame) {
        u._ludLastFBFrame = lb.frame;
        /* フルバースト中、受けるダメージ57.86%▼：15秒間維持 */
        E.buff(u, 'ludmilla-fb-taken', 'takenDmgPct', 57.86, 'down', frame + 15 * E.FPS, {});
      }
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) {
      if (u.hpMax <= 0 || u.hp * 2 < u.hpMax) return;  /* HP50%未満なら不発 */
      var team = E.alive(E.team(u));
      for (var i = 0; i < team.length; i++) {
        E.buff(team[i], 'ludmilla-def', 'defPct', 12.93, 'up', frame + 10 * E.FPS, {});
      }
    }
  };
})();
