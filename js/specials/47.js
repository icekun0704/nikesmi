/* クラスト (id 47, RL, B2)
 *
 * パーサで表現できなかった部分:
 *   - メイラード / ブランチング / たっぷりクッキング の状態管理
 *       「フルチャージ状態を1秒以上維持して3回攻撃した時」＝パーサは
 *       trigger:unknown にしており一度も発動しない。ここで
 *       フルチャージ完了後から発射までの保持フレーム
 *       （= 射撃間隔 - チャージ所要）が60フレーム以上ある状態での
 *       3回目の攻撃を数える。
 *       発動時は味方全体へ
 *         ブランチング：発動者基準 攻撃力10%▲ / 10秒 / メイラード解除
 *         たっぷりクッキング：発動者基準 防御力10%▲ / 10秒 / デバフ解除1個
 *       （スキル1・スキル2の unknown ブロックの効果をここで適用する）
 *   - フルチャージして攻撃した時、メイラード／ブランチング状態なら
 *     持続時間 +2.5秒（unparsed）。状態タイマーと、こちらのブランチング
 *     バフの until を 150 フレーム延ばす。
 *
 * 実装していないもの（engine 側に受け皿が無い）:
 *   - オート射撃ではフルチャージ状態を1秒以上保持できない（RL は
 *     チャージ60F・次弾まで76F のため保持は16F）。したがって現状の
 *     アリーナ再現では上記の切替は実質発動しない。原文どおりの条件のみ書く。
 *   - バーストの「メイラード状態なら分配60%▲ / ブランチング状態なら持続10%▲」
 *     はパーサが条件を落として常時適用している。解除できないため触らない。
 *   - 「フルチャージではない通常攻撃を3回」の分岐（パーサは attackShots の
 *     カウンタで代用して毎3回発動させている）も RL では発生しない。
 */
(function () {
  'use strict';

  function st(u) {
    if (!u.kraste) {
      u.kraste = { maillard: -1, branching: -1, cooking: -1, hold: 0, held: false, fc: 0 };
    }
    return u.kraste;
  }

  function clearOneDebuff(a, frame) {
    var bs = a.buffs || [];
    for (var i = 0; i < bs.length; i++) {
      if (bs[i].dir === 'down' && bs[i].until >= frame) {
        bs[i].until = frame;
        return true;
      }
    }
    return false;
  }

  /* ブランチング：味方全体（メイラード解除） */
  function grantBranching(u, E, frame) {
    var team = E.team(u) || [];
    var atk = E.atkEff(u) * 0.10;   // スキル発動者基準
    for (var i = 0; i < team.length; i++) {
      var a = team[i];
      if (!a.alive) continue;
      var s = st(a);
      s.branching = frame + 10 * E.FPS;
      s.maillard = -1;
      E.buff(a, 'kraster-branching', 'atkFlat', atk, 'up', frame + 10 * E.FPS);
    }
    E.event({ frame: frame, kind: 'branching', side: u.side, unit: u.name });
  }

  /* たっぷりクッキング：まだ掛かっていない味方全体（デバフ解除1個） */
  function grantCooking(u, E, frame) {
    var team = E.team(u) || [];
    var def = u.def * (1 + E.sumStat(u, 'defPct') / 100);   // スキル発動者基準
    for (var i = 0; i < team.length; i++) {
      var a = team[i];
      if (!a.alive) continue;
      var s = st(a);
      if (s.cooking >= frame) continue;
      s.cooking = frame + 10 * E.FPS;
      E.buff(a, 'kraster-cooking', 'defFlat', def * 0.10, 'up', frame + 10 * E.FPS);
      clearOneDebuff(a, frame);
    }
    E.event({ frame: frame, kind: 'cooking', side: u.side, unit: u.name });
  }

  (window.SPECIALS = window.SPECIALS || {})[47] = {
    init: function (u, E) {
      st(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);
      // フルチャージ状態の連続フレーム
      if (u.firing && u.firing.chargeFrames > 0) {
        // フルチャージ完了後〜次弾発射までが「フルチャージ状態」の保持時間
        var holdWindow = u.firing.interval - u.firing.chargeFrames;
        var untilShot = u.firing.nextFrame - frame;
        if (holdWindow > 0 && untilShot > 0 && untilShot <= holdWindow) {
          s.hold += 1;
          // 射撃フレームの tick で hold が 0 に戻るため、達成を別フラグで持ち越す
          if (s.hold >= 60) s.held = true;
        } else {
          s.hold = 0;
        }
      } else {
        s.hold = 0;
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = st(u);
      var team = E.team(u) || [];
      var i, a;

      // フルチャージして攻撃した時、メイラード／ブランチングの持続時間 +2.5秒
      if (u.firing && u.firing.chargeFrames > 0) {
        for (i = 0; i < team.length; i++) {
          a = team[i];
          if (!a.alive) continue;
          var as = st(a);
          if (as.maillard >= frame) {
            as.maillard += 150;
          }
          if (as.branching >= frame) {
            as.branching += 150;
            extendKey(a, 'kraster-branching', 150);
          }
        }
      }

      // 「フルチャージ状態を1秒以上維持して3回攻撃した時」
      if (s.held) {
        s.held = false;
        s.fc += 1;
        if (s.fc >= 3) {
          s.fc = 0;
          grantBranching(u, E, frame);
          grantCooking(u, E, frame);
        }
      }
    }
  };

  function extendKey(u, key, add) {
    if (!add) return;
    var bs = u.buffs || [];
    for (var i = 0; i < bs.length; i++) {
      if (bs[i].key === key) bs[i].until += add;
    }
  }
})();
