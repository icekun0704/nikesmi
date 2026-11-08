/* エクシア（宝物）(id 100, SR, B1, 支援型, 電撃)
 *
 * 宝物版の読み替え（Treasure1）:
 *   - ハッキングコード収集の発生条件は「フルチャージ攻撃が命中した時」
 *   - 攻撃力16.8%→28%、持続15秒→5秒
 *
 * パーサで表現できなかった部分:
 *   - ハッキングコード収集のスタック（攻撃力28%▲・5スタック・5秒）そのもの
 *     （パーサのブロックは trigger=unknown）
 *   - バースト「自分がハッキングコード収集のフルスタック状態なら、同じ敵に
 *     最終攻撃力122.32%の追加ダメージ + 受けるダメージ18.04%▲（宝物2）」の条件。
 *     パーサは追加ダメージを無条件のバースト効果にしているので、その効果を外して
 *     フルスタック時だけ自前で与える。
 *
 * 実装していないもの:
 *   - skill1「最後の弾丸が命中した時…攻撃力/防御力13.77%▼」: engine の SR は
 *     リロードしない（magazine=Infinity）ため lastBullet が発生しない。
 *   - skill2 の電撃コード味方全体への攻撃力5.8%▲ も同じ理由で発生しない。
 *   - skill1 宝物3「リロード速度95%増加状態で固定10秒」: フルバースト開始を
 *     外から観測する手段が無い。
 */
(window.SPECIALS = window.SPECIALS || {})[100] = {
  init: function (u, E) {
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (src) {
      u.skills = JSON.parse(JSON.stringify(src));
      for (var s = 0; s < u.skillState.length; s++) {
        var st = u.skillState[s];
        var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
        if (!arr) continue;
        for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
      }
      /* フルスタック条件を外すため、無条件の追加ダメージは自前実装に置き換える */
      if (u.skills.burst && u.skills.burst.blocks[1]) {
        u.skills.burst.blocks[1].effects = [];
      }
    }
    u.exia = { hcsUntil: 0 };
  },

  tick: function (u, E, frame) {
    var x = u.exia;
    if (!x) return;
    /* 5秒たったスタックは消える（buff の期限で処理されるので状態だけ更新） */
    if (x.hcsUntil < frame) x.hcsUntil = 0;
  },

  onShot: function (u, E, frame, shot) {
    var x = u.exia;
    if (!x) return;
    /* 宝物版: フルチャージ攻撃（=SRの通常攻撃）が命中するたびに
     * ハッキングコード収集 攻撃力28%▲ を1スタック（最大5、5秒） */
    x.hcsUntil = frame + 5 * E.FPS;
    E.buff(u, 'exia-hcs', 'atkPct', 28, 'up', x.hcsUntil, { maxStacks: 5 });
  },

  onBurst: function (u, E, frame) {
    var x = u.exia;
    if (!x) return;
    var stacks = 0;
    for (var i = 0; i < u.buffs.length; i++) {
      if (u.buffs[i].key === 'exia-hcs') stacks = u.buffs[i].stacks || 1;
    }
    if (stacks < 5) return;

    /* 同じ敵（防御力が最も高い敵）へ 122.32%の追加ダメージ + 被ダメ18.04%▲10秒 */
    var foes = E.alive(E.enemies(u));
    foes.sort(function (a, b) { return b.def - a.def; });
    for (var k = 0; k < foes.length; k++) {
      var t = foes[k];
      E.damage(u, t, frame, { multiplierPct: 122.32, isBurst: true });
      E.buff(t, 'exia-burst:' + u.pos + ':' + t.pos, 'takenDmgPct', 18.04, 'up',
        frame + 10 * E.FPS, {});
    }
    E.event({ frame: frame, kind: 'exia-fullstack-burst', side: u.side, unit: u.name });
  }
};
