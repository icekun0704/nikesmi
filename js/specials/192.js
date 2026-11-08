/* ネオン：ビジョンアイ (id 192, RL, B3, 火力型)
 *
 * パーサで表現できなかった部分:
 *   - 火カゲージ（0〜100 の独自リソース。パーサは burst ゲージに変換してしまっている）
 *       戦闘開始時100 / 火カチャージ中は通常攻撃ごとに +2 / 火カチャージ終了時に +45
 *   - 火カチャージ状態と超火力状態（バーストの2分岐）
 *       火カゲージ < 100 → 10秒間 火カチャージ + 1チャージ
 *       火カゲージ = 100 → 10秒間 超火力 + 100消費
 *   - FB終了時、火カゲージがあるなら バーストゲージのチャージ速度 +5%×火カゲージ量（5秒）
 *   - skill1「攻撃を受けた時、健康体状態でなければ」
 *       無敵3秒（戦闘中5回）＋ 健康体（回復量+10.26%・20秒）。
 *     パーサは trigger=unknown なので一度も発動しない。
 *
 * 実装していないもの:
 *   - デバフ効果免疫∞個（engine にデバフ付与の仕組みが無い）
 *   - skill1 の「超火力状態追加効果 262.79%」（超火力でないときもパーサが
 *     追加ダメージを出してしまうが、既に与えたダメージは取り消せない）
 *   - バースト効果のうち上記2分岐の打ち分け（超火力バフは engine 側で消して調整）
 */
(window.SPECIALS = window.SPECIALS || {})[192] = {
  init: function (u, E) {
    u.neon = {
      fire: 100,           /* 火カゲージ */
      chargeUntil: -1,     /* 火カチャージの期限 */
      overfireUntil: -1,   /* 超火力の期限 */
      fbEndAt: -1,
      invulnLeft: 5,
      healthyUntil: -1,
      shotAnchor: 0,
      prevHp: u.hp,
      prevHpMax: u.hpMax
    };
  },

  tick: function (u, E, frame) {
    var s = u.neon;
    if (!s) return;

    /* ---- パーサは「火カゲージ」を burst ゲージに変換してしまっている。
     *       戦闘開始の100と、通常攻撃ごとの2を打ち消して、burst ゲージには
     *       一切影響させない（火カゲージはこのファイルで自前に持つ）。 */
    if (frame === 0) E.gauge(u.side, -100);
    var newShots = u.shots - s.shotAnchor;
    if (newShots > 0) {
      s.shotAnchor = u.shots;
      E.gauge(u.side, -2 * newShots);
    }

    /* ---- 被弾検知（HP の減少） */
    var lost = (s.prevHp - u.hp) - (u.hpMax - s.prevHpMax);
    s.prevHp = u.hp;
    s.prevHpMax = u.hpMax;

    /* ---- 火カチャージ状態の終了 */
    if (s.chargeUntil >= 0 && frame > s.chargeUntil) {
      s.chargeUntil = -1;
      s.fire = Math.min(100, s.fire + 45);
      E.event({ frame: frame, kind: 'neon-charge-end', side: u.side, unit: u.name, fire: s.fire });
    }

    /* ---- skill1: 攻撃を受けた時、健康体でなければ（無敵3秒・5回まで） */
    if (lost > 0 && frame > s.healthyUntil && s.invulnLeft > 0) {
      s.invulnLeft -= 1;
      u.invulnUntil = Math.max(u.invulnUntil, frame + 3 * E.FPS);
      s.healthyUntil = frame + 20 * E.FPS;
      E.buff(u, 'neon-healthy', 'recoveryTakenPct', 10.26, 'up', s.healthyUntil, { label: '健康体' });
      E.event({ frame: frame, kind: 'neon-healthy', side: u.side, unit: u.name, left: s.invulnLeft });
    }

    /* ---- 超火力でないときはパーサが置いた超火力バフ（攻撃ダメージ45.03%）を外す。
     *      バーストの2分岐をパーサが同時に適用してしまうため。 */
    if (frame > s.overfireUntil) {
      var key = u.side + u.pos + ':burst:1:stat:atkDmgPct';
      for (var i = u.buffs.length - 1; i >= 0; i--) {
        if (u.buffs[i].key.indexOf(key) === 0 && Math.abs(u.buffs[i].value - 45.03) < 0.001) {
          u.buffs.splice(i, 1);
        }
      }
    }

    /* ---- バースト3段階突入 = フルバースト開始。終了時刻を覚えておく */
    var lb = u.team && u.team.lastBurst;
    if (lb && lb.stage === 'B3' && lb.frame === frame) s.fbEndAt = frame + 10 * E.FPS;

    /* ---- フルバースト終了: 火カゲージがあればバーストゲージのチャージ速度 +5%×量（5秒） */
    if (s.fbEndAt >= 0 && frame >= s.fbEndAt) {
      s.fbEndAt = -1;
      if (s.fire > 0) {
        E.buff(u, 'neon-gauge', 'burstGaugePct', 5 * s.fire, 'up', frame + 5 * E.FPS, {});
        E.event({ frame: frame, kind: 'neon-gauge', side: u.side, unit: u.name, value: 5 * s.fire });
      }
    }
  },

  onShot: function (u, E, frame, shot) {
    var s = u.neon;
    if (!s) return;
    /* 火カチャージ状態中の通常攻撃で +2 */
    if (frame <= s.chargeUntil) s.fire = Math.min(100, s.fire + 2);
  },

  onBurst: function (u, E, frame) {
    var s = u.neon;
    if (!s) return;
    if (s.fire < 100) {
      s.chargeUntil = frame + 10 * E.FPS;
      s.fire = Math.min(100, s.fire + 1);
    } else {
      s.overfireUntil = frame + 10 * E.FPS;
      s.fire = 0;
    }
    E.event({ frame: frame, kind: 'neon-burst', side: u.side, unit: u.name,
              mode: s.chargeUntil >= frame ? 'charge' : 'overfire', fire: s.fire });
  }
};
