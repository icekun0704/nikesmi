/* プリム（宝物）(id 125, SR, B1, 支援型, 宝物)
 *
 * 宝物版の読み替え（Treasure1/2）:
 *   - skill1 の発動条件は「通常攻撃が4回命中した時」→「フルチャージ攻撃が命中した時」
 *   - 「眠い」（防御力4%▼・5スタック・10秒）が追加
 *   - 「フルチャージ攻撃が6回命中した時、対象が眠いのフルスタック状態なら自分に
 *      起きた：通常攻撃を防御力無視ダメージとして適用：10秒間維持」
 *   - burst / skill2 に「自分が起きた状態なら味方全体に 防御力無視ダメージ▲」
 *
 * パーサで表現できなかった部分:
 *   - 「起きた」状態（trigger=unknown）と、それを条件にした
 *     skill2 の 28.16%▲・burst の 49.97%▲。
 *     skill2 側はパーサが条件を落として毎回配るので、起きていない時は
 *     同値のマイナスで打ち消す（burst 側は trigger=unknown なので自前で付与）。
 *
 * 「眠い」について:
 *   - パーサは skill1 の counter attackHits=4 ブロックに「眠い（防御力4%▼・5スタック）」を
 *     入れているが、engine の applyEffect は defPct▼ を専用分岐で処理するため
 *     opts.maxStacks を落とし、しかも同じブロックの 15.84%▼ とキーが衝突して
 *     値が max(15.84, 4) に潰れる。結果として「眠い」は存在しない。
 *     そのため、宝物の本来の条件（フルチャージ攻撃が命中した時）で自前で付与する。
 *
 * 実装していないもの:
 *   - 「起きた」の本体「通常攻撃を防御力無視ダメージとして適用」。
 *     エンジンに通常攻撃の ignoreDef 経路が無い（op normalIgnoreDef も未処理）。
 *   - skill1 の「防御力15.84%▼：10秒間維持→削除」は宝物では削除されるが、
 *     パーサは 15.84% を残したまま発火させる。パーサ側の宝物読み替え漏れで、
 *     ここから打ち消すと他キャラの同値デバフまで巻き込む恐れがあるため保留。
 */
(function () {
  'use strict';

  var FPS = 60;
  var SLEEP_VALUE = 4;        // 眠い：防御力4%▼
  var SLEEP_MAX = 5;          // 5スタック
  var AWAKE_SECONDS = 10;     // 起きた：10秒間維持
  var AWAKE_EVERY = 6;        // フルチャージ攻撃が6回命中するごと
  var SKILL2_PIERCE = 28.16;  // 起きた状態で味方全体に 防御力無視ダメージ▲（5秒）
  var BURST_PIERCE = 49.97;   // 起きた状態で味方全体に 防御力無視ダメージ▲（10秒）

  /* 対象が「眠い」のフルスタック状態か */
  function sleepFull(target, frame) {
    if (!target || !target.buffs) return false;
    for (var i = 0; i < target.buffs.length; i++) {
      var b = target.buffs[i];
      if (b.until < frame) continue;
      if (b.stat !== 'defPct' || b.dir !== 'down') continue;
      if (Math.abs((b.value || 0) - SLEEP_VALUE) > 1e-6) continue;
      if ((b.stacks || 1) >= SLEEP_MAX) return true;
    }
    return false;
  }

  function pickTargetOf(u, E, frame) {
    try {
      var t = E.pickTarget(u, E.enemies(u), frame);
      if (t) return t;
    } catch (e) { /* 2引数版 */ }
    try { return E.pickTarget(u, frame) || null; } catch (e2) { return null; }
  }

  (window.SPECIALS = window.SPECIALS || {})[125] = {
    init: function (u, E) {
      u.prim = { fcHits: 0, awakeUntil: -1 };
    },

    tick: function (u, E, frame) {},

    onShot: function (u, E, frame, shot) {
      var p = u.prim;
      if (!p) return;
      if (!shot || !shot.hits) return;
      if (u.weapon !== 'SR' && u.weapon !== 'RL') return;   // フルチャージ攻撃

      p.fcHits += shot.hits;

      var target = pickTargetOf(u, E, frame);

      // 宝物1: フルチャージ攻撃が命中した時、対象に「眠い」（防御力4%▼・5スタック・10秒）
      if (target && target.alive) {
        E.buff(target, 'prim-sleep', 'defPct', SLEEP_VALUE, 'down', frame + 10 * FPS,
               { maxStacks: SLEEP_MAX, label: '眠い' });
      }

      // 6回命中ごと: 対象が眠いのフルスタックなら「起きた」10秒
      if (p.fcHits % AWAKE_EVERY === 0) {
        var t = target;
        if (sleepFull(t, frame)) {
          p.awakeUntil = frame + AWAKE_SECONDS * FPS;
          // 起きたので、それまで貼っていた打ち消しを外す
          var mates = E.alive(E.team(u));
          for (var mi = 0; mi < mates.length; mi++) {
            mates[mi].buffs = mates[mi].buffs.filter(function (b) {
              return b.key !== 'prim-not-awake';
            });
          }
          E.event({ frame: frame, kind: 'prim-awake', side: u.side, unit: u.name });
        }
      }

      // skill2 防御力無視ダメージ28.16%▲ は「起きた状態」の時だけ。
      // パーサは無条件に配るので、起きていないフレームは同値のマイナスで打ち消す。
      if (frame > p.awakeUntil) {
        var allies = E.alive(E.team(u));
        for (var i = 0; i < allies.length; i++) {
          E.buff(allies[i], 'prim-not-awake', 'ignoreDefDmgPct', SKILL2_PIERCE, 'down',
                 frame + 5 * FPS, {});
        }
      }
    },

    onBurst: function (u, E, frame) {
      var p = u.prim;
      if (!p || frame > p.awakeUntil) return;
      // 自分が起きた状態なら味方全体に 防御力無視ダメージ49.97%▲ 10秒
      var allies = E.alive(E.team(u));
      for (var i = 0; i < allies.length; i++) {
        E.buff(allies[i], 'prim-awake-burst', 'ignoreDefDmgPct', BURST_PIERCE, 'up',
               frame + 10 * FPS, {});
      }
      E.event({ frame: frame, kind: 'prim-awake-burst', side: u.side, unit: u.name });
    }
  };
})();
