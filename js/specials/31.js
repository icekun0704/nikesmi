/* アルカナ (id 31 / org 155)
 *
 * パーサが表現できていない部分だけを実装する。
 *  - 運命の輪のカード状態（バーストで電撃コードの味方全体に付与・10秒）
 *  - フルバーストタイム終了時、運命の輪のカード状態なら
 *    「直前にバーストスキルを使用した基本バースト段階が3の電撃コードの味方全体」に
 *      魔術師のカード：攻撃ダメージ180%▲：15秒
 *      力のカード：スキル発動者基準で攻撃力180%▲：15秒
 *
 * パーサは上記2つを「常時」として0フレーム目に全味方へ入れてしまっているため、
 * 0フレーム目に取り除き、本来のタイミング（FB終了時）へ入れ直す。
 * スキル2クールタイム75%▼は、このエンジンにスキル2の再使用間隔が無いため
 * 実装しない（スキル2はパッシブとして扱われている）。
 */
(function () {
  function removePrefix(unit, prefix) {
    if (!unit || !unit.buffs) return;
    for (var i = unit.buffs.length - 1; i >= 0; i--) {
      if (String(unit.buffs[i].key).indexOf(prefix) === 0) unit.buffs.splice(i, 1);
    }
  }

  function isB3Electric(a) {
    return /B3/.test(String(a.char && a.char.burstStage)) && a.element === '電撃';
  }

  (window.SPECIALS = window.SPECIALS || {})[31] = {
    init: function (u, E) {
      u.arc = {
        patched: false,
        fate: false,
        fbFrame: -1,
        lastBurstFrame: -1,
        applied: false
      };
    },

    tick: function (u, E, frame) {
      var st = u.arc;
      if (!st) return;
      var team = E.team(u), i;

      // パーサが「常時」で0フレーム目に入れた魔術師／力のカードを外す
      if (!st.patched) {
        st.patched = true;
        for (i = 0; i < team.length; i++) {
          removePrefix(team[i], u.side + u.pos + ':skill1:0:');
          removePrefix(team[i], u.side + u.pos + ':skill2:0:');
        }
      }

      // フルバーストタイムの発動
      var lb = team.lastBurst;
      if (lb && lb.frame !== st.lastBurstFrame) {
        st.lastBurstFrame = lb.frame;
        if (lb.stage === 'B3') {
          st.fbFrame = lb.frame;
          st.applied = false;
        }
      }

      // フルバーストタイムが終了した時
      if (st.fbFrame >= 0 && !st.applied && frame >= st.fbFrame + 10 * E.FPS) {
        st.applied = true;
        if (st.fate) {
          st.fate = false;
          for (i = 0; i < team.length; i++) {
            var a = team[i];
            if (!a.alive || !isB3Electric(a)) continue;
            // 魔術師のカード：攻撃ダメージ180%▲：15秒間維持
            E.buff(a, 'arc-magi-' + a.pos, 'atkDmgPct', 180, 'up', frame + 15 * E.FPS);
            // 力のカード：スキル発動者基準で攻撃力180%▲：15秒間維持
            E.buff(a, 'arc-power-' + a.pos, 'atkFlat',
              E.atkEff(u) * 1.80, 'up', frame + 15 * E.FPS);
          }
        } else {
          // 運命の輪のカード状態でないときは、パーサが常時入れてしまう
          // 死神のカード（バーストCT6秒▼／攻撃力50%▲5秒）を打ち消す
          u.burstReadyAt += 6 * E.FPS;
          for (i = 0; i < team.length; i++) {
            removePrefix(team[i], u.side + u.pos + ':skill2:1:');
          }
        }
      }
    },

    onBurst: function (u, E, frame) {
      if (!u.arc) return;
      // 運命の輪のカード（10秒間維持）
      u.arc.fate = true;
    }
  };
})();
