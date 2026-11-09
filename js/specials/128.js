/* ブラン (id 128 / org 48, AR, B2, 防御型)
 *
 * パーサで表現できていない部分:
 *   - スキル1「通常攻撃で120回攻撃した時、
 *       スキル発動者の最終最大HPの11.8%の味方共用バリア：5秒間維持」
 *     op:unparsed で落ちている。120発撃つごとに、生存している味方で
 *     プールを等分したシールドを5秒ぶん付与し、期限が来たら残りを剥がす。
 *   - スキル2／バーストの「1秒間隔」の持続回復。
 *     パーサの heal は発動時に1回だけ配るので、残りのティックをここで撃つ
 *     （バースト: 3.84%×8回 / フルバースト終了時: 3.68%×5回）。
 *   - スキル2「フルバーストタイムが終了した時、同じ部隊の味方がいれば自分に
 *       バーストスキルクールタイム40.76秒▼」
 *     パーサは対象を味方全体にしてしまっているため、このブロックを止めて
 *     自分だけに配り直す。同じ部隊 = 777部隊（ノワール21 / ルージュ89）。
 *
 * パーサが処理済みなので触らないもの:
 *   - バーストの不屈・最大HP31.68%▲・敵全体の受けるダメージ39.26%▲
 */
(function () {
  'use strict';

  var BARRIER_PCT = 0.118;      /* 原文: 最終最大HPの11.8% */
  var BARRIER_SECONDS = 5;      /* 原文: 5秒間維持 */
  var SHOTS_PER_BARRIER = 120;  /* 原文: 通常攻撃で120回攻撃した時 */

  var BURST_HEAL_PCT = 0.0384;  /* 原文: 3.84%持続回復 */
  var BURST_HEAL_TICKS = 8;     /* 原文: 1秒間隔：8秒間維持（パーサが1回済み） */
  var FB_HEAL_PCT = 0.0368;     /* 原文: 3.68%持続回復 */
  var FB_HEAL_TICKS = 5;        /* 原文: 1秒間隔：5秒間維持（パーサが1回済み） */

  var BURST_CT_DOWN = 40.76;    /* 原文: バーストスキルクールタイム40.76秒▼ */
  var SQAD_777 = [21, 89];      /* 同じ部隊（777部隊）のノワール / ルージュ */

  var FB_FRAMES = 600;          /* フルバーストタイム 10秒 */

  /* スキル定義をこのユニット専用に複製する（SKILL_DB は全ユニット共有なので触らない） */
  function cloneSkills(u) {
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (!src || !u.skillState) return;
    u.skills = JSON.parse(JSON.stringify(src));
    for (var s = 0; s < u.skillState.length; s++) {
      var st = u.skillState[s];
      var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
      if (!arr) continue;
      for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
    }
  }

  function sameSquadAlly(u, E) {
    var team = E.alive(E.team(u));
    for (var i = 0; i < team.length; i++) {
      if (team[i] === u) continue;
      if (SQAD_777.indexOf(team[i].id) >= 0) return true;
    }
    return false;
  }

  (window.SPECIALS = window.SPECIALS || {})[128] = {
  /* 毎秒回復はここで実装している */
  suppress: { skill2: [0], burst: [0] },
    init: function (u, E) {
      cloneSkills(u);
      /* スキル2の2番目のブロック（バーストCT短縮）は自分専用なので止める */
      if (u.skills && u.skills.skill2 && u.skills.skill2.blocks[1]) {
        u.skills.skill2.blocks[1].trigger = { kind: 'disabled' };
      }
      u.blanc = {
        shots: 0,
        barrier: null,       /* { until, per: { pos: amount } } */
        healQueue: [],       /* { at, pct, left } */
        fbFrame: -1,
        lastBurstFrame: -1
      };
    },

    tick: function (u, E, frame) {
      var s = u.blanc;
      if (!s) return;

      /* ---- 共用バリアの期限切れ：付与したぶんの残りだけ剥がす */
      if (s.barrier && frame >= s.barrier.until) {
        var list = E.alive(E.team(u));
        for (var i = 0; i < list.length; i++) {
          var a = list[i];
          var amt = s.barrier.per[a.pos] || 0;
          if (amt > 0 && a.shield > 0) a.shield = Math.max(0, a.shield - amt);
        }
        s.barrier = null;
      }

      /* ---- 持続回復の残りティック */
      if (s.healQueue.length) {
        var keep = [];
        for (var h = 0; h < s.healQueue.length; h++) {
          var q = s.healQueue[h];
          if (frame < q.at) { keep.push(q); continue; }
          var allies = E.alive(E.team(u));
          for (var k = 0; k < allies.length; k++) {
            E.heal(allies[k], u.hpMax * q.pct, frame);
          }
          q.left -= 1;
          if (q.left > 0) { q.at = frame + E.FPS; keep.push(q); }
        }
        s.healQueue = keep;
      }

      /* ---- フルバーストタイムの開始／終了 */
      var lb = E.team(u).lastBurst;
      if (lb && lb.frame !== s.lastBurstFrame) {
        s.lastBurstFrame = lb.frame;
        if (lb.stage === 'B3') s.fbFrame = lb.frame;
      }
      if (s.fbFrame >= 0 && frame >= s.fbFrame + FB_FRAMES + 1) {
        s.fbFrame = -1;
        /* フルバースト終了時：3.68%を5秒間（パーサが1回ぶん済み） */
        s.healQueue.push({ at: frame + E.FPS, pct: FB_HEAL_PCT, left: FB_HEAL_TICKS - 1 });
        /* 同じ部隊の味方がいれば、自分のバーストCTを40.76秒短縮 */
        if (sameSquadAlly(u, E)) {
          u.burstReadyAt = Math.max(0, u.burstReadyAt - BURST_CT_DOWN * E.FPS);
          E.event({ frame: frame, kind: 'blanc-cd', side: u.side, unit: u.name });
        }
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = u.blanc;
      if (!s) return;
      var prev = s.shots;
      s.shots += 1;                       /* 通常攻撃の回数（命中数ではない） */
      if (Math.floor(s.shots / SHOTS_PER_BARRIER) <=
          Math.floor(prev / SHOTS_PER_BARRIER)) return;

      var allies = E.alive(E.team(u));
      if (!allies.length) return;
      var pool = u.hpMax * BARRIER_PCT;
      var each = pool / allies.length;
      var per = {};
      for (var i = 0; i < allies.length; i++) {
        var m = allies[i];
        m.shield = Math.max(m.shield, each);
        per[m.pos] = each;
      }
      s.barrier = { until: frame + BARRIER_SECONDS * E.FPS, per: per };
      E.event({ frame: frame, kind: 'blanc-barrier', side: u.side, unit: u.name, amount: pool });
    },

    onBurst: function (u, E, frame) {
      var s = u.blanc;
      if (!s) return;
      /* バーストの持続回復 3.84% × 8秒（パーサが1回ぶん済み） */
      s.healQueue.push({ at: frame + E.FPS, pct: BURST_HEAL_PCT, left: BURST_HEAL_TICKS - 1 });
    }
  };
})();
