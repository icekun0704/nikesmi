/* アークレンジャー・ブラック (id 222, AR, B3)
 *
 * パーサで表現できなかった部分:
 *   - バッテリー（0〜100%）と変身状態
 *       バッテリー100%で変身（攻撃力156.19%▲：解除不可）。
 *       変身中はバッテリーを 1% / 0.2秒 で消費し、0%で解除。
 *   - 変身状態が適用された時、敵全体へアークブラックコレダー
 *       （最終攻撃力45.87%の持続ダメージ：1秒間隔：変身解除まで）
 *   - バーストの バッテリー50% / 緊急チャージ（100%まで充電 → 変身 → 事後50%）
 *   - バーストの DoT「最終攻撃力の266.69%：1秒間隔：10秒間維持」は
 *     パーサが即時1発のダメージにしてしまっているので、残り9ティックをここで撃つ。
 *
 * 実装していないもの:
 *   - パーツ破壊によるバッテリー+50%：アリーナにはパーツが無い
 *   - パーツダメージ20%▲：engine にパーツの概念が無い（stat も無い）
 *   - スキル2の「風圧コードのARの味方全体に持続ダメージ77.5%▲」は
 *     fullBurst トリガの取り違えでパーサが戦闘開始時に10秒ぶん適用してしまう。
 *     二重計上を避けるため、ここでは触らない。
 */
(function () {
  'use strict';

  function state(u, E) {
    if (!u.arcBlack) {
      u.arcBlack = {
        battery: 0,
        transformed: false,
        drainNext: 0,
        corrodeNext: -1,
        dotTarget: null,
        dotNext: -1,
        dotLeft: 0
      };
    }
    return u.arcBlack;
  }

  function expire(u, key, stat, frame) {
    var bs = u.buffs || [];
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (b.key !== key) continue;
      if (stat && b.stat !== stat) continue;
      if (b.until > frame) b.until = frame;
    }
  }

  function startTransform(u, E, frame) {
    var s = state(u, E);
    s.transformed = true;
    // バッテリー1%▼：0.2秒間隔
    s.drainNext = frame + 12;
    // アークブラックコレダー：1秒間隔
    s.corrodeNext = frame + 60;
    E.buff(u, 'arc-black-transform', 'atkPct', 156.19, 'up', Infinity);
    E.event({ frame: frame, kind: 'transform', side: u.side, unit: u.name });
  }

  function endTransform(u, E, frame) {
    var s = state(u, E);
    s.transformed = false;
    s.corrodeNext = -1;
    expire(u, 'arc-black-transform', 'atkPct', frame);
    E.event({ frame: frame, kind: 'transform-end', side: u.side, unit: u.name });
  }

  (window.SPECIALS = window.SPECIALS || {})[222] = {
    init: function (u, E) {
      state(u, E);
    },

    tick: function (u, E, frame) {
      var s = state(u, E);

      if (s.transformed) {
        // バッテリーを 1%/0.2秒 で消費する
        if (frame >= s.drainNext) {
          s.drainNext = frame + 12;
          s.battery -= 1;
          if (s.battery <= 0) {
            s.battery = 0;
            endTransform(u, E, frame);
          }
        }
        // アークブラックコレダー（変身解除まで）
        if (s.transformed && frame >= s.corrodeNext) {
          s.corrodeNext = frame + 60;
          var foes = E.alive(E.enemies(u));
          for (var i = 0; i < foes.length; i++) {
            E.damage(u, foes[i], frame, { multiplierPct: 45.87, isSustained: true });
          }
        }
      }

      // バーストの持続ダメージの残りティック
      if (s.dotLeft > 0 && frame >= s.dotNext) {
        s.dotNext = frame + 60;
        var t = s.dotTarget;
        if (t && t.alive) {
          E.damage(u, t, frame, { multiplierPct: 266.69, isSustained: true });
        }
        s.dotLeft -= 1;
        if (s.dotLeft <= 0) s.dotTarget = null;
      }
    },

    onBurst: function (u, E, frame) {
      var s = state(u, E);

      if (s.transformed) {
        // 自分が変身状態なら、自分にバッテリー50%
        s.battery = Math.min(100, s.battery + 50);
      } else {
        // バッテリー緊急チャージ：100%まで充電 → 変身 → 変身後50%
        s.battery = 100;
        startTransform(u, E, frame);
        s.battery = 50;
      }

      // 最終最大HPが最も高い敵1機への DoT（パーサが1ティック済み）
      var foes = E.alive(E.enemies(u));
      var target = null;
      for (var i = 0; i < foes.length; i++) {
        if (!target || foes[i].hpMax > target.hpMax) target = foes[i];
      }
      s.dotTarget = target;
      s.dotNext = frame + 60;
      s.dotLeft = 9;
    }
  };
})();
