/* マスト：ロマンチックメイド (id 184 / org 144, MG, B2, 支援型)
 *
 * パーサで表現できていない部分:
 *   - ほろ酔いのスタック（最大3・持続）
 *       バースト1段階に突入するたび +1。
 *     パーサの 命中率20%▼×3スタック は engine が読まない stat なので、
 *     スタック数の管理はここで持つ。
 *   - スキル1「自分がほろ酔い状態に限り味方全体に
 *       クリティカル確率20.05%▲：持続／スキル発動者基準で攻撃力35.02%▲：持続」
 *     trigger:unknown で落ちており発動しない。酔っているあいだ配る。
 *   - スキル2「バースト3段階突入時、自分がほろ酔い状態なら味方全体に
 *       分配ダメージ15.03%×スタック数▲：10秒／リロード速度15.04%×スタック数▲：10秒」
 *     同じく trigger:unknown。B3 突入時にスタック数を掛けて配る。
 *   - スキル2「フルバーストタイムが終了した時、自分がほろ酔いのフルスタック状態なら
 *       スタック解除後、自分に 二日酔い：気絶：10秒間維持」
 *     op:unparsed。FB終了時に3スタックなら解除して10秒スタン。
 *   - バースト「自分がほろ酔い状態なら、味方全体に
 *       スキル発動者基準で攻撃力20.06%×スタック数▲：10秒間維持」
 *     op:unparsed。バースト時に配る。
 *
 * パーサが処理済みなので触らないもの:
 *   - バーストのクリティカルダメージ40.04%▲／攻撃ダメージ15.04%▲
 */
(function () {
  'use strict';

  var MAX_STACKS = 3;            /* 原文: 3スタック */
  var DRUNK_CRATE_PCT = 20.05;   /* 原文: クリティカル確率20.05%▲ */
  var DRUNK_ATK_PCT = 35.02;     /* 原文: スキル発動者基準で攻撃力35.02%▲ */
  var B3_DISTRIB_PCT = 15.03;    /* 原文: 分配ダメージ15.03%×スタック数 */
  var B3_RELOAD_PCT = 15.04;     /* 原文: リロード速度15.04%×スタック数 */
  var BURST_ATK_PCT = 20.06;     /* 原文: 攻撃力20.06%×スタック数（発動者基準） */
  var EFFECT_SECONDS = 10;       /* 原文: 10秒間維持 */
  var STUN_SECONDS = 10;         /* 原文: 気絶：10秒間維持 */
  var FB_FRAMES = 600;           /* フルバーストタイム 10秒 */

  (window.SPECIALS = window.SPECIALS || {})[184] = {
    init: function (u, E) {
      u.mastRM = { stacks: 0, lastBurstFrame: -1, fbFrame: -1 };
    },

    tick: function (u, E, frame) {
      var s = u.mastRM;
      if (!s) return;

      /* ---- バースト段階の検出 */
      var lb = E.team(u).lastBurst;
      if (lb && lb.frame !== s.lastBurstFrame) {
        s.lastBurstFrame = lb.frame;

        if (lb.stage === 'B1') {
          /* バースト1段階突入時：ほろ酔い +1（最大3） */
          if (s.stacks < MAX_STACKS) {
            s.stacks += 1;
            E.event({ frame: frame, kind: 'mastrm-drunk', side: u.side, unit: u.name, stacks: s.stacks });
          }
        } else if (lb.stage === 'B3') {
          s.fbFrame = lb.frame;
          /* バースト3段階突入時：酔っていれば味方全体に分配ダメージ／リロード速度 */
          if (s.stacks > 0) {
            var until = frame + EFFECT_SECONDS * E.FPS;
            var allies = E.alive(E.team(u));
            var tag = ':' + frame;   /* スタック数が変わっても前回値を引きずらない */
            for (var i = 0; i < allies.length; i++) {
              var a = allies[i];
              E.buff(a, 'mastrm-distrib' + tag, 'distributedDmgPct',
                B3_DISTRIB_PCT * s.stacks, 'up', until, {});
              E.buff(a, 'mastrm-reload' + tag, 'reloadSpeedPct',
                B3_RELOAD_PCT * s.stacks, 'up', until, {});
            }
          }
        }
      }

      /* ---- フルバースト終了時：フルスタックなら解除して気絶 */
      if (s.fbFrame >= 0 && frame >= s.fbFrame + FB_FRAMES + 1) {
        s.fbFrame = -1;
        if (s.stacks >= MAX_STACKS) {
          s.stacks = 0;
          u.stunUntil = Math.max(u.stunUntil, frame + STUN_SECONDS * E.FPS);
          E.event({ frame: frame, kind: 'mastrm-hangover', side: u.side, unit: u.name });
        }
      }

      /* ---- ほろ酔い中の味方全体バフ（オーラ） */
      if (s.stacks > 0) {
        var team = E.alive(E.team(u));
        var flat = E.atkEff(u) * DRUNK_ATK_PCT / 100;
        for (var k = 0; k < team.length; k++) {
          E.buff(team[k], 'mastrm-drunk-crate', 'critRate',
            DRUNK_CRATE_PCT, 'up', frame + 2, { aura: true });
          E.buff(team[k], 'mastrm-drunk-atk', 'atkFlat',
            flat, 'up', frame + 2, { aura: true });
        }
      }
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) {
      var s = u.mastRM;
      if (!s || s.stacks <= 0) return;
      var until = frame + EFFECT_SECONDS * E.FPS;
      var flat = E.atkEff(u) * BURST_ATK_PCT / 100 * s.stacks;
      var allies = E.alive(E.team(u));
      var tag = ':' + frame;     /* スタック数が変わっても前回値を引きずらない */
      for (var i = 0; i < allies.length; i++) {
        E.buff(allies[i], 'mastrm-burst-atk' + tag, 'atkFlat', flat, 'up', until, {});
      }
      E.event({ frame: frame, kind: 'mastrm-burst', side: u.side, unit: u.name, stacks: s.stacks });
    }
  };
})();
