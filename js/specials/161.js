/* リトルマーメイド (id 161 / org 152, SMG, B1, 支援型)
 *
 * パーサで表現できていない部分:
 *   - バブル状態
 *       「敵が登場した時に、対象に バブル：受けるダメージ5.05%▲：持続」
 *       アリーナでは戦闘開始時に敵が揃っているので、開始時の対象に付ける。
 *   - 「通常攻撃が50回命中した時、対象がバブル状態なら、対象に
 *       バブルバースト：受けるダメージ5.05%▲：持続／気絶：3秒間維持／バブル解除」
 *     パーサのカウンターは条件を見ずに気絶まで撃ってしまうので、このブロックを
 *     止めて、バブル状態のときだけ撃ち直す。
 *   - 「フルバーストタイム中のみ、1秒ごとにランダムな敵に
 *       最終攻撃力の63.36%のダメージ：4回順番に攻撃」
 *     trigger:unknown。フルバースト中だけ1秒ごとに4連撃。
 *   - 「味方が消費した弾の合計が400発ごとに、味方全体に バーストゲージのチャージ37%」
 *   - 「味方が消費した弾の合計が500発ごとに、ランダムな敵に
 *       バブルバラージ：最終攻撃力の85%のダメージ：10回順番に攻撃」
 *     この2つは counter の on:'ammoConsumed' だが engine にこのカウンタが無い。
 *     味方の総射撃数（1発 = 1マガジン消費）を自前で数えて発動する。
 *   - バースト「味方全体に 弾丸チャージ33.26%」
 *     op:bulletCharge は engine が知らない。味方の装弾を1マガジンの33.26%戻す。
 *
 * 発動しないのが正しいと判断して実装していないもの:
 *   - スキル1「自分がフォーカス状態の時に限り、味方全体に 射撃集中：持続」
 *     フォーカス状態を付与する効果がこのキャラの原文にもデータにも無く、
 *     発生源が特定できないため、条件が常に偽として扱う。
 *   - スキル2の「バブルバースト」以外の部分は上記で実装済み。
 */
(function () {
  'use strict';

  var BUBBLE_PCT = 5.05;          /* 原文: 受けるダメージ5.05%▲ */
  var BUBBLE_HITS = 50;           /* 原文: 通常攻撃が50回命中した時 */
  var STUN_SECONDS = 3;           /* 原文: 気絶：3秒間維持 */
  var FB_DMG_PCT = 63.36;         /* 原文: 最終攻撃力の63.36% */
  var FB_HITS = 4;                /* 原文: 4回順番に攻撃 */
  var FB_INTERVAL = 60;           /* 原文: 1秒ごと */
  var AMMO_GAUGE = 400;           /* 原文: 400発ごと */
  var GAUGE_CHARGE = 37;          /* 原文: バーストゲージのチャージ37% */
  var AMMO_BARRAGE = 500;         /* 原文: 500発ごと */
  var BARRAGE_PCT = 85;           /* 原文: 最終攻撃力の85% */
  var BARRAGE_HITS = 10;          /* 原文: 10回順番に攻撃 */
  var RELOAD_PCT = 0.3326;        /* 原文: 弾丸チャージ33.26% */
  var FB_FRAMES = 600;            /* フルバーストタイム 10秒 */

  /* E.pickTarget は README では (u, frame)、engine の実装は (u, enemies, frame)。 */
  function primaryTarget(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  /* engine の乱数は API に無いので、フレームと添字から決まる疑似乱数で選ぶ
   * （同じ入力なら同じ結果になる）。 */
  function randomEnemy(u, E, frame, index) {
    var list = E.alive(E.enemies(u));
    if (!list.length) return null;
    var h = (frame * 2654435761 + index * 40503 + u.pos * 97) >>> 0;
    return list[h % list.length];
  }

  function expire(unit, key, frame) {
    var bs = unit && unit.buffs;
    if (!bs) return;
    for (var i = 0; i < bs.length; i++) {
      if (bs[i].key === key && bs[i].until > frame) bs[i].until = frame;
    }
  }

  /* 味方が消費した弾の合計。engine の装弾も 1ヒット = 1発 で減るので、
   * 各ユニットの attackHits の合計を弾数として数える。 */
  function totalAmmo(u, E) {
    var team = E.team(u) || [];
    var n = 0;
    for (var i = 0; i < team.length; i++) {
      n += (team[i].counters && team[i].counters.attackHits) || 0;
    }
    return n;
  }

  (window.SPECIALS = window.SPECIALS || {})[161] = {
    init: function (u, E) {
      /* スキル2の50回カウンター（条件を見ずに気絶まで撃つ）を止める */
      var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
      if (src && u.skillState) {
        u.skills = JSON.parse(JSON.stringify(src));
        for (var s = 0; s < u.skillState.length; s++) {
          var st = u.skillState[s];
          var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
          if (!arr) continue;
          for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
        }
        if (u.skills.skill2 && u.skills.skill2.blocks[1]) {
          u.skills.skill2.blocks[1].trigger = { kind: 'disabled' };
        }
      }
      u.siren = {
        hits: 0,
        bubbleTarget: null,
        bubbleActive: false,
        ammo: 0,
        ammoGauge: 0,     /* 次に400発に届くまでの残り */
        ammoBarrage: 0,   /* 次に500発に届くまでの残り */
        fbFrame: -1,
        fbNext: -1,
        lastBurstFrame: -1
      };
    },

    tick: function (u, E, frame) {
      var s = u.siren;
      if (!s) return;

      /* ---- 戦闘開始時：対象にバブル */
      if (frame === 0 && !s.bubbleTarget) {
        var t0 = primaryTarget(u, E, frame);
        if (t0) {
          s.bubbleTarget = t0;
          s.bubbleActive = true;
          E.buff(t0, 'siren-bubble', 'takenDmgPct', BUBBLE_PCT, 'up', Infinity, {});
          E.event({ frame: frame, kind: 'siren-bubble', side: u.side, unit: u.name, target: t0.name });
        }
      }
      if (s.bubbleTarget && (!s.bubbleTarget.alive || !s.bubbleActive)) {
        expire(s.bubbleTarget, 'siren-bubble', frame);
      }

      /* ---- 味方が消費した弾の合計 */
      var total = totalAmmo(u, E);
      var used = total - s.ammo;
      if (used > 0) {
        s.ammo = total;
        s.ammoGauge += used;
        s.ammoBarrage += used;

        while (s.ammoGauge >= AMMO_GAUGE) {
          s.ammoGauge -= AMMO_GAUGE;
          E.gauge(u.side, GAUGE_CHARGE);
          E.event({ frame: frame, kind: 'siren-gauge', side: u.side, unit: u.name });
        }

        while (s.ammoBarrage >= AMMO_BARRAGE) {
          s.ammoBarrage -= AMMO_BARRAGE;
          for (var i = 0; i < BARRAGE_HITS; i++) {
            var t = randomEnemy(u, E, frame, i);
            if (!t) break;
            E.damage(u, t, frame, { multiplierPct: BARRAGE_PCT });
          }
          E.event({ frame: frame, kind: 'siren-barrage', side: u.side, unit: u.name });
        }
      }

      /* ---- フルバーストタイムの開始／終了 */
      var lb = E.team(u).lastBurst;
      if (lb && lb.frame !== s.lastBurstFrame) {
        s.lastBurstFrame = lb.frame;
        if (lb.stage === 'B3') {
          s.fbFrame = lb.frame;
          s.fbNext = lb.frame + FB_INTERVAL;
        }
      }
      if (s.fbFrame >= 0 && frame > s.fbFrame + FB_FRAMES) {
        s.fbFrame = -1;
        s.fbNext = -1;
      }
      if (s.fbFrame >= 0 && frame >= s.fbNext) {
        s.fbNext = frame + FB_INTERVAL;
        for (var k = 0; k < FB_HITS; k++) {
          var e = randomEnemy(u, E, frame, k);
          if (!e) break;
          E.damage(u, e, frame, { multiplierPct: FB_DMG_PCT });
        }
        E.event({ frame: frame, kind: 'siren-fb', side: u.side, unit: u.name });
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = u.siren;
      if (!s) return;
      var prev = s.hits;
      s.hits += (shot && shot.hits) || 0;

      /* ---- 50回命中：対象がバブル状態ならバブルバースト */
      while (Math.floor(s.hits / BUBBLE_HITS) > Math.floor(prev / BUBBLE_HITS)) {
        prev += BUBBLE_HITS;
        var t = primaryTarget(u, E, frame);
        if (!t || !s.bubbleActive || t !== s.bubbleTarget) continue;

        E.buff(t, 'siren-bubble-burst', 'takenDmgPct', BUBBLE_PCT, 'up', Infinity, {});
        t.stunUntil = Math.max(t.stunUntil, frame + STUN_SECONDS * E.FPS);
        s.bubbleActive = false;
        expire(t, 'siren-bubble', frame);
        E.event({ frame: frame, kind: 'siren-bubble-burst', side: u.side, unit: u.name, target: t.name });
      }
    },

    onBurst: function (u, E, frame) {
      /* 弾丸チャージ33.26%：味方の装弾を1マガジンの33.26%戻す */
      var allies = E.alive(E.team(u));
      for (var i = 0; i < allies.length; i++) {
        var m = allies[i].firing;
        if (!m || !isFinite(m.magazine) || m.magazine <= 0) continue;
        m.shotsInMagazine = Math.max(0, m.shotsInMagazine - m.magazine * RELOAD_PCT);
      }
      E.event({ frame: frame, kind: 'siren-burst', side: u.side, unit: u.name });
    }
  };
})();
