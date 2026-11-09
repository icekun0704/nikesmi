/* シンデレラ (id 169, RL, B3)
 *
 * パーサで表現できなかった部分:
 *   - デコイ（戦闘開始時／バースト3段階突入時、最終最大HP96%の分身：持続）。
 *     engine にデコイの受け皿が無いので「デコイが存在する」フラグとして持つ。
 *   - 「デコイが存在する時3秒ごとに自分に 美しさ：最大HP1.6%▲：12スタック：持続」
 *     （trigger:unknown）。3秒ごとにスタックを1つ積む（上限12）。
 *   - バースト「ランダムな敵に 最終攻撃力の1365.92%のダメージ：10回順番に攻撃」
 *     パーサは1回ぶんのダメージにしかしていないので、残り9回をここで撃つ。
 *   - バースト「自分が美しさをスタックしている場合、同じ敵に
 *     最終攻撃力の28.9%の追加ダメージ：美しさスタックコピー」
 *     パーサは28.9%を敵全体へ1回だけ付与している。ここでは
 *     「スタック数ぶん」のうち未適用の (スタック数 - 1) 回ぶんを追加する。
 *
 * 実装していないもの:
 *   - スキル1「チャージ速度100%▲：最大弾数リロード完了時に解除」。
 *     engine のチャージ速度は buildSchedule 時に確定しており（u.firing を
 *     作り直す口が無い）、RL は magazine=Infinity でリロードが起きない。
 *   - デコイの被弾肩代わり／デコイのHP。
 */
(function () {
  'use strict';

  function st(u) {
    if (!u.cinderella) {
      u.cinderella = { decoy: false, nextBeauty: 3 * 60, idx: 0 };
    }
    return u.cinderella;
  }

  function beautyStacks(u) {
    var bs = u.buffs || [];
    for (var i = 0; i < bs.length; i++) {
      if (bs[i].key === 'beauty' && bs[i].until >= u.now) return bs[i].stacks || 1;
    }
    return 0;
  }

  (window.SPECIALS = window.SPECIALS || {})[169] = {
    /* 1365.92% を10回順番に撃つ処理はここで実装している */
    /* 美しさのスタックはここで実装している */
  suppress: { burst: [0], skill2: [2] },
    init: function (u, E) {
      st(u).decoy = true;   // 戦闘開始時のデコイ
    },

    tick: function (u, E, frame) {
      var s = st(u);

      // バースト3段階突入時にもデコイを展開し直す
      var lb = (E.team(u) || []).lastBurst;
      if (lb && lb.stage === 'B3' && lb.frame === frame) s.decoy = true;

      // デコイが存在する時3秒ごとに 美しさ +1スタック（最大12）
      if (s.decoy && frame >= s.nextBeauty) {
        s.nextBeauty = frame + 3 * E.FPS;
        E.buff(u, 'beauty', 'maxHpPct', 1.6, 'up', Infinity, { maxStacks: 12 });
      }
    },

    onBurst: function (u, E, frame) {
      var s = st(u);
      var foes = E.alive(E.enemies(u));
      if (!foes.length) return;

      var stacks = beautyStacks(u);
      var extra = 28.9 * Math.max(0, stacks - 1);   // パーサが1回ぶんは適用済み

      // 10回のうち残り9回
      for (var i = 0; i < 9; i++) {
        if (!foes.length) break;
        var t = foes[s.idx % foes.length];
        s.idx += 1;
        if (!t.alive) continue;
        E.damage(u, t, frame, { multiplierPct: 1365.92 });
        if (extra > 0) E.damage(u, t, frame, { multiplierPct: extra });
      }
      E.event({ frame: frame, kind: 'cinderella-burst', side: u.side, unit: u.name,
                stacks: stacks });
    }
  };
})();
