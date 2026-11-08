/* レイ（仮称）(id 55 / org 147, AR, B3, 火力型, 風圧)
 *
 * 原文の状態機械:
 *   burst  : 自分に「攻撃態勢」（10秒）＋ 攻撃ダメージ35.9%（10秒）
 *   skill1 : 自分が攻撃態勢状態なら、通常攻撃が7回命中した時、
 *            対象に 286.37% の追加ダメージ（trigger=unknown でパーサは未発動）
 *   skill1 : 通常攻撃が18回命中した時、対象がアンチA.T.フィールド状態なら
 *            590.64% 追加ダメージ ＋ アンチA.T.フィールドスタック量 -10
 *   skill2 : フルバースト発動時、殲滅態勢状態の味方に
 *            殲滅態勢の追加効果適用対象1▲ / 攻撃範囲500%▲ / 攻撃力17.6%▲
 *
 * 実装するもの:
 *   - 攻撃態勢の状態（10秒）と、その間の7回命中ごとの286.37%
 *   - burst の攻撃ダメージ35.9%（パーサは unparsed）
 *   - 18回命中時のアンチA.T.フィールドスタック -10（Asuka id172 の atf 状態を読む）
 *
 * パーサが動かしているもの（触らない）:
 *   - 18回命中の590.64%（ただし「対象がアンチA.T.フィールド状態なら」の条件は
 *     パーサに無く無条件で発動する。付与済みダメージは取り消せないので放置）
 *   - skill1 の攻撃力17.6%（殲滅態勢の味方限定だが、パーサは味方全体に配る）
 *   - skill2 の攻撃力11.61%
 *
 * 実装しないもの:
 *   - 殲滅態勢の追加効果「適用対象1▲」「攻撃範囲500%▲」: Asuka(id172) 側の
 *     効果で、このファイルから相手の命中対象を増やす口が無い
 *   - マシンガン立ち上げ速度100%▲: MG の立ち上げを伸ばすステータスが engine に無い
 */
(function () {
  'use strict';

  /* E.pickTarget は README では (u, frame) だが engine の実装は (u, enemies, frame)。 */
  function pick(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  /* アンチA.T.フィールドのスタックを減らす（Asuka id172 が atfStacks / atfUntil を持つ）。 */
  function consumeAtf(u, E, target, amount, frame) {
    if (!target || !(target.atfUntil >= frame)) return 0;
    var cur = target.atfStacks || 0;
    if (cur <= 0) return 0;
    var left = Math.max(0, cur - amount);
    target.atfStacks = left;
    if (left <= 0) {
      target.atfUntil = -1;
      target.buffs = target.buffs.filter(function (b) { return b.key.indexOf('atf:') !== 0; });
    } else {
      for (var i = 0; i < target.buffs.length; i++) {
        var b = target.buffs[i];
        if (b.key.indexOf('atf:') === 0 && b.stat === 'takenDmgPct') b.value = 0.83 * left;
      }
    }
    E.event({ frame: frame, kind: 'atf-consume', side: u.side, unit: u.name,
              target: target.name, amount: cur - left });
    return cur - left;
  }

  (window.SPECIALS = window.SPECIALS || {})[55] = {
    init: function (u, E) {
      u.ray = { stanceUntil: -1 };
    },

    tick: function (u, E, frame) {
      var s = u.ray;
      if (!s) return;
      if (s.stanceUntil >= 0 && frame > s.stanceUntil) s.stanceUntil = -1;
    },

    onShot: function (u, E, frame, shot) {
      var s = u.ray;
      if (!s || !shot) return;
      var hits = u.counters.attackHits;

      /* 通常攻撃が18回命中した時（パーサが同じカウンタでダメージを撃つ）:
       * アンチA.T.フィールド状態ならスタックを10個ぶん減らす。 */
      if (hits > 0 && hits % 18 === 0) {
        consumeAtf(u, E, pick(u, E, frame), 10, frame);
      }

      /* 自分が攻撃態勢状態なら、通常攻撃が7回命中した時、
       * 対象に 最終攻撃力の286.37% の追加ダメージ。 */
      if (s.stanceUntil >= frame && hits > 0 && hits % 7 === 0) {
        var t = pick(u, E, frame);
        if (t && t.alive) E.damage(u, t, frame, { multiplierPct: 286.37 });
      }
    },

    onBurst: function (u, E, frame) {
      var s = u.ray;
      if (!s) return;
      /* 攻撃態勢：10秒間 */
      s.stanceUntil = frame + 10 * E.FPS;
      /* 攻撃ダメージ35.9%：10秒間維持（原文に▲が無くパーサが落としている） */
      E.buff(u, 'ray-attack-stance', 'atkDmgPct', 35.9, 'up', frame + 10 * E.FPS, {});
      E.event({ frame: frame, kind: 'ray-stance', side: u.side, unit: u.name });
    }
  };
})();
