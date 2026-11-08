/* シンデレラ：クリスタルウェーブ (id 215, MG, B3)
 *
 * パーサで表現できなかった部分:
 *   - 「5秒ごとに照準線に最も近い敵1機に 最終攻撃力の900%のダメージ」
 *     パーサは trigger:always + damage のみのブロックにしているため
 *     engine の runAlwaysSkills に「ダメージだけの常時ブロックは撃たない」
 *     と判定されて一度も発動しない。ここで5秒周期に実装する。
 *   - 「味方が消費した弾の合計が200発ごとに 味方全体にバーストゲージ12%」
 *     （counter の on:'ammoConsumed' は engine に無いので発動しない）
 *   - デコイ（スキル発動者の最終最大HP70.34%の分身）：engine にデコイの
 *     受け皿が無いので「存在している」フラグだけ持つ
 *   - フルバースト発動時、直前に自分がバーストを使用していれば
 *     コア活性中の敵全体へ 833.79%（非狙撃モード側）。
 *     パーサは片方を unknown、片方を damage のみの always にしており発動しない。
 *     （コアの活性状態は engine に無いので、アリーナでは常に成立とみなす）
 *
 * 実装していないもの:
 *   - 狙撃モードへの武器変更（MG→SR、チャージ1秒固定、弾薬消費40発、貫通特化）:
 *     engine の通常攻撃は buildSchedule で固定されており、戦闘中に武器を
 *     差し替える口が無い。したがって 1189.66% 側の分岐には入らない。
 *   - デコイの被弾肩代わり
 *   - 変更準備（リロード3秒固定）とリロード完了時のモード切替
 */
(function () {
  'use strict';

  /* E.pickTarget は README では (u, frame) だが engine の実装は (u, enemies, frame)。 */
  function pick(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  function st(u) {
    if (!u.cindCW) {
      u.cindCW = {
        decoy: false,
        next900: 300,     // 5秒ごと
        ammo: 0,
        lastShots: 0,
        fbFrame: -1
      };
    }
    return u.cindCW;
  }

  (window.SPECIALS = window.SPECIALS || {})[215] = {
    init: function (u, E) {
      var s = st(u);
      s.decoy = true;   // 戦闘開始時 デコイ
    },

    tick: function (u, E, frame) {
      var s = st(u);

      // 5秒ごと：照準線に最も近い敵1機へ900%
      if (frame >= s.next900) {
        s.next900 = frame + 5 * E.FPS;
        var t = pick(u, E, frame);
        if (t && t.alive) E.damage(u, t, frame, { multiplierPct: 900 });
      }

      // 味方が消費した弾の合計200発ごとにバーストゲージ12%
      var team = E.team(u) || [];
      var total = 0;
      for (var i = 0; i < team.length; i++) total += team[i].shots || 0;
      var delta = total - s.lastShots;
      if (delta > 0) {
        s.lastShots = total;
        s.ammo += delta;
        while (s.ammo >= 200) {
          s.ammo -= 200;
          E.gauge(u.side, 12);
          E.event({ frame: frame, kind: 'ammo-gauge', side: u.side, unit: u.name });
        }
      }

      // フルバースト発動時、直前に自分がバーストを使用していれば
      var lb = team.lastBurst;
      if (lb && lb.unit === u && lb.stage === 'B3' && lb.frame === frame && s.fbFrame !== frame) {
        s.fbFrame = frame;
        var foes = E.alive(E.enemies(u));
        for (var j = 0; j < foes.length; j++) {
          E.damage(u, foes[j], frame, { multiplierPct: 833.79 });
        }
        E.event({ frame: frame, kind: 'cw-fullburst', side: u.side, unit: u.name });
      }
    },

    onBurst: function (u, E, frame) {
      // バーストスキル使用時にもデコイを展開（持続）
      st(u).decoy = true;
    }
  };
})();
