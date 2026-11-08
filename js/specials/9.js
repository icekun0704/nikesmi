/* ルマニ (id 9, RL, B1, 防御型)
 *
 * パーサで表現できなかった部分:
 *   - バースト「自分がマッスルアップのフルスタック状態なら」の条件。
 *     パーサは被ダメ20.06%▼を無条件のバースト効果として置いているので、
 *     スタックが5未満で発動したフレームではそのバフを外す。
 *     （マッスルアップ本体＝最大HP3.04%×5スタック/2秒 はパーサが処理済み）
 *
 * 実装していないもの:
 *   - skill1「フルバーストタイムの持続中にフルチャージ攻撃が命中した時、対象に挑発5秒」
 *     API（E）にフルバースト状態の参照が無いため、条件を判定できない。
 *   - skill2「パーツダメージ10.05%▲」: アリーナにはパーツ（コアヒット）が無い。
 *   - バースト「通常攻撃ダメージ10.05%倍率▲」: engine に通常攻撃だけを変える
 *     倍率フックが無い（atkDmgPct で代用するとスキルダメージまで変わるため触らない）。
 */
(window.SPECIALS = window.SPECIALS || {})[9] = {
  init: function (u, E) {
    u.rumani = { checkFrame: -1 };
  },

  tick: function (u, E, frame) {
    var r = u.rumani;
    if (!r || frame !== r.checkFrame) return;
    r.checkFrame = -1;

    /* マッスルアップのスタック数（パーサが skill1 block0 で張っているバフ） */
    var stackKey = u.side + u.pos + ':undefined:0:stat:maxHpPct';
    var stacks = 0;
    for (var i = 0; i < u.buffs.length; i++) {
      if (u.buffs[i].key.indexOf(stackKey) === 0) stacks = u.buffs[i].stacks || 1;
    }
    if (stacks >= 5) return;

    /* フルスタックでないので、バーストの被ダメ20.06%▼（burst block2）を取り消す */
    var rootKey = u.side + u.pos + ':undefined:2:stat:takenDmgPct';
    u.buffs = u.buffs.filter(function (b) { return b.key.indexOf(rootKey) !== 0; });
    E.event({ frame: frame, kind: 'rumani-not-fullstack', side: u.side, unit: u.name, stacks: stacks });
  },

  onBurst: function (u, E, frame) {
    if (!u.rumani) return;
    /* バースト効果の適用（runTriggered）はこのあと同フレームで走るので、
     * tick で判定する */
    u.rumani.checkFrame = frame;
  }
};
