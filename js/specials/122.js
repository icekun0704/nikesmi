/* サクラ (id 122, SR, B1, 支援型)
 *
 * パーサで表現できなかった部分:
 *   - 桜茶のスタック: 「通常攻撃で3回攻撃したとき、味方全体に 防御力8.15%▲：10スタック：15秒」
 *     パーサは trigger を always として戦闘開始時に1スタックだけ置いてしまうので、
 *     それを取り消して自分で3攻撃ごとにスタックを積む。
 *   - バースト「風圧コードの敵から受けるダメージ90.72%▼：戦闘中1回発動」の
 *     maxTriggers=1（2回目以降のバーストでは再付与しない）。
 *     ※ engine の takenDmgPct は属性を問わず効くため、風圧以外の相手にも軽減が乗る。
 *
 * 実装していないもの:
 *   - 「敵の発射体を攻撃する時、該当の発射体に与えるダメージ7.74%▲」
 *     （アリーナシミュレータに発射体そのものが無い）
 *   - 「阻止部位の攻撃ダメージ23.54%▲」（パーツ／コアヒットが無い）
 */
(window.SPECIALS = window.SPECIALS || {})[122] = {
  init: function (u, E) {
    u.sakura = { shots: 0, stacks: 0, burstApplied: 0, initDone: false };
  },

  tick: function (u, E, frame) {
    var s = u.sakura;
    if (!s) return;

    /* 戦闘開始時にパーサが置いた桜茶（1スタック）を取り消して自前管理に切り替える */
    if (!s.initDone) {
      s.initDone = true;
      var rootKey = u.side + u.pos + ':undefined:0:stat:defPct';
      var allies = E.team(u);
      for (var i = 0; i < allies.length; i++) {
        var a = allies[i];
        a.buffs = a.buffs.filter(function (b) { return b.key.indexOf(rootKey) !== 0; });
      }
    }

    /* 2回目以降のバーストでは「風圧コードの敵から受けるダメージ▼」を再付与しない
     * （バースト効果は同フレームのうちにパーサが適用済みなので、ここで外す） */
    if (s.burstApplied > 1 && s.burstFrame === frame) {
      var dmgKey = u.side + u.pos + ':burst:0:stat:takenDmgPct';
      var list = E.team(u);
      for (var k = 0; k < list.length; k++) {
        var m = list[k];
        m.buffs = m.buffs.filter(function (b) { return b.key.indexOf(dmgKey) !== 0; });
      }
      s.burstFrame = -1;
    }
  },

  onShot: function (u, E, frame, shot) {
    var s = u.sakura;
    if (!s) return;
    s.shots += 1;
    if (s.shots % 3 !== 0) return;
    /* 桜茶 1スタック（最大10、15秒）を味方全体へ */
    s.stacks = Math.min(10, s.stacks + 1);
    var allies = E.alive(E.team(u));
    for (var i = 0; i < allies.length; i++) {
      var a = allies[i];
      E.buff(a, 'sakura-cha:' + u.side + u.pos + ':' + a.pos, 'defPct',
        8.15, 'up', frame + 15 * E.FPS, { maxStacks: 10 });
    }
  },

  onBurst: function (u, E, frame) {
    var s = u.sakura;
    if (!s) return;
    s.burstApplied += 1;
    s.burstFrame = frame;
  }
};
