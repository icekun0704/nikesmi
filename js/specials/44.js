/* ビスケット (id 44 / org 59, RL, B2, 支援型, 電撃)
 *
 * 原文の状態機械:
 *   burst  : 遮蔽物が破壊された味方ランダム2機に 遮蔽物HP93.6%で遮蔽物復活
 *   skill1 : フルバーストタイムを終了した時、火力型の味方全体に
 *             通常攻撃のクリティカル確率5.77%▲：10秒間維持
 *             スキル発動者の最終最大HPの1.53%持続回復：1秒間隔：10秒間維持
 *   skill2 : 防御型の味方の誰かのHPが50%以下なら、対象に
 *             無敵：5秒間維持：戦闘中2回発動
 *             スキル発動者の最終最大HPの23.26%回復：戦闘中2回発動
 *   burst  : 支援型の味方全体に 攻撃ダメージの55.44%回復：10秒間維持
 *
 * パーサの扱い:
 *   - burst の遮蔽物復活は op=coverStat で engine が処理しない。
 *   - skill2 は trigger=unknown で未発動（しかも target が enemy になっている）。
 *   - skill1 の持続回復は1回ぶんだけ撃たれる（1秒間隔が無い）。
 *   - burst の lifesteal は duration を無視して恒久設定される。
 */
(function () {
  'use strict';

  var FB_FRAMES = 10 * 60;
  var COVER_REVIVE_PCT = 93.6;
  var DEFENDER_HP_PCT = 50;
  var INVULN_FRAMES = 5 * 60;
  var DEFENDER_HEAL_PCT = 23.26;
  var DEFENDER_USES = 2;
  var REGEN_PCT = 1.53;
  var LIFESTEAL_PCT = 55.44;
  var LIFESTEAL_FRAMES = 10 * 60;

  function st(u) {
    if (!u.biscuit) {
      u.biscuit = {
        fbSeen: -1,
        fbEnd: -1,
        regenPos: [],
        regenNext: -1,
        regenLeft: 0,
        defUses: 0,
        defNext: -1,
        lsUntil: -1,
        lsApplied: false,
        lsUnits: []
      };
    }
    return u.biscuit;
  }

  /* 決定的な簡易乱数（シミュレーションの再現性のため Math.random は使わない） */
  function rngFrom(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function reviveCovers(u, E, frame, s) {
    var allies = E.alive(E.team(u));
    var broken = [];
    for (var i = 0; i < allies.length; i++) {
      if (allies[i].coverHp <= 0) broken.push(allies[i]);
    }
    if (!broken.length) return 0;
    var rnd = rngFrom(frame * 31 + u.pos * 7 + u.side.charCodeAt(0));
    for (var j = broken.length - 1; j > 0; j--) {
      var k = Math.floor(rnd() * (j + 1));
      var t = broken[j]; broken[j] = broken[k]; broken[k] = t;
    }
    var n = Math.min(2, broken.length);
    for (var m = 0; m < n; m++) {
      var a = broken[m];
      a.coverHp = Math.max(1, Math.round(a.coverMax * COVER_REVIVE_PCT / 100));
      E.event({ frame: frame, kind: 'cover-revive', side: u.side, unit: u.name,
                target: a.name, pct: COVER_REVIVE_PCT });
    }
    return n;
  }

  (window.SPECIALS = window.SPECIALS || {})[44] = {
  /* 遮蔽物の復活はここで実装している */
  suppress: { burst: [0] },
    init: function (u, E) {
      st(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);

      /* フルバースト終了の検出 */
      var team = E.team(u) || [];
      var lb = team.lastBurst;
      if (lb && lb.stage === 'B3' && lb.frame !== s.fbSeen) {
        s.fbSeen = lb.frame;
        s.fbEnd = lb.frame + FB_FRAMES;
      }
      if (s.fbEnd >= 0 && frame >= s.fbEnd) {
        s.fbEnd = -1;
        /* パーサが撃った1回ぶんに加えて、1秒間隔で残り9回 */
        var fire = E.alive(E.team(u)).filter(function (a) {
          return a.char && a.char.classType === '火力型';
        });
        s.regenPos = fire;
        s.regenNext = frame + 60;
        s.regenLeft = 9;
        E.event({ frame: frame, kind: 'biscuit-fb-end', side: u.side, unit: u.name });
      }

      /* skill1 持続回復 1.53%：1秒間隔 */
      if (s.regenLeft > 0 && frame >= s.regenNext) {
        s.regenNext += 60;
        s.regenLeft -= 1;
        for (var i = 0; i < s.regenPos.length; i++) {
          if (s.regenPos[i].alive) E.heal(s.regenPos[i], u.hpMax * REGEN_PCT / 100, frame);
        }
        if (s.regenLeft <= 0) s.regenPos = [];
      }

      /* skill2：防御型の味方のHPが50%以下なら 無敵5秒＋23.26%回復（戦闘中2回） */
      if (s.defUses < DEFENDER_USES && frame >= s.defNext) {
        var defenders = E.alive(E.team(u)).filter(function (a) {
          return a.char && a.char.classType === '防御型' &&
            a.hp / a.hpMax * 100 <= DEFENDER_HP_PCT;
        });
        if (defenders.length) {
          defenders.sort(function (a, b) { return (a.hp / a.hpMax) - (b.hp / b.hpMax); });
          var t = defenders[0];
          s.defUses += 1;
          s.defNext = frame + INVULN_FRAMES;
          t.invulnUntil = Math.max(t.invulnUntil, frame + INVULN_FRAMES);
          E.heal(t, u.hpMax * DEFENDER_HEAL_PCT / 100, frame);
          E.event({ frame: frame, kind: 'biscuit-defender-save', side: u.side,
                    unit: u.name, target: t.name, uses: s.defUses });
        }
      }

      /* burst の lifesteal 55.44% を10秒で解除 */
      if (s.lsUntil >= 0 && !s.lsApplied) {
        s.lsApplied = true;
        var all = E.alive(E.team(u));
        for (var k = 0; k < all.length; k++) {
          if (all[k].lifestealPct >= LIFESTEAL_PCT) s.lsUnits.push(all[k]);
        }
      }
      if (s.lsUntil >= 0 && frame > s.lsUntil) {
        s.lsUntil = -1;
        s.lsApplied = false;
        for (var r = 0; r < s.lsUnits.length; r++) {
          if (s.lsUnits[r].lifestealPct === LIFESTEAL_PCT) s.lsUnits[r].lifestealPct = 0;
        }
        s.lsUnits = [];
        E.event({ frame: frame, kind: 'biscuit-lifesteal-end', side: u.side, unit: u.name });
      }
    },

    onShot: function (u, E, frame, shot) {
      /* skill1 のクリティカルはパーサが処理済み。追加なし。 */
    },

    onBurst: function (u, E, frame) {
      var s = st(u);
      reviveCovers(u, E, frame, s);
      s.lsUntil = frame + LIFESTEAL_FRAMES;
      s.lsApplied = false;
      s.lsUnits = [];
    }
  };
})();
