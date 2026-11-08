/* リバーレリオ (id 26 / org 174, SR, B3, 火力型)
 *
 * パーサで表現できていない部分:
 *   - スキル1「フルチャージ攻撃が命中した時、対象に
 *       最終攻撃力の40.5%の追加ダメージ：5回発動」
 *     パーサは fullChargeShot で1回ぶんしか撃たない。原文の「5回発動」に合わせて
 *     残り4回を同じ対象へ撃つ。
 *   - スキル2「フルチャージ攻撃が命中した時」
 *       対象がターゲットなら → 激流：攻撃ダメージ231%▲：持続（パーサが付与）
 *       対象がターゲットではないラプチャーなら → 緩流：チャージ時間1秒で固定：持続
 *     激流／緩流は互いに解除し合う。パーサは激流しか持っていないので、
 *     ここでは 緩流 の付与（チャージ時間1秒固定）と、そのときの激流解除、
 *     および 激流 に戻ったときの 緩流解除 を扱う。
 *     アリーナでは SR の通常攻撃は常に照準の対象へ当たるため、実際に選ばれるのは
 *     激流側だが、対象が変わった場合に備えて両方向を実装しておく。
 *   - スキル2「戦闘開始時、自分に チャージ速度増加効果無効／減少効果無効」
 *     engine は装填（Gauge）のチャージ速度を生成時に固定しており、戦闘中に
 *     chargeSpeedPct を参照しない。したがってこの無効化は engine 側で既に
 *     満たされている（ここで打ち消す効果は無い）。
 *
 * 発動しないのが正しいと判断して実装していないもの:
 *   - スキル1「フルチャージ攻撃がコアに命中した時、攻撃ダメージ20.83%▲」
 *     アリーナにコアヒットは無い（js/docs.js）。
 *   - スキル1「最終攻撃力が一番低い基本バースト段階Ⅲの味方1機に
 *     チャージ速度12.74%▲」… chargeSpeedPct は engine が読まない。
 *   - バーストの攻撃ダメージ50%▲／敵全体925%はパーサが処理済み。
 */
(function () {
  'use strict';

  var EXTRA_PCT = 40.5;      /* 原文: 最終攻撃力の40.5%の追加ダメージ */
  var EXTRA_HITS = 5;        /* 原文: 5回発動（パーサが1回ぶん済み） */
  var GENTLE_CHARGE_FRAMES = 60;  /* 原文: チャージ時間1秒で固定 */

  /* E.pickTarget は README では (u, frame)、engine の実装は (u, enemies, frame)。 */
  function primaryTarget(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  /* パーサが付けた激流（skill2 の1番目のブロック）を消す。
   * engine の buff key は `side+pos:スロット:ブロック番号:...` だが、
   * 現状の engine はスロット名が undefined になることがあるので両方見る。 */
  function removeRaging(u) {
    var prefixes = [u.side + u.pos + ':skill2:0:', u.side + u.pos + ':undefined:0:'];
    var bs = u.buffs || [];
    for (var i = bs.length - 1; i >= 0; i--) {
      if (bs[i].stat !== 'atkDmgPct') continue;
      var key = String(bs[i].key);
      for (var k = 0; k < prefixes.length; k++) {
        if (key.indexOf(prefixes[k]) === 0) { bs.splice(i, 1); break; }
      }
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[26] = {
    init: function (u, E) {
      u.lib = { target: null, gentle: false, prevChargeFixed: 0 };
    },

    tick: function (u, E, frame) {
      var s = u.lib;
      if (!s) return;
      /* このフレームの狙い（通常攻撃の対象）を覚えておく */
      s.target = primaryTarget(u, E, frame);
      /* 緩流のあいだは、パーサが fullChargeShot で付ける激流を毎フレーム剥がす */
      if (s.gentle) removeRaging(u);
    },

    onShot: function (u, E, frame, shot) {
      var s = u.lib;
      if (!s) return;
      /* フルチャージ攻撃＝SR/RL の通常攻撃（engine も fullChargeShot で扱う） */
      if (u.weapon !== 'SR' && u.weapon !== 'RL') return;

      var aimed = s.target;
      var hitTarget = (aimed && (aimed.alive || aimed.deathFrame === frame)) ? aimed : null;

      /* ---- 激流／緩流の分岐 */
      if (hitTarget) {
        /* 対象がターゲット：激流（パーサが231%を付与する）。
         * 緩流状態だったなら解除してチャージ固定を戻す。 */
        if (s.gentle) {
          s.gentle = false;
          u.chargeFixed = s.prevChargeFixed;
          s.prevChargeFixed = 0;
          E.event({ frame: frame, kind: 'liberalio-raging', side: u.side, unit: u.name });
        }
      } else {
        /* ターゲットではない相手に当たった：緩流 */
        if (!s.gentle) {
          s.gentle = true;
          s.prevChargeFixed = u.chargeFixed || 0;
          u.chargeFixed = GENTLE_CHARGE_FRAMES;
          removeRaging(u);
          E.event({ frame: frame, kind: 'liberalio-gentle', side: u.side, unit: u.name });
        }
      }

      /* ---- スキル1：追加ダメージ 40.5% × 5回（パーサが1回ぶん済み） */
      var t = hitTarget || primaryTarget(u, E, frame);
      if (!t || !t.alive) return;
      for (var i = 1; i < EXTRA_HITS; i++) {
        if (!t.alive) break;
        E.damage(u, t, frame, { multiplierPct: EXTRA_PCT });
      }
    },

    onBurst: function (u, E, frame) { }
  };
})();
