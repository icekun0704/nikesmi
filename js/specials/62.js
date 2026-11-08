/* エーテル (id 62, SG, B1)
 *
 * パーサで表現できなかった部分:
 *   - バースト「HPが最も低い味方3機に 最終最大HPの96%のバリア：5秒間維持」
 *     ・パーサは target.pick を null のままにしているため engine は
 *       「編成順で先頭の3機」に付与してしまう。ここでバースト直後の
 *       シールドを巻き戻し、HPが最も低い3機へ付け直す。
 *     ・バリアの5秒の維持時間（engine の shield は時間を持たない）も管理する。
 *   - スキル2「フルバーストタイム持続中に発動した時、同一の敵に
 *     防御力9.38%▼：6秒間維持」が trigger:unknown。
 *     13秒周期の発動時にフルバースト中なら、同じ3機（防御力が高い順）へ付与する。
 *
 * 実装していないもの:
 *   - スキル1「HPが最も低い味方1機に 受けるダメージ52.5%▼」の対象選択
 *     （パーサは pick:null で編成順の先頭に付与している）。バフの付け替えは
 *     できるが、周期発動と同フレームでしか判定できず取りこぼすため触らない。
 */
(function () {
  'use strict';

  function st(u) {
    if (!u.ether) {
      u.ether = { nextS2: 0, pending: null, barriers: [] };
    }
    return u.ether;
  }

  function lowestHp(E, u, n) {
    var list = E.alive(E.team(u)).slice();
    list.sort(function (a, b) { return a.hp - b.hp; });
    return list.slice(0, n);
  }

  function highestDef(E, u, n) {
    var list = E.alive(E.enemies(u)).slice();
    list.sort(function (a, b) {
      return (b.def * (1 + E.sumStat(b, 'defPct') / 100)) -
             (a.def * (1 + E.sumStat(a, 'defPct') / 100));
    });
    return list.slice(0, n);
  }

  function fullBurstActive(E, u, frame) {
    var lb = (E.team(u) || []).lastBurst;
    return !!(lb && lb.stage === 'B3' && frame <= lb.frame + 10 * E.FPS);
  }

  (window.SPECIALS = window.SPECIALS || {})[62] = {
    init: function (u, E) {
      st(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);

      // バースト直後：パーサが編成順の3機に付けたバリアを巻き戻して付け直す
      if (s.pending && frame >= s.pending.frame) {
        var snap = s.pending.snap;
        var i;
        for (i = 0; i < snap.length; i++) snap[i].unit.shield = snap[i].shield;
        s.pending = null;

        var amt = Math.round(u.hpMax * 0.96);
        var targets = lowestHp(E, u, 3);
        for (i = 0; i < targets.length; i++) {
          var t = targets[i];
          var prev = t.shield;
          t.shield = Math.max(t.shield, amt);
          s.barriers.push({
            unit: t,
            added: Math.max(0, t.shield - prev),
            prev: prev,
            until: frame + 5 * E.FPS
          });
        }
        E.event({ frame: frame, kind: 'ether-barrier', side: u.side, unit: u.name,
                  targets: targets.map(function (x) { return x.pos; }) });
      }

      // 5秒経過したバリアの残量を落とす
      for (var k = s.barriers.length - 1; k >= 0; k--) {
        var b = s.barriers[k];
        if (frame <= b.until) continue;
        var leftover = Math.max(0, Math.min(b.added, b.unit.shield - b.prev));
        b.unit.shield = Math.max(0, b.unit.shield - leftover);
        s.barriers.splice(k, 1);
      }

      // スキル2：13秒周期。フルバースト持続中なら同じ3機に防御力9.38%▼
      if (frame >= s.nextS2) {
        s.nextS2 = frame + 13 * E.FPS;
        if (fullBurstActive(E, u, frame)) {
          var foes = highestDef(E, u, 3);
          for (var m = 0; m < foes.length; m++) {
            E.buff(foes[m], 'ether-defdown:' + u.pos + ':' + foes[m].pos,
              'defPct', 9.38, 'down', frame + 6 * E.FPS);
          }
        }
      }
    },

    onBurst: function (u, E, frame) {
      var s = st(u);
      var team = E.team(u) || [];
      var snap = [];
      for (var i = 0; i < team.length; i++) {
        if (!team[i].alive) continue;
        snap.push({ unit: team[i], shield: team[i].shield });
      }
      s.pending = { frame: frame, snap: snap };
    }
  };
})();
