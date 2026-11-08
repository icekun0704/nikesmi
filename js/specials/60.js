/* プリバティ：アンカインド・メイド (id 60 / org 110, SG / B3 / 火力型 / 電撃) — 宝物なし
 *
 * パーサが既に動かしているもの（ここでは触らない）:
 *   - バーストの 攻撃ダメージ10.56%▲ / クリティカルダメージ88.17%▲：10秒
 *     と 敵全体 1066.66%
 *
 * パーサで表現できていない部分:
 *   - ペレットの命中数カウント。engine は counters.pelletHits を加算せず、
 *     runCounterSkills も pelletHits では呼ばないため、
 *     skill1「ペレットが30回命中した時、照準線に最も近い敵2機に
 *     最終攻撃力の202.84%の追加ダメージ」が一度も発動しない。
 *     このブロックを空にして、SG の1射 = 10ペレットとして自前で数える。
 *   - skill2「通常攻撃1回でペレットが5個以上命中した時、自分に
 *     リロード速度20.88%▲：2秒間維持」（trigger:unknown で発動しない）
 *   - skill2「フルバーストタイムの持続時間中、ペレットが30回命中した時、自分に
 *     弾丸チャージ1発 / 攻撃力11.22%▲：5スタック：2秒間維持」
 *     （trigger:unknown で発動しない）
 *
 * 実装していないもの:
 *   - リロード速度20.88%▲。engine はリロード時間を生成時に固定しており
 *     reloadSpeedPct を読まない（他キャラと同じ扱い）。
 *   - 弾丸チャージは engine が op:bulletCharge を処理しないため、装弾を
 *     1発ぶん戻す形で実装する。
 */
(function () {
  'use strict';

  var FPS = 60;
  var PELLETS_PER_SHOT = 10;  /* engine の SG は1射10ペレット */
  var RELOAD_UP = 20.88;      /* 原文: リロード速度20.88%▲ */
  var RELOAD_SECONDS = 2;     /* 原文: 2秒間維持 */
  var S1_HITS = 30;           /* 原文: ペレットが30回命中した時 */
  var S1_PCT = 202.84;        /* 原文: 最終攻撃力の202.84%の追加ダメージ */
  var S1_TARGETS = 2;         /* 原文: 照準線に最も近い敵2機 */
  var ATK_STACK_PCT = 11.22;  /* 原文: 攻撃力11.22%▲：5スタック：2秒間維持 */
  var ATK_STACK_MAX = 5;
  var ATK_STACK_SECONDS = 2;

  function copySkills(u) {
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (!src) return null;
    u.skills = JSON.parse(JSON.stringify(src));
    for (var s = 0; s < u.skillState.length; s++) {
      var st = u.skillState[s];
      var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
      if (!arr) continue;
      for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
    }
    return u.skills;
  }

  function primaryTarget(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  /* 照準線に最も近い敵N機（通常攻撃の狙いから pos の近い順） */
  function nearestToAim(u, E, frame, n) {
    var foes = E.alive(E.enemies(u));
    if (!foes.length) return [];
    var prim = primaryTarget(u, E, frame);
    var p = prim ? prim.pos : 0;
    var cand = foes.slice();
    cand.sort(function (a, b) { return Math.abs(a.pos - p) - Math.abs(b.pos - p); });
    return cand.slice(0, n);
  }

  function fullBurstActive(u, E, frame) {
    var lb = (E.team(u) || []).lastBurst;
    return !!(lb && lb.stage === 'B3' && frame >= lb.frame && frame <= lb.frame + 10 * FPS);
  }

  (window.SPECIALS = window.SPECIALS || {})[60] = {
    init: function (u, E) {
      u.privaty = { pellets: 0, pelletsFb: 0, fbFrame: -1 };

      var sk = copySkills(u);
      if (sk && sk.skill1 && sk.skill1.blocks[0]) {
        sk.skill1.blocks[0].effects = [];   /* pelletHits カウンタは engine が回さない */
      }
      if (sk && sk.skill2) {
        if (sk.skill2.blocks[0]) sk.skill2.blocks[0].effects = [];
        if (sk.skill2.blocks[1]) sk.skill2.blocks[1].effects = [];
      }
    },

    tick: function (u, E, frame) {
      var s = u.privaty;
      if (!s) return;
      /* 新しいフルバーストに入ったら、FB 中のペレットカウントを仕切り直す */
      var lb = (E.team(u) || []).lastBurst;
      if (lb && lb.stage === 'B3' && lb.frame !== s.fbFrame) {
        s.fbFrame = lb.frame;
        s.pelletsFb = 0;
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = u.privaty;
      if (!s) return;
      if (u.weapon !== 'SG') return;
      /* 通常攻撃の対象がいないときはペレットも飛ばない */
      var prim = primaryTarget(u, E, frame);
      if (!prim) return;

      var pellets = PELLETS_PER_SHOT;

      /* 通常攻撃1回でペレットが5個以上命中した時
       * → リロード速度20.88%▲：2秒 */
      if (pellets >= 5) {
        E.buff(u, 'privaty-reload', 'reloadSpeedPct', RELOAD_UP, 'up',
          frame + RELOAD_SECONDS * FPS, {});
      }

      /* ペレットが30回命中した時 → 照準線に最も近い敵2機へ 202.84% */
      s.pellets += pellets;
      while (s.pellets >= S1_HITS) {
        s.pellets -= S1_HITS;
        var targets = nearestToAim(u, E, frame, S1_TARGETS);
        for (var i = 0; i < targets.length; i++) {
          E.damage(u, targets[i], frame, { multiplierPct: S1_PCT });
        }
        E.event({ frame: frame, kind: 'privaty-pellet30', side: u.side, unit: u.name });
      }

      /* フルバーストタイムの持続時間中、ペレットが30回命中した時
       * → 弾丸チャージ1発 / 攻撃力11.22%▲：5スタック：2秒 */
      if (fullBurstActive(u, E, frame)) {
        s.pelletsFb += pellets;
        while (s.pelletsFb >= S1_HITS) {
          s.pelletsFb -= S1_HITS;
          /* 弾丸チャージ1発（engine は op:bulletCharge を処理しない） */
          if (u.firing && isFinite(u.firing.magazine) &&
              u.firing.shotsInMagazine > 0) {
            u.firing.shotsInMagazine = Math.max(0, u.firing.shotsInMagazine - 1);
          }
          var b = E.buff(u, 'privaty-fb-atk', 'atkPct', ATK_STACK_PCT, 'up',
            frame + ATK_STACK_SECONDS * FPS, { maxStacks: ATK_STACK_MAX });
          if (b && (b.stacks || 1) > ATK_STACK_MAX) b.stacks = ATK_STACK_MAX;
          E.event({ frame: frame, kind: 'privaty-fb-pellet30', side: u.side, unit: u.name });
        }
      }
    },

    onBurst: function () { /* バースト固有の状態なし */ }
  };
})();
