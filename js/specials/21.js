/* ノワール (id 21 / org 89, SG, B3, 火力型)
 *
 * パーサで表現できていない部分:
 *   - スキル1「自分のHPが70%以上なら味方全体に
 *       スキル発動者基準で攻撃力14.08%▲」
 *     条件付きパッシブ (trigger:unknown + conditions) で落ちており、
 *     パーサは一度も発動しない。HP70%以上のあいだ、味方全体へ
 *     ノワールの最終攻撃力の14.08%を固定値で足す。
 *   - スキル2「フルバーストタイムが発動した時、味方全体に
 *       弾丸チャージ39.88%」
 *     op:bulletCharge は engine の applyEffect が知らないので捨てられている。
 *     フルバースト開始時に、味方の装弾を1マガジンの39.88%ぶん即座に戻す。
 *     （最大装弾数+5発のほうはパーサが magazineFlat で処理済み）
 *
 * パーサが処理済みなので触らないもの:
 *   - バーストの敵全体351.64%ダメージ、SG持ちへの命中率/阻止部位ダメージ、
 *     同じ部隊の味方がいる場合の命中率/阻止部位ダメージ
 *     （命中率・阻止部位ダメージは engine が読まない stat なので数値のみ保持）
 */
(function () {
  'use strict';

  var ATK_BASIS_PCT = 14.08;      /* 原文: スキル発動者基準で攻撃力14.08%▲ */
  var HP_THRESHOLD = 70;          /* 原文: 自分のHPが70%以上 */
  var RELOAD_PCT = 0.3988;        /* 原文: 弾丸チャージ39.88% */

  (window.SPECIALS = window.SPECIALS || {})[21] = {
    init: function (u, E) {
      u.noir = { fbFrame: -1, lastBurstFrame: -1 };
    },

    tick: function (u, E, frame) {
      var s = u.noir;
      if (!s) return;

      /* ---- スキル1: HP70%以上で味方全体に攻撃力+14.08%（発動者基準） */
      if (u.hpMax > 0 && u.hp / u.hpMax * 100 >= HP_THRESHOLD) {
        var flat = E.atkEff(u) * ATK_BASIS_PCT / 100;
        var allies = E.alive(E.team(u));
        for (var i = 0; i < allies.length; i++) {
          E.buff(allies[i], 'noir-lucky-charm', 'atkFlat', flat, 'up',
            frame + 2, { aura: true });
        }
      }

      /* ---- フルバーストタイムの発動（直前のバーストが B3） */
      var lb = E.team(u).lastBurst;
      if (lb && lb.frame !== s.lastBurstFrame) {
        s.lastBurstFrame = lb.frame;
        if (lb.stage === 'B3') {
          s.fbFrame = lb.frame;
          reloadAllies(u, E, frame);
        }
      }
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) { }
  };

  /* 味方全体の装弾を1マガジンの39.88%ぶん即座に戻す */
  function reloadAllies(u, E, frame) {
    var allies = E.alive(E.team(u));
    for (var i = 0; i < allies.length; i++) {
      var m = allies[i].firing;
      if (!m || !isFinite(m.magazine) || m.magazine <= 0) continue;
      var back = m.magazine * RELOAD_PCT;
      if (back > 0) m.shotsInMagazine = Math.max(0, m.shotsInMagazine - back);
    }
    E.event({ frame: frame, kind: 'noir-reload', side: u.side, unit: u.name });
  }
})();
