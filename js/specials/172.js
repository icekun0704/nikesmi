/* アスカ：WILLE (id 172, MG, B3)
 *
 * パーサで表現できなかった部分:
 *   - 殲滅態勢（バーストで9秒間。パーサは「機能：」行を unparsed にしているだけ）
 *   - 殲滅態勢中の「10発ごとに照準線に最も近い攻撃範囲内の敵2機」への
 *     15.62% ダメージ + アンチA.T.フィールド（被ダメ +0.83%/スタック、30スタック、30秒）
 *   - 殲滅態勢終了時、アンチA.T.フィールド中の敵への 6.62% × スタック数 の追加ダメージと解除
 *   - 「殲滅の効果発動時」の自己回復（最大HP 3.77%、1秒間隔・3秒）＝ skill2 block2 の
 *     trigger が unknown なのでパーサからは発動しない
 *
 * 実装していないもの（engine 側に受け皿が無い）:
 *   - 通常攻撃ダメージ40%倍率▼ : 通常攻撃ダメージだけを下げるフックが無い
 *     （atkDmgPct を下げるとパース済みの「攻撃ダメージ36%▲」まで壊れるため触らない）
 *   - マシンガン立ち上げ速度▼ / 残弾数減少 / リロード速度固定 : MG のモデルが無い
 */
(window.SPECIALS = window.SPECIALS || {})[172] = {
  init: function (u, E) {
    u.asuka = {
      stanceUntil: -1,   // 殲滅態勢の終了フレーム
      bullets: 0,        // 殲滅態勢中に撃った弾数（10発ごとに追加攻撃）
      healUntil: -1,
      healNext: -1
    };
  },

  tick: function (u, E, frame) {
    var s = u.asuka;
    if (!s) return;

    /* 殲滅態勢が終了したフレーム:
     *   アンチA.T.フィールド状態の敵へ「個別対象ごとにスタックコピー」分の追加ダメージ。
     *   1スタック = 最終攻撃力の6.62% の追加ダメージ 1回ぶん。適用後に解除。 */
    if (s.stanceUntil >= 0 && frame > s.stanceUntil) {
      var foes = E.alive(E.enemies(u));
      for (var i = 0; i < foes.length; i++) {
        var e = foes[i];
        var stacks = (e.atfUntil >= frame) ? (e.atfStacks || 0) : 0;
        if (!stacks) continue;
        E.damage(u, e, frame, { multiplierPct: 6.62 * stacks });
        E.event({ frame: frame, kind: 'atf-detonate', side: u.side, unit: u.name,
                  target: e.name, stacks: stacks });
        e.atfStacks = 0;
        e.atfUntil = -1;
      }
      s.stanceUntil = -1;

      /* 殲滅の効果発動時（=殲滅態勢の終了時）の自己回復。
       * スキル発動者の最終最大HPの3.77%を1秒間隔で3秒間。 */
      s.healUntil = frame + 3 * E.FPS;
      s.healNext = frame;
    }

    if (s.healNext >= 0 && frame >= s.healNext) {
      E.heal(u, u.hpMax * 0.0377, frame);
      s.healNext = frame + 60;
      if (s.healNext > s.healUntil) { s.healNext = -1; s.healUntil = -1; }
    }
  },

  onShot: function (u, E, frame, shot) {
    var s = u.asuka;
    /* 自分が殲滅態勢状態の時に限り、10発ごとに照準線に最も近い攻撃範囲内の敵2機へ
     * 15.62% のダメージ + アンチA.T.フィールド 1スタック */
    if (!s || frame > s.stanceUntil) return;
    s.bullets += shot.hits;
    while (s.bullets >= 10) {
      s.bullets -= 10;
      var foes = E.alive(E.enemies(u));
      if (!foes.length) return;
      var prim = E.pickTarget(u, E.enemies(u), frame);
      var p = prim ? prim.pos : 0;
      var cand = E.slotsInRange(foes, p, 1);
      if (cand.length < 2) cand = foes.slice();
      cand.sort(function (a, b) { return Math.abs(a.pos - p) - Math.abs(b.pos - p); });
      cand = cand.slice(0, 2);
      for (var i = 0; i < cand.length; i++) {
        var t = cand[i];
        E.damage(u, t, frame, { multiplierPct: 15.62 });
        var cur = (t.atfUntil >= frame) ? (t.atfStacks || 0) : 0;
        cur = Math.min(30, cur + 1);
        t.atfStacks = cur;
        t.atfUntil = frame + 30 * E.FPS;
        E.buff(t, 'atf:' + u.pos + ':' + t.pos, 'takenDmgPct',
          0.83 * cur, 'up', frame + 30 * E.FPS, {});
      }
    }
  },

  onBurst: function (u, E, frame) {
    if (!u.asuka) return;
    /* 殲滅態勢: 効果1〜4 はすべて9秒間維持なのでモードの長さも9秒。
     * 効果3・4（攻撃力46.8%▲ / 攻撃ダメージ36%▲）はパーサが適用済み。 */
    u.asuka.stanceUntil = frame + 9 * E.FPS;
    u.asuka.bullets = 0;
  }
};
