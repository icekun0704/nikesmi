/* ベスティー (id 41, RL, B3, 火力型)
 *
 * パーサで表現できなかった部分:
 *   - 生存本能の段階（1回目/2回目/3回目のバーストで段階が上がり、
 *     「下位効果スタック適用」なので段階以下の効果がすべて乗る）。
 *     パーサは3段階ぶんを毎回すべて適用してしまうため、
 *     このユニット専用にスキル定義を複製し、段階に応じて効果を絞る。
 *       · バーストの敵全体ダメージ 210.62 / 247.25 / 302.19
 *       · skill2 の 攻撃力5.35 / クリティカルダメージ22.34 / クリティカル確率15.51
 *   - ミサイルコンテナ2機: バースト後、HPが最も低い敵へ15.56%を1秒間隔で18秒間
 *     （パーサはバースト時の1発だけを適用しているので、2秒目以降をここで撃つ）
 *
 * 実装していないもの:
 *   - 「フルバーストタイム5秒▼」: フルバーストの残り時間を engine の外から
 *     縮める手段が無い（state は API に公開されていない）。
 */
(window.SPECIALS = window.SPECIALS || {})[41] = {
  init: function (u, E) {
    /* スキル定義をこのユニット専用に複製する（SKILL_DB は全ユニット共有なので触らない） */
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (src) {
      u.skills = JSON.parse(JSON.stringify(src));
      for (var s = 0; s < u.skillState.length; s++) {
        var st = u.skillState[s];
        var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
        if (!arr) continue;
        for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
      }
    }
    u.vestie = {
      uses: 0, missileUntil: -1, missileNext: -1,
      /* 段階で絞る前の効果（バーストで毎回切り直すため元を保持する） */
      stageDmg: u.skills && u.skills.burst && u.skills.burst.blocks[1]
        ? u.skills.burst.blocks[1].effects.slice() : [],
      skill2Eff: u.skills && u.skills.skill2 && u.skills.skill2.blocks[0]
        ? u.skills.skill2.blocks[0].effects.slice() : []
    };
  },

  tick: function (u, E, frame) {
    var v = u.vestie;
    if (!v || v.missileNext < 0) return;
    if (frame < v.missileNext || frame > v.missileUntil) return;
    v.missileNext = frame + 60;
    var foes = E.alive(E.enemies(u));
    if (!foes.length) return;
    foes.sort(function (a, b) { return a.hp - b.hp; });
    var target = foes[0];
    /* ミサイルコンテナ2機ぶん */
    E.damage(u, target, frame, { multiplierPct: 15.56 });
    if (target.alive && foes.length) E.damage(u, target, frame, { multiplierPct: 15.56 });
  },

  onBurst: function (u, E, frame) {
    var v = u.vestie;
    if (!v) return;
    v.uses += 1;
    var stage = Math.min(3, v.uses);   // 生存本能の段階

    /* バースト効果（runTriggered）はこのあと同フレームで走る。
     * 段階以下の効果だけを残す（下位効果スタック適用）。 */
    if (u.skills && u.skills.burst && u.skills.burst.blocks[1] && v.stageDmg.length) {
      u.skills.burst.blocks[1].effects = v.stageDmg.slice(0, stage);
    }
    if (u.skills && u.skills.skill2 && u.skills.skill2.blocks[0] && v.skill2Eff.length) {
      u.skills.skill2.blocks[0].effects = v.skill2Eff.slice(0, stage);
    }

    /* ミサイルコンテナ: 1秒間隔・18秒間（攻撃間隔1秒） */
    v.missileNext = frame + 60;
    v.missileUntil = frame + 18 * E.FPS;
    E.event({ frame: frame, kind: 'vestie-missiles', side: u.side, unit: u.name, stage: stage });
  }
};
