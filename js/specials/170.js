/* ロザンナ (id 170, MG, B1, 火力型) — 宝物なし
 *
 * パーサで表現できなかった部分:
 *   - 隠れ身: 戦闘開始時5秒 / 通常攻撃120回命中ごとに10秒。
 *     直接攻撃を受けると解除（被ダメージが増えたフレームで解除）。
 *     ※ engine に「単一攻撃の対象から除外する」処理が無いので、
 *       隠れ身は「バーストの追加ダメージ条件」としてのみ使っている。
 *   - バースト: 隠れ身状態なら、アサルトの命中した対象（火力型の敵2機）に
 *     最終攻撃力561.6%の追加ダメージ
 *   - skill2: 味方が戦闘不能になるたび、狂気（攻撃力22.61%▲・10スタック・30秒）と
 *     バーストゲージ36.54%
 *   - skill1: 通常攻撃10回命中時、攻撃力が最も高い敵2機のバフを5個解除（戦闘中1回）
 *     （パーサは buffClear という op を作るが engine 側に処理が無い）
 *
 * 宝物（Treasure1/2/3）専用行はこの形態には付かないので実装しない。
 */
(window.SPECIALS = window.SPECIALS || {})[170] = {
  init: function (u, E) {
    u.rosanna = {
      hideUntil: 5 * E.FPS,     // 戦闘開始時5秒
      lastTaken: 0,
      lastAlive: E.alive(E.team(u)).length,
      buffCleared: false
    };
  },

  tick: function (u, E, frame) {
    var r = u.rosanna;
    if (!r) return;

    /* 直接攻撃を受けると隠れ身解除 */
    if (r.hideUntil > frame && u.damageTaken > r.lastTaken) r.hideUntil = -1;
    r.lastTaken = u.damageTaken;

    /* 味方が戦闘不能になるたび: 狂気 + バーストゲージ36.54% */
    var alive = E.alive(E.team(u)).length;
    if (alive < r.lastAlive) {
      var down = r.lastAlive - alive;
      for (var i = 0; i < down; i++) {
        E.buff(u, 'rosanna-madness', 'atkPct', 22.61, 'up', frame + 30 * E.FPS, { maxStacks: 10 });
        E.gauge(u.side, 36.54);
      }
      E.event({ frame: frame, kind: 'rosanna-madness', side: u.side, unit: u.name, stacks: down });
    }
    r.lastAlive = alive;
  },

  onShot: function (u, E, frame, shot) {
    var r = u.rosanna;
    if (!r) return;

    /* 通常攻撃120回命中ごと: 隠れ身10秒 */
    var hits = u.counters.attackHits;
    if (hits > 0 && hits % 120 === 0) r.hideUntil = frame + 10 * E.FPS;

    /* 通常攻撃10回命中時（戦闘中1回）: 攻撃力が最も高い敵2機のバフを5個解除 */
    if (!r.buffCleared && hits >= 10) {
      r.buffCleared = true;
      var foes = E.alive(E.enemies(u));
      foes.sort(function (a, b) { return E.atkEff(b) - E.atkEff(a); });
      foes = foes.slice(0, 2);
      for (var i = 0; i < foes.length; i++) {
        var f = foes[i];
        var removed = 0;
        f.buffs = f.buffs.filter(function (b) {
          if (removed >= 5) return true;
          if (b.dir !== 'up' || b.value <= 0) return true;
          removed += 1;
          return false;
        });
        E.event({ frame: frame, kind: 'rosanna-buffclear', side: u.side, unit: u.name,
                  target: f.name, removed: removed });
      }
    }
  },

  onBurst: function (u, E, frame) {
    var r = u.rosanna;
    if (!r || r.hideUntil < frame) return;
    /* アサルトの命中した対象（火力型の敵2機）へ561.6%の追加ダメージ */
    var foes = E.alive(E.enemies(u)).filter(function (e) { return e.char.classType === '火力型'; });
    if (!foes.length) foes = E.alive(E.enemies(u));
    foes.sort(function (a, b) { return a.pos - b.pos; });
    foes = foes.slice(0, 2);
    for (var i = 0; i < foes.length; i++) {
      E.damage(u, foes[i], frame, { multiplierPct: 561.6, isBurst: true });
    }
    E.event({ frame: frame, kind: 'rosanna-assault-extra', side: u.side, unit: u.name, targets: foes.length });
  }
};
