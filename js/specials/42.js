/* ベイ (id 42, RL, B2, 防御型) — 宝物なし
 *
 * パーサで表現できなかった部分:
 *   - skill1「バーストスキルを使用した時、自分が生存している限り、味方全体に
 *     受けるダメージ偏差分配：持続」と、skill2 の同じ行（自分の遮蔽物に）が
 *     unparsed。engine の shareDamage は「均等割」で、パーサが作る op 名も
 *     『受けるダメージ均等分配』しか拾わないため『偏差分配』が落ちている。
 *     ここでは engine の shareGroup を直接組み立てて、ベイが生存している間
 *     味方全体でダメージを分配する。
 *
 * 不明点:
 *   - 「偏差」の配分式は原文に記述が無い（均等割 / HP比 / 被害比のどれか不明）。
 *     エンジンが均等割しか実装していないため均等割のままにしている。
 *   - ベイが戦闘不能になった後、味方に残った shareGroup を解除するフックが
 *     エンジンに無い（tick は生存中しか呼ばれない）。以降は生存者の間で
 *     分配が続く点が厳密には誤り。
 *
 * パーサは解釈しているが engine に処理が無いため、ここでは扱っていないもの:
 *   - burst「遮蔽物HP20%で遮蔽物復活」（宝物3行）
 *   - burst「遮蔽物最大HP18%▲ 20秒」「フルバースト終了時の遮蔽物HP持続回復2.88%」
 *     （op coverStat は applyEffect に case が無い）
 */
(function () {
  'use strict';

  (window.SPECIALS = window.SPECIALS || {})[42] = {
    init: function (u, E) {
      u.bay = { active: false };
    },

    tick: function (u, E, frame) {
      var b = u.bay;
      if (!b || !b.active || !u.alive) return;

      var group = [u];
      var allies = E.alive(E.team(u));
      for (var i = 0; i < allies.length; i++) {
        if (allies[i] !== u) group.push(allies[i]);
      }
      if (group.length < 2) return;
      for (var k = 0; k < group.length; k++) group[k].shareGroup = group;
    },

    onShot: function (u, E, frame, shot) {},

    onBurst: function (u, E, frame) {
      if (u.bay) u.bay.active = true;
    }
  };
})();
