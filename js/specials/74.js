/* アルカナ：フォーチュンメイト (id 74 / org 185, SG, B2, 火力型, 灼熱)
 *
 * 原文の状態機械:
 *   burst  : 自分に「思い出作り」（持続。skill1 の「フルバーストタイムが終了した時、
 *            自分に 思い出作り解除 / 青春の記録解除」で解除）
 *   skill2 : 通常攻撃時、自分が思い出作り状態なら、攻撃回数別の効果
 *            2回: 弾丸チャージ6発 / 4回: 幸せな思い出（ペレット+1・3スタック）/
 *            6回: 大切な思い出（攻撃力2.49%▲・3スタック）
 *            「思い出作り解除時初期化」
 *   skill1 : フルバースト終了時、SGの味方全体に
 *            攻撃力13% × 大切な思い出のスタック数（発動者基準）
 *
 * パーサが動かしているもの（触らない）:
 *   - burst の クリティカル確率20.09% / 攻撃ダメージ29.99%（持続）
 *   - skill2 の攻撃回数別の数値効果（ただしパーサは trigger=attack で毎回すべて配る）
 *   - skill2 のSG味方への攻撃ダメージ55%（10秒）
 *
 * 実装するもの:
 *   - 思い出作り状態と、フルバースト終了時の解除
 *   - 解除時に burst の2バフ（クリティカル／攻撃ダメージ）を外す
 *   - 大切な思い出のスタック数を数え、解除時にSG味方へ 13%×スタック を配る
 *
 * 実装しないもの:
 *   - 青春の記録（通常攻撃ダメージ10%倍率▲・3スタック）:
 *     通常攻撃だけに掛かる倍率のステータスが engine に無い
 *     （atkDmgPct で代用するとバーストにも乗ってしまうため触らない）
 */
(function () {
  'use strict';

  var FB_FRAMES = 10 * 60;

  function st(u) {
    if (!u.arcana) {
      u.arcana = {
        active: false,
        attacks: 0,
        precious: 0,     // 大切な思い出のスタック数（最大3）
        fbSeen: -1,
        fbEnd: -1
      };
    }
    return u.arcana;
  }

  (window.SPECIALS = window.SPECIALS || {})[74] = {
    init: function (u, E) {
      st(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);

      /* フルバースト終了の検出。B3 バーストの10秒後。 */
      var team = E.team(u) || [];
      var lb = team.lastBurst;
      if (lb && lb.stage === 'B3' && lb.frame !== s.fbSeen) {
        s.fbSeen = lb.frame;
        s.fbEnd = lb.frame + FB_FRAMES;
      }
      if (s.active && s.fbEnd >= 0 && frame >= s.fbEnd) {
        endMemory(u, E, frame, s);
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = st(u);
      if (!s.active) return;
      s.attacks += 1;
      /* 6回目ごとに 大切な思い出 1スタック（最大3）。 */
      if (s.attacks % 6 === 0 && s.precious < 3) s.precious += 1;
    },

    onBurst: function (u, E, frame) {
      var s = st(u);
      /* 思い出作り：burst 自身で開始。解除はフルバースト終了時。 */
      s.active = true;
      s.attacks = 0;
      s.precious = 0;
      s.fbEnd = -1;
      E.event({ frame: frame, kind: 'arcana-memory', side: u.side, unit: u.name });
    }
  };

  function endMemory(u, E, frame, s) {
    s.active = false;
    s.fbEnd = -1;

    /* burst でパーサが置いた クリティカル確率 / 攻撃ダメージ を解除。
     * engine のキーは <side><pos>:<slot>:<block> だが、現状 slot が undefined に
     * なっているため両方の形を受ける。 */
    var base = u.side + u.pos + ':';
    function burstBlock0(b, stat) {
      if (b.stat !== stat) return false;
      return b.key.indexOf(base + 'burst:0:') === 0 ||
        b.key.indexOf(base + 'undefined:0:') === 0;
    }
    u.buffs = u.buffs.filter(function (b) {
      return !(burstBlock0(b, 'critRate') || burstBlock0(b, 'atkDmgPct'));
    });

    /* フルバースト終了時、SGの味方全体に 攻撃力13%×大切な思い出スタック数
     * （スキル発動者基準 = 発動者の最終攻撃力の13%を固定値で加算） */
    if (s.precious > 0) {
      var amount = E.atkEff(u) * 0.13 * s.precious;
      var allies = E.alive(E.team(u));
      for (var i = 0; i < allies.length; i++) {
        var a = allies[i];
        if (a.weapon !== 'SG') continue;
        E.buff(a, 'arcana-memory-atk:' + u.side + u.pos + ':' + a.pos,
          'atkFlat', amount, 'up', frame + 15 * E.FPS, {});
      }
    }

    E.event({ frame: frame, kind: 'arcana-memory-end', side: u.side, unit: u.name,
              stacks: s.precious });
    s.attacks = 0;
    s.precious = 0;
  }
})();
