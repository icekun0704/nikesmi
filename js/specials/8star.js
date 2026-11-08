/* センチ（宝物）(id 8 / org 64*, RL, B2, 防御型, 鉄甲)
 *
 * 原文の状態機械:
 *   skill1
 *     フルチャージ攻撃が命中した時、自分に スキル2のクールタイム9.16%▼
 *     スキル2を発動した時、鉄甲コードの味方全体に
 *       有利コードの攻撃ダメージ5.69%▲：10スタック：10秒間維持
 *     戦闘開始時、味方全体に
 *       資材備蓄：スキル発動者基準で最大HP7%まで超過するHP回復量保存：5秒間維持
 *       スキル発動者の最終最大HPの7%回復        ← パーサが実装済み
 *     自分を含む味方誰かのHPが100%以下になった時、
 *       自分が資材備蓄状態なら味方全体に スキル発動者の最終最大HPの7%回復
 *   skill2（9秒ごと）
 *     自分に スキル発動者の最終最大HPの7%の味方共用バリア：5秒間維持
 *     味方全体に スキル発動者基準で攻撃力4.6%▲：10スタック：8秒間維持 ← パーサ済み
 *
 * パーサの扱い:
 *   - skill2 の共用バリアは op:unparsed。
 *   - skill1 のスキル2CT短縮・資材備蓄・HP減少時の回復は trigger:unknown / unparsed。
 *   - スキル2発動時の有利コード攻撃ダメージも trigger:unknown。
 *
 * 実装しないもの:
 *   - 「最大HP7%まで超過するHP回復量保存」の保存量そのもの。engine の heal は
 *     最大HPで頭打ちになり、超過分を観測する口が無い。ここでは資材備蓄を
 *     「5秒間の状態」として扱い、条件を満たした時に原文どおり7%回復する。
 *     備蓄は1回の回復で使い切る扱い（同じ備蓄で毎フレーム回復しない）。
 */
(function () {
  'use strict';

  var FPS = 60;
  var SKILL2_CD_SEC = 9;             /* ct=9秒 */
  var CD_DOWN_PCT = 9.16;            /* スキル2のクールタイム9.16%▼ */
  var ELEM_DMG_PCT = 5.69;           /* 有利コードの攻撃ダメージ5.69%▲ */
  var ELEM_STACKS = 10;
  var ELEM_SEC = 10;
  var STOCK_SEC = 5;                 /* 資材備蓄：5秒間維持 */
  var STOCK_HEAL_PCT = 7;            /* スキル発動者の最終最大HPの7%回復 */
  var BARRIER_PCT = 7;               /* 6.38%→7%（宝物） */
  var BARRIER_SEC = 5;

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  function cloneSkills(u) {
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (!src || !u.skillState) return;
    u.skills = JSON.parse(JSON.stringify(src));
    normalizePeriodic(u.skills);
    for (var s = 0; s < u.skillState.length; s++) {
      var st = u.skillState[s];
      var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
      if (!arr) continue;
      for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
    }
  }


  /* パーサは ct をそのまま trigger.seconds に入れることがあり、文字列 "9秒" の
   * まま engine に渡ると (seconds * 60) が NaN になり、周期スキルが毎フレーム
   * 発動してしまう。ユニット専用の複製側で数値に直す（skills.js は触らない）。 */
  function normalizePeriodic(skills) {
    var slots = ['skill1', 'skill2', 'burst'];
    for (var i = 0; i < slots.length; i++) {
      var sk = skills[slots[i]];
      if (!sk || !sk.blocks) continue;
      for (var b = 0; b < sk.blocks.length; b++) {
        var t = sk.blocks[b].trigger;
        if (!t || t.kind !== 'periodic' || typeof t.seconds !== 'string') continue;
        var m = t.seconds.match(/(\d+(?:\.\d+)?)/);
        if (m) t.seconds = parseFloat(m[1]);
      }
    }
  }

  /* スキル2の発動（9秒ごと）。engine の周期スキルと同じタイマーを自前でも持ち、
   * CT短縮を両方に同じだけ適用して同期させる。 */
  function skill2Every() {
    return SKILL2_CD_SEC * FPS;
  }

  function fireSkill2(u, E, frame) {
    /* 味方共用バリア：発動者の最終最大HPの7%を5秒間（均等に分ける） */
    var allies = E.alive(E.team(u));
    if (allies.length) {
      var pool = u.hpMax * BARRIER_PCT * scaleOf(u, 'skill2') / 100;
      var each = pool / allies.length;
      var per = {};
      for (var i = 0; i < allies.length; i++) {
        var a = allies[i];
        a.shield = Math.max(a.shield, each);
        per[a.pos] = each;
      }
      u.centiT.barrier = { until: frame + BARRIER_SEC * FPS, per: per };
    }

    /* 鉄甲コードの味方全体に 有利コードの攻撃ダメージ5.69%：10スタック：10秒 */
    var mates = E.alive(E.team(u));
    for (var k = 0; k < mates.length; k++) {
      var m = mates[k];
      if (m.element !== '鉄甲') continue;
      E.buff(m, 'centiT-elem:' + u.pos, 'elementDmgPct',
        ELEM_DMG_PCT * scaleOf(u, 'skill1'), 'up',
        frame + ELEM_SEC * FPS, { maxStacks: ELEM_STACKS });
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[8] = {
    init: function (u, E) {
      cloneSkills(u);
      u.centiT = {
        nextSkill2: 0,
        barrier: null,
        stockUntil: STOCK_SEC * FPS,
        allyHp: null
      };
      var team = E.alive(E.team(u));
      u.centiT.allyHp = {};
      for (var i = 0; i < team.length; i++) u.centiT.allyHp[team[i].pos] = team[i].hp;
    },

    tick: function (u, E, frame) {
      var s = u.centiT;
      if (!s) return;

      /* スキル2の発動を検出してバリア／有利コードバフを付与 */
      if (frame >= s.nextSkill2) {
        s.nextSkill2 = frame + skill2Every();
        fireSkill2(u, E, frame);
      }

      /* 共用バリアの期限切れ：付与したぶんだけ剥がす */
      if (s.barrier && frame >= s.barrier.until) {
        var list = E.alive(E.team(u));
        for (var i = 0; i < list.length; i++) {
          var a = list[i];
          var amt = s.barrier.per[a.pos] || 0;
          if (amt > 0 && a.shield > 0) a.shield = Math.max(0, a.shield - amt);
        }
        s.barrier = null;
      }

      /* 資材備蓄（5秒）中に誰かのHPが減ったら、味方全体を7%回復 */
      if (frame <= s.stockUntil) {
        var mates = E.alive(E.team(u));
        var hurt = false;
        for (var k = 0; k < mates.length; k++) {
          var m = mates[k];
          var prev = s.allyHp[m.pos];
          if (prev == null) { s.allyHp[m.pos] = m.hp; continue; }
          if (m.hp < prev) hurt = true;
          s.allyHp[m.pos] = m.hp;
        }
        if (hurt) {
          var heal = u.hpMax * STOCK_HEAL_PCT * scaleOf(u, 'skill1') / 100;
          for (var h = 0; h < mates.length; h++) E.heal(mates[h], heal, frame);
          /* 資材備蓄は回復に使われて解除される（同じ備蓄で何度も回復しない） */
          s.stockUntil = -1;
          E.event({ frame: frame, kind: 'centiT-stock', side: u.side, unit: u.name });
        }
      } else {
        /* 期限切れ後もHPを追跡しておく（次に状態が付くことは無い） */
        var all = E.alive(E.team(u));
        for (var x = 0; x < all.length; x++) s.allyHp[all[x].pos] = all[x].hp;
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = u.centiT;
      if (!s) return;
      if (u.weapon !== 'RL' && u.weapon !== 'SR') return;   /* フルチャージ攻撃 */
      var cut = Math.round(skill2Every() * CD_DOWN_PCT / 100);
      /* 自分のタイマーと engine の周期タイマーの両方を短縮する */
      s.nextSkill2 -= cut;
      var sk2 = u.skillState && u.skillState[1];
      if (sk2) sk2.nextPeriodic -= cut;
    }
  };
})();
