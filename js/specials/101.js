/* ブレッディ (id 101 / org 150, SR / B3 / 火力型 / 水冷) — 宝物なし
 *
 * パーサが既に動かしているもの（ここでは触らない）:
 *   - バーストの 攻撃ダメージ60.19%▲：10秒間維持
 *   - skill1 フルバースト時の 攻撃力70.01%▲：10秒間維持
 *
 * パーサで表現できていない部分:
 *   - やみつきの味 / オススメの味 の状態機械。
 *       持続ダメージ増加効果が適用された時 → やみつきの味（チャージ速度20%▼・
 *           50秒・解除不可・オススメの味解除）
 *       分配ダメージ増加効果が適用された時 → オススメの味（同じ数値・逆方向に解除）
 *     どちらもパーサは trigger:unknown で一度も発動しない。
 *     engine の該当ステータス名（sustainedDmgPct / distributedDmgPct）の
 *     バフが新しく付いたフレームを検出して切り替える。
 *   - skill2 の条件付き効果（3ブロックとも trigger:unknown / counter で発動しない）
 *       フルチャージ攻撃が3回命中した時、やみつきの味なら 対象に
 *         受けるダメージ10.2%▲：5秒
 *         あと味：最終攻撃力の150.04%の持続ダメージ：1秒間隔：5秒
 *       フルチャージ攻撃が命中した時、オススメの味なら
 *         自分に 攻撃ダメージ60.01%▲：5秒
 *         敵全体に 最終攻撃力の265.07%の分配ダメージ
 *     パーサは条件を落として毎回発動させるので、この3ブロックの効果を空にして
 *     ここで条件付きに撃ち直す。
 *   - バーストの分岐
 *       やみつきの味なら あと味効果349.8%▲：10秒（あと味＝持続ダメージの
 *         強化なので sustainedDmgPct）
 *       オススメの味なら 攻撃力70.09%▲：10秒
 *
 * 実装していないもの:
 *   - 状態の「チャージ速度20%▼」。パーサと同じ chargeSpeedPct で付与するが、
 *     engine は射撃間隔を生成時に固定しており sumStat を見ない（他キャラと
 *     同じ扱い。engine 側が対応した時に二重にならないよう間隔は書き換えない）。
 */
(function () {
  'use strict';

  var FPS = 60;
  var TASTE_SECONDS = 50;      /* 原文: 50秒間維持 */
  var CHARGE_DOWN = 20;        /* 原文: チャージ速度20.00%▼ */
  var FC_PER_TRIGGER = 3;      /* 原文: フルチャージ攻撃が3回命中した時 */
  var TAKEN_UP = 10.2;         /* 原文: 受けるダメージ10.2%▲ */
  var AFTER_PCT = 150.04;      /* 原文: あと味：最終攻撃力の150.04%の持続ダメージ */
  var AFTER_SECONDS = 5;       /* 原文: 5秒間維持 */
  var OSU_ATKDMG = 60.01;      /* 原文: 攻撃ダメージ60.01%▲ */
  var OSU_ATKDMG_SECONDS = 5;  /* 原文: 5秒間維持 */
  var OSU_DIST_PCT = 265.07;   /* 原文: 最終攻撃力の265.07%の分配ダメージ */
  var BURST_AFTER_PCT = 349.8; /* 原文: あと味効果349.8%▲ */
  var BURST_OSU_ATK = 70.09;   /* 原文: 攻撃力70.09%▲ */
  var BURST_SECONDS = 10;      /* 原文: 10秒間維持 */

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

  function expireBuff(u, key, frame) {
    var bs = u.buffs || [];
    for (var i = 0; i < bs.length; i++) {
      if (bs[i].key === key && bs[i].until > frame) bs[i].until = frame;
    }
  }

  function setTaste(u, E, frame, taste) {
    var s = u.breddy;
    var until = frame + TASTE_SECONDS * FPS;
    if (taste === 'yami') {
      s.taste = 'yami';
      s.tasteUntil = until;
      expireBuff(u, 'breddy-osu', frame);        /* オススメの味解除 */
      E.buff(u, 'breddy-yami', 'chargeSpeedPct', CHARGE_DOWN, 'down', until, {});
    } else {
      s.taste = 'osu';
      s.tasteUntil = until;
      expireBuff(u, 'breddy-yami', frame);       /* やみつきの味解除 */
      E.buff(u, 'breddy-osu', 'chargeSpeedPct', CHARGE_DOWN, 'down', until, {});
    }
    E.event({ frame: frame, kind: 'breddy-taste', side: u.side, unit: u.name, taste: taste });
  }

  /* engine のステータス名で「持続ダメージ増加 / 分配ダメージ増加」の付与を検出する。
   * 同じバフでも until が変われば再付与とみなす。既に同じ味なら何もしない
   * （オーラ系バフが毎フレーム until を書き換えても発動ログを溢れさせない）。 */
  function scanTaste(u, E, frame) {
    var s = u.breddy;
    var bs = u.buffs || [];
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (b.stat !== 'sustainedDmgPct' && b.stat !== 'distributedDmgPct') continue;
      if (b.until < frame) continue;
      var sig = b.stat + '|' + b.key + '|' + b.until;
      if (s.seen[sig]) continue;
      s.seen[sig] = 1;
      var want = b.stat === 'sustainedDmgPct' ? 'yami' : 'osu';
      if (s.taste === want) continue;
      setTaste(u, E, frame, want);
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[101] = {
    init: function (u, E) {
      u.breddy = {
        taste: null,
        tasteUntil: -1,
        fc: 0,
        dots: [],
        seen: {}
      };

      var sk = copySkills(u);
      if (sk && sk.skill2) {
        /* 条件を落として毎回撃たれる3ブロックを止める（自前で条件付きに撃つ） */
        for (var i = 0; i < sk.skill2.blocks.length; i++) {
          sk.skill2.blocks[i].effects = [];
        }
      }
    },

    tick: function (u, E, frame) {
      var s = u.breddy;
      if (!s) return;

      scanTaste(u, E, frame);

      /* あと味（持続ダメージ）：1秒間隔・5秒間 */
      for (var i = s.dots.length - 1; i >= 0; i--) {
        var d = s.dots[i];
        if (frame > d.until) { s.dots.splice(i, 1); continue; }
        if (frame < d.next) continue;
        if (d.target && d.target.alive) {
          E.damage(u, d.target, frame, { multiplierPct: AFTER_PCT, isSustained: true });
        }
        d.next += 60;
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = u.breddy;
      if (!s) return;
      /* SR の通常攻撃はすべてフルチャージ攻撃 */
      if (u.weapon !== 'RL' && u.weapon !== 'SR') return;
      s.fc += 1;
      if (s.taste === 'yami') {
        if (s.fc % FC_PER_TRIGGER === 0) {
          var t = primaryTarget(u, E, frame);
          if (t) {
            E.buff(t, 'breddy-taken:' + u.pos + ':' + t.pos, 'takenDmgPct', TAKEN_UP,
              'up', frame + AFTER_SECONDS * FPS, {});
            s.dots.push({
              target: t,
              next: frame + 60,
              until: frame + AFTER_SECONDS * FPS
            });
            E.event({ frame: frame, kind: 'breddy-aftertaste', side: u.side,
                      unit: u.name, target: t.name, pos: t.pos });
          }
        }
      } else if (s.taste === 'osu') {
        /* フルチャージ攻撃が命中した時、オススメの味なら */
        E.buff(u, 'breddy-osu-atkdmg', 'atkDmgPct', OSU_ATKDMG, 'up',
          frame + OSU_ATKDMG_SECONDS * FPS, {});
        var foes = E.alive(E.enemies(u));
        for (var i = 0; i < foes.length; i++) {
          E.damage(u, foes[i], frame, { multiplierPct: OSU_DIST_PCT, isDistributed: true });
        }
      }
    },

    onBurst: function (u, E, frame) {
      var s = u.breddy;
      if (!s) return;
      if (s.taste === 'yami') {
        /* あと味効果349.8%▲：10秒間維持（あと味＝持続ダメージの強化） */
        E.buff(u, 'breddy-burst-after', 'sustainedDmgPct', BURST_AFTER_PCT, 'up',
          frame + BURST_SECONDS * FPS, {});
      } else if (s.taste === 'osu') {
        /* 攻撃力70.09%▲：10秒間維持 */
        E.buff(u, 'breddy-burst-atk', 'atkPct', BURST_OSU_ATK, 'up',
          frame + BURST_SECONDS * FPS, {});
      }
    }
  };
})();
