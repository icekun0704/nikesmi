/* エイダ・ウォン (id 52 / org 168)
 *
 * パーサが表現できていない部分だけを実装する。
 *  - スキル1のトリガー（フルバーストタイム発動時／基本バースト段階3の味方）を
 *    正しく直し、パーサが0フレーム目に入れてしまった分を差し替える
 *  - スキル2「フルバーストタイム発動中、2秒ごとに照準線に最も近い攻撃範囲内の敵に
 *    420%の防御力無視ダメージ」
 *  - バースト「閃光手榴弾投擲の発動間隔1秒▼：10秒間維持」
 *  - バースト「特殊改造：チャージ速度300%▼／チャージダメージ1500%▲：1発間維持」
 *    （パーサは持続時間を無限として入れてしまうため、1発撃ったら外す）
 */
(function () {
  function removePrefix(unit, prefix) {
    if (!unit || !unit.buffs) return;
    for (var i = unit.buffs.length - 1; i >= 0; i--) {
      if (String(unit.buffs[i].key).indexOf(prefix) === 0) unit.buffs.splice(i, 1);
    }
  }

  function isB3(a) { return /B3/.test(String(a.char && a.char.burstStage)); }

  function pick(u, E, frame) {
    var es = E.alive(E.enemies(u));
    if (!es.length) return null;
    var taunt = es.filter(function (x) { return x.tauntUntil >= frame; });
    if (taunt.length) {
      taunt.sort(function (a, b) { return a.pos - b.pos; });
      return taunt[0];
    }
    var right = u.weapon === 'SR';
    es.sort(function (a, b) { return right ? b.pos - a.pos : a.pos - b.pos; });
    return es[0];
  }

  function applySkill1(u, E, frame) {
    var team = E.team(u), i;
    for (i = 0; i < team.length; i++) {
      var a = team[i];
      if (!a.alive || !isB3(a)) continue;
      // スキル発動者基準で攻撃力60%▲：10秒間維持
      E.buff(a, 'ada-atk-' + a.pos, 'atkFlat', E.atkEff(u) * 0.60, 'up', frame + 10 * E.FPS);
      // 防御力無視ダメージ50%▲：10秒間維持
      E.buff(a, 'ada-idef-' + a.pos, 'ignoreDefDmgPct', 50, 'up', frame + 10 * E.FPS);
      // 攻撃ダメージの10%回復：10秒間維持
      a.lifestealPct = Math.max(a.lifestealPct || 0, 10);
    }
    u.ada.leechUntil = frame + 10 * E.FPS;
    u.ada.leechTargets = team.filter(function (x) { return isB3(x); });
  }

  (window.SPECIALS = window.SPECIALS || {})[52] = {
    init: function (u, E) {
      u.ada = {
        patched: false,
        fbFrame: -1,
        lastBurstFrame: -1,
        nextGrenade: -1,
        accelUntil: -1,
        pendingShotBuff: false,
        leechUntil: -1,
        leechTargets: []
      };
    },

    tick: function (u, E, frame) {
      var st = u.ada;
      if (!st) return;
      var team = E.team(u), i;

      // パーサが「常時」として0フレーム目に入れてしまったスキル1を外す
      if (!st.patched) {
        st.patched = true;
        for (i = 0; i < team.length; i++) {
          removePrefix(team[i], u.side + u.pos + ':skill1:0:');
        }
        if (u.lifestealPct === 10) u.lifestealPct = 0;
      }

      // フルバーストタイムの発動（直前に B3 バーストが撃たれた）
      var lb = team.lastBurst;
      if (lb && lb.frame !== st.lastBurstFrame) {
        st.lastBurstFrame = lb.frame;
        if (lb.stage === 'B3') {
          st.fbFrame = lb.frame;
          st.nextGrenade = lb.frame + 2 * E.FPS;   // 2秒ごと
          applySkill1(u, E, lb.frame);
        }
      }

      // フルバーストタイム発動中、2秒ごとに照準線に最も近い攻撃範囲内の敵に
      // 最終攻撃力の420%の防御力無視ダメージ
      var fbActive = st.fbFrame >= 0 && frame <= st.fbFrame + 10 * E.FPS;
      if (fbActive && frame >= st.nextGrenade && u.alive) {
        var target = pick(u, E, frame);
        if (target) {
          var range = (u.char.rlExplosionRange == null ? 1 : u.char.rlExplosionRange);
          var hits = E.slotsInRange(E.enemies(u), target.pos, range);
          for (i = 0; i < hits.length; i++) {
            E.damage(u, hits[i], frame, { multiplierPct: 420, ignoreDef: true });
          }
        }
        // 発動間隔1秒▼（バースト後10秒）
        st.nextGrenade = frame + (frame <= st.accelUntil ? E.FPS : 2 * E.FPS);
      }

      // 攻撃ダメージの10%回復の終了
      if (st.leechUntil >= 0 && frame > st.leechUntil) {
        st.leechUntil = -1;
        for (i = 0; i < st.leechTargets.length; i++) {
          st.leechTargets[i].lifestealPct = 0;
        }
        st.leechTargets = [];
      }
    },

    onBurst: function (u, E, frame) {
      var st = u.ada;
      if (!st) return;
      // 閃光手榴弾投擲の発動間隔1秒▼：10秒間維持
      st.accelUntil = frame + 10 * E.FPS;
      // 特殊改造の1発間維持を、次の射撃後に解除する
      st.pendingShotBuff = true;
    },

    onShot: function (u, E, frame, shot) {
      var st = u.ada;
      if (!st || !st.pendingShotBuff) return;
      st.pendingShotBuff = false;
      // 効果1：チャージ速度300%▼ / 効果2：チャージダメージ1500%▲（1発間維持）
      var prefix = u.side + u.pos + ':burst:0:';
      for (var i = u.buffs.length - 1; i >= 0; i--) {
        var b = u.buffs[i];
        if (String(b.key).indexOf(prefix) !== 0) continue;
        if (b.stat === 'chargeDmgPct' || b.stat === 'chargeSpeedPct') u.buffs.splice(i, 1);
      }
    }
  };
})();
