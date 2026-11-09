/* エード：エージェントバニー (id 115, SR, B2, 支援型)
 *
 * パーサで表現できなかった部分:
 *   - 「フルチャージ攻撃が適正射程距離内の対象に命中した時」の2ブロック。
 *     アリーナには適正距離補正が無い（README）ので、全命中が条件を満たすものとして
 *     フルチャージ攻撃のたびに発動させる。パーサは trigger=unknown で一度も動かない。
 *       ・味方全体に 攻撃力15.2%（発動者基準 = 最終攻撃力の15.2%を固定値で加算）5秒
 *       ・味方全体に 貫通ダメージ18.36% 5秒
 *   - 隠しレンズ（適正最小射程距離 +4.44%・10スタック・5秒）。
 *     距離そのものはアリーナに無いので数値は捨て、スタック数だけを数える。
 *   - 隠しレンズがフルスタックのとき、自分に 貫通特化（攻撃力16%・持続）。
 *     パーサは trigger=unknown のため発動しない。
 */
(window.SPECIALS = window.SPECIALS || {})[115] = {
  /* 貫通ダメージバフはここで実装している */
  suppress: { skill2: [0] },
  init: function (u, E) {
    u.ade = {
      lens: 0,
      lensAt: -9999,
      full: false
    };
  },

  tick: function (u, E, frame) {
    var s = u.ade;
    if (!s) return;

    /* 隠しレンズは5秒で消える */
    if (s.lens > 0 && frame > s.lensAt + 5 * E.FPS) s.lens = 0;

    /* フルスタックのあいだ貫通特化（攻撃力16%）を維持 */
    if (s.lens >= 10) {
      if (!s.full) {
        s.full = true;
        E.event({ frame: frame, kind: 'ade-full-lens', side: u.side, unit: u.name });
      }
      E.buff(u, 'ade-pierce-spec', 'atkPct', 16, 'up', frame + 2, {});
    } else if (s.full) {
      s.full = false;
      u.buffs = u.buffs.filter(function (b) { return b.key !== 'ade-pierce-spec'; });
    }
  },

  onShot: function (u, E, frame, shot) {
    var s = u.ade;
    if (!s) return;

    /* フルチャージ攻撃（RL/SR の通常攻撃）が命中したとき */
    var allies = E.alive(E.team(u));
    var atkFlat = E.atkEff(u) * 0.152;
    for (var i = 0; i < allies.length; i++) {
      var a = allies[i];
      E.buff(a, 'ade-atk', 'atkFlat', atkFlat, 'up', frame + 5 * E.FPS, { label: 'エージェントバニー' });
      E.buff(a, 'ade-pierce', 'pierceDmgPct', 18.36, 'up', frame + 5 * E.FPS, {});
    }

    /* 隠しレンズ +1（最大10） */
    s.lens = Math.min(10, s.lens + 1);
    s.lensAt = frame;
  },

  onBurst: function () { /* バースト効果はパーサが処理済み（距離系はアリーナでは無効） */ }
};
