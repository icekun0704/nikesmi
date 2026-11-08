/* シン：スウィフトバニー (id 228, SR, B3)
 *
 * パーサで表現できなかった部分:
 *   - バニーモード（スタンス／エンゲージ）の状態機械
 *       戦闘開始時はスタンス。フルチャージ状態を1秒以上維持すると切替。
 *       自分にモードが適用されると、逆モードの味方も同じモードになる。
 *   - エンハンスバレット（スタンス時のみ）：クリティカル確率35.14%・
 *     クリティカルダメージ75.12%（解除不可なので、モード中だけのオーラ）
 *   - スウィフトキャロット（バースト後5秒）：チャージ時間0.5秒固定
 *   - スキル1「フルチャージした時、スウィフトキャロット状態でなければ
 *     通常攻撃ダメージ倍率100%・チャージダメージ52.12%（1発間）」
 *     パーサは unparsed にしている。1発ぶんの追加ダメージとして同じ倍率で撃つ。
 *
 * 実装していないもの:
 *   - ノイズバレット（エンゲージ時）：通常攻撃を防御力無視に変えるフックが無い
 *     （weapon 単位のダメージ計算を差し替える口が engine に無いため）
 *   - スウィフトキャロットの武器ダメージ（73.22% / フルチャージ300%）：
 *     通常攻撃の倍率そのものを差し替える口が無い
 *   - バーストの 958.9% / 854.6% の条件分岐は parser が両方 unconditional で
 *     適用してしまっているため、二重計上を避けて触らない
 */
(function () {
  'use strict';

  /* E.pickTarget は README では (u, frame) だが engine の実装は (u, enemies, frame)。 */
  function pick(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  function st(u) {
    if (!u.bunny) {
      u.bunny = { mode: null, hold: 0, toggledFor: -1, carrotUntil: -1, prevChargeFixed: 0 };
    }
    return u.bunny;
  }

  /* モードを適用し、逆モードの味方にも同じモードを配る */
  function setMode(u, E, mode, frame) {
    var s = st(u);
    if (s.mode === mode) return;
    s.mode = mode;
    E.event({ frame: frame, kind: 'bunny-mode', side: u.side, unit: u.name, mode: mode });

    var allies = E.team(u) || [];
    for (var i = 0; i < allies.length; i++) {
      var a = allies[i];
      if (a === u || !a.alive) continue;
      var as = st(a);
      if (as.mode && as.mode !== mode) setMode(a, E, mode, frame);
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[228] = {
    init: function (u, E) {
      var s = st(u);
      s.mode = 'stance';   // 戦闘開始時：スタンス状態でなければスタンス
    },

    tick: function (u, E, frame) {
      var s = st(u);

      /* フルチャージ状態を1秒以上維持したか。
       * engine の射撃モデルでは「フルチャージ完了後から発射まで」が
       * フルチャージ状態なので、その連続フレームを数える。 */
      if (u.firing && u.firing.chargeFrames > 0) {
        var holdWindow = u.firing.interval - u.firing.chargeFrames;
        var untilShot = u.firing.nextFrame - frame;
        if (holdWindow > 0 && untilShot > 0 && untilShot <= holdWindow) s.hold += 1;
        else s.hold = 0;
        // 同じ射撃サイクルで二度切り替えない
        if (s.hold >= 60 && s.toggledFor !== u.firing.nextFrame) {
          s.toggledFor = u.firing.nextFrame;
          s.hold = 0;
          setMode(u, E, s.mode === 'stance' ? 'engage' : 'stance', frame);
        }
      } else {
        s.hold = 0;
      }

      // スウィフトキャロットの終了
      if (s.carrotUntil >= 0 && frame > s.carrotUntil) {
        u.chargeFixed = s.prevChargeFixed;
        s.carrotUntil = -1;
        E.event({ frame: frame, kind: 'carrot-end', side: u.side, unit: u.name });
      }

      // エンハンスバレット（スタンス状態の時のみ）
      if (s.mode === 'stance') {
        E.buff(u, 'bunny-enhance-rate', 'critRate', 35.14, 'up', frame + 1, { aura: true });
        E.buff(u, 'bunny-enhance-dmg', 'critDmgPct', 75.12, 'up', frame + 1, { aura: true });
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = st(u);

      // スウィフトキャロット中は別武器なのでスキル1の1発バフは乗らない
      if (s.carrotUntil >= 0 && frame <= s.carrotUntil) return;

      var t = pick(u, E, frame);
      if (!t || !t.alive) return;
      var wm = (u.char && u.char.stats && u.char.stats.weaponDamage) || 10;
      var cm = (u.char && u.char.stats && u.char.stats.maxCharge)
        ? u.char.stats.maxCharge / 100 : null;

      /* 通常攻撃ダメージ倍率100%（1発間）＝同じ倍率でもう1発ぶん */
      E.damage(u, t, frame, { multiplierPct: wm, chargeMult: cm });
      /* チャージダメージ52.12%（1発間） */
      E.damage(u, t, frame, { multiplierPct: wm * 0.5212, chargeMult: cm });
    },

    onBurst: function (u, E, frame) {
      var s = st(u);

      // スウィフトキャロット：使用武器変更・チャージ時間0.5秒固定・5秒間
      if (s.carrotUntil < frame) s.prevChargeFixed = u.chargeFixed || 0;
      u.chargeFixed = 30;                  // 0.5秒
      s.carrotUntil = frame + 5 * E.FPS;
      E.event({ frame: frame, kind: 'carrot', side: u.side, unit: u.name });
    }
  };
})();
