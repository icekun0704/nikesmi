/* センチ (id 7, RL, B2, 防御型) — 宝物なし
 *
 * パーサで表現できなかった部分:
 *   - skill2 の「味方共用バリア」（最終最大HPの6.38%、5秒、CT9秒）
 *     engine のシールドは1機ごとなので、共用プールを生存味方で等分して近似し、
 *     5秒後にその分だけ減算する。
 *   - skill1「フルチャージ攻撃が命中した時、スキル2のクールタイム9.16%▼」
 *     （engine にスキルCT短縮の口が無いため、残りCDを9.16%縮める）
 *
 * 宝物（Treasure1/2/3）専用行はこの形態には付かないので実装しない:
 *   - バーストの味方全体回復30.2% / 鉄甲コードへの有利コードダメージ5.69% /
 *     資材備蓄まわり（Treasure2）/ バリア7%（Treasure1）
 */
(window.SPECIALS = window.SPECIALS || {})[7] = {
  init: function (u, E) {
    u.centi = { next: 0, shield: null };
  },

  tick: function (u, E, frame) {
    var s = u.centi;
    if (!s) return;

    /* ---- 共用バリアの期限切れ */
    if (s.shield && frame >= s.shield.until) {
      var list = E.alive(E.team(u));
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        var amt = s.shield.per[a.pos] || 0;
        if (amt > 0 && a.shield > 0) a.shield = Math.max(0, a.shield - amt);
      }
      s.shield = null;
    }

    /* ---- skill2（CT9秒）: 味方共用バリア
     * スキル発動者の最終最大HPの6.38%。共用なのでプールを生存味方で等分して近似。 */
    if (frame >= s.next) {
      s.next = frame + 9 * E.FPS;
      var allies = E.alive(E.team(u));
      if (allies.length) {
        var pool = u.hpMax * 0.0638;
        var each = pool / allies.length;
        var per = {};
        for (var k = 0; k < allies.length; k++) {
          var m = allies[k];
          m.shield = Math.max(m.shield, each);
          per[m.pos] = each;
        }
        s.shield = { until: frame + 5 * E.FPS, per: per };
        E.event({ frame: frame, kind: 'centi-barrier', side: u.side, unit: u.name, amount: pool });
      }
    }
  },

  onShot: function (u, E, frame, shot) {
    /* フルチャージ攻撃＝RL/SR の通常攻撃（engine も同じ扱い）。
     * スキル2のクールタイムを9.16%短縮する。 */
    if (u.weapon !== 'RL' && u.weapon !== 'SR') return;
    var st = u.skillState[1];
    var s = u.centi;
    if (st && st.nextPeriodic > frame) {
      st.nextPeriodic = frame + (st.nextPeriodic - frame) * (1 - 0.0916);
    }
    /* 自前で回している skill2 の周期も同じだけ縮める */
    if (s && s.next > frame) {
      s.next = frame + (s.next - frame) * (1 - 0.0916);
    }
  },

  onBurst: function () { /* バースト効果はパーサが処理済み */ }
};
