/* プリカ (id 221, SR, B2, 支援型) — 宝物なし
 *
 * パーサで表現できなかった部分:
 *   - burst「パフォーマンス」: 味方全体に25秒間の状態を付与する。
 *     パーサは効果1（最終最大HPの3.04%持続回復・1秒間隔25秒）を「1回だけの回復」として
 *     解釈しており、持続分（24 tick）が抜けている。ここで残りを毎秒回復する。
 *     付与先の「パフォーマンス状態」そのものもエンジンは持っていないので u.prikaPerfUntil で持つ。
 *   - skill1「自分がパフォーマンス状態の時に限り、自分に 与えるHP回復量49.92%▲」は
 *     trigger=unknown で発火しない。
 *   - skill2「シンガロングが適用された時、自分がパフォーマンス状態なら」のアンコール
 *     （trigger=unknown）。効果2「味方全体にパフォーマンス維持時間21秒▲」は unparsed、
 *     効果3（攻撃ダメージ25.01%▲ 10秒）と効果4（バーストCT -21秒）は数値はあるが未発火。
 *
 * シンガロングはミン（id 193）のバーストが味方全体へ付与する
 * atkDmgPct 30.02% / label "シンガロング" のバフ。label が渡らない実装でも
 * 値（atkDmgPct 30.02）で識別できるようにしてある。
 *
 * 不明点:
 *   - 「1秒間隔：25秒間維持」の初回tickがバースト直後か1秒後か。
 *     エンジンがバースト時に1回回復するので、残り24 tick（1秒後〜24秒後）とした。
 *   - 効果1「シンガロングのスキル発動者にステージパート：ボーカル」は
 *     ミン側の状態機械（別キャラ）なのでここでは付与しない。
 */
(function () {
  'use strict';

  var FPS = 60;
  var PERF_SECONDS = 25;
  var HOT_SECONDS = 25;
  var HOT_VALUE = 3.04;        // スキル発動者の最終最大HPの3.04%
  var RECOVERY_GIVEN = 49.92;  // 与えるHP回復量▲
  var ENCORE_EXTEND = 21;      // パフォーマンス維持時間21秒▲
  var ENCORE_ATKDMG = 25.01;   // 味方全体に攻撃ダメージ▲（10秒）
  var ENCORE_CD = 21;          // 自分にバーストスキルクールタイム21秒
  var SINGALONG_ATKDMG = 30.02;

  function isSingalongBuff(b, frame) {
    if (!b || b.until < frame) return false;
    if (b.label === 'シンガロング') return true;
    return b.stat === 'atkDmgPct' && Math.abs((b.value || 0) - SINGALONG_ATKDMG) < 1e-6;
  }

  (window.SPECIALS = window.SPECIALS || {})[221] = {
    init: function (u, E) {
      u.prika = {
        hot: null,          // { next, left }
        perfCast: -1,       // 直近のパフォーマンス付与フレーム
        lastSing: -1,       // 最後に反応したシンガロングの until
        pendingCd: 0        // fireBurst が CT を上書きするので次フレームで引く
      };
    },

    tick: function (u, E, frame) {
      var st = u.prika;
      if (!st) return;

      var perf = u.prikaPerfUntil == null ? -1 : u.prikaPerfUntil;

      // パフォーマンス状態の間: 自分に「与えるHP回復量49.92%▲」
      if (frame <= perf) {
        E.buff(u, 'prika-perf', 'recoveryGivenPct', RECOVERY_GIVEN, 'up', perf,
               { label: 'パフォーマンス' });
      }

      // パフォーマンスの持続回復（残り24 tick）
      var hot = st.hot;
      if (hot && frame > perf) st.hot = null;
      else if (hot && hot.left > 0 && frame >= hot.next) {
        hot.left -= 1;
        hot.next += FPS;
        var allies = E.alive(E.team(u));
        var amount = u.hpMax * HOT_VALUE / 100;
        for (var i = 0; i < allies.length; i++) E.heal(allies[i], amount, frame);
      }

      // アンコールのバーストCT短縮（burstReadyAt は onBurst の後に上書きされる）
      if (st.pendingCd > 0) {
        u.burstReadyAt = Math.max(0, u.burstReadyAt - st.pendingCd);
        st.pendingCd = 0;
      }

      // シンガロングが適用された時（新しい付与のみ）
      if (frame > perf) return;
      var sing = null;
      for (var b = 0; b < u.buffs.length; b++) {
        var bf = u.buffs[b];
        if (isSingalongBuff(bf, frame) && bf.until > st.lastSing) { sing = bf; break; }
      }
      if (!sing) return;
      st.lastSing = sing.until;

      // 効果2: 味方全体にパフォーマンス維持時間21秒▲
      var team = E.alive(E.team(u));
      var add = ENCORE_EXTEND * FPS;
      for (var k = 0; k < team.length; k++) {
        var a = team[k];
        var cur = a.prikaPerfUntil == null ? perf : a.prikaPerfUntil;
        a.prikaPerfUntil = Math.max(cur, perf) + add;
        // パフォーマンスが配るチャージダメージ25%▲の残り時間も同じだけ延ばす
        for (var j = 0; j < a.buffs.length; j++) {
          var ab = a.buffs[j];
          if (ab.stat !== 'chargeDmgPct') continue;
          if (Math.abs((ab.value || 0) - 25) > 1e-6) continue;
          if (ab.until < frame) continue;
          if (st.perfCast >= 0 && ab.until > st.perfCast + PERF_SECONDS * FPS + 1) continue;
          ab.until += add;
        }
      }
      // 自分の持続回復も同じだけ延長（tick の間隔は変えない）
      if (st.hot) st.hot.left += ENCORE_EXTEND;

      // 効果3: 味方全体に攻撃ダメージ25.01%▲ 10秒
      for (var m = 0; m < team.length; m++) {
        E.buff(team[m], 'prika-encore', 'atkDmgPct', ENCORE_ATKDMG, 'up', frame + 10 * FPS, {});
      }
      // 効果4: 自分にバーストスキルクールタイム21秒
      st.pendingCd = ENCORE_CD * FPS;

      E.event({ frame: frame, kind: 'prika-encore', side: u.side, unit: u.name });
    },

    onShot: function (u, E, frame, shot) {},

    onBurst: function (u, E, frame) {
      var st = u.prika;
      if (!st) return;
      var team = E.alive(E.team(u));
      for (var i = 0; i < team.length; i++) team[i].prikaPerfUntil = frame + PERF_SECONDS * FPS;
      st.perfCast = frame;
      st.hot = { next: frame + FPS, left: HOT_SECONDS - 1 };
    }
  };
})();
