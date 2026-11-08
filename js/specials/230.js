/* ミハラ：ボンディングチェーン (id 230, MG, B3, 火力型)
 *
 * パーサで表現できなかった部分:
 *   - キャプチャーチェーン（最大10）の管理
 *       戦闘開始時 +10 / フルバースト終了時、直前に自分がバーストしていれば +10
 *       敵が破壊された時、その敵がチェーンバインド状態なら +1
 *   - 「特定のタイミング」= バースト3段階突入時（research/gw410878.txt の用語集）
 *       残っているチェーンをすべて使用し、1本ごとにランダムな敵へ 50.06%、
 *       その敵にチェーンバインドを1スタック付与
 *   - チェーンバインド: 25.08% の持続ダメージを1秒ごと（スタック数ぶん）：
 *     20スタック・持続・解除不可
 *   - skill2（パースから丸ごと落ちている）:
 *       FB中に通常攻撃が40回命中するごと、対象がチェーンバインド状態なら +1スタック
 *   - バースト「プリング・チェーン」: チェーンバインド状態の敵に 50.05% の
 *     持続ダメージ（1秒間隔）＋スタックを10秒間コピーし、その後チェーンバインドを解除
 *
 * 実装していないもの:
 *   - 自分が戦闘不能になった時に対象へ +20スタック（死亡を拾うフックが無い）
 *   - 「敵が戦場に出現した時」のチェーン消費（アリーナでは戦闘開始時に全員出現して
 *     しまうため、開始時に消費すると仕様が壊れる）
 */
(window.SPECIALS = window.SPECIALS || {})[230] = {
  /* チェーンの本数ぶんの 50.06% はここで実装している */
  suppress: { skill1: [2] },
  init: function (u, E) {
    u.mihara = {
      chains: 0,
      binds: [],          /* { target, stacks, nextTick, until } */
      dots: [],           /* { target, pct, next, end } */
      fbEndAt: -1,
      burstInFb: false,
      lastFbFrame: -1,
      hitAnchor: 0
    };
  },

  /* ランダムな敵。engine の乱数は API に無いので、フレームと位置から決まる
   * 決定的な擬似乱数を使う（同じ入力なら同じ結果になる）。 */
  _pick: function (u, E, frame, index) {
    var list = E.alive(E.enemies(u));
    if (!list.length) return null;
    var h = (frame * 2654435761 + index * 40503 + u.pos * 97) >>> 0;
    return list[h % list.length];
  },

  /* E.pickTarget は README では (u, frame) だが engine の実装は (u, enemies, frame)。
   * どちらでも動くようにしておく。 */
  _target: function (u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  },

  _bindOf: function (s, target) {
    for (var i = 0; i < s.binds.length; i++) {
      if (s.binds[i].target === target) return s.binds[i];
    }
    return null;
  },

  _addBind: function (u, E, frame, target, n) {
    var s = u.mihara;
    var b = this._bindOf(s, target);
    if (!b) {
      b = { target: target, stacks: 0, nextTick: frame + 60, until: Infinity };
      s.binds.push(b);
    }
    b.stacks = Math.min(20, b.stacks + n);
  },

  tick: function (u, E, frame) {
    var s = u.mihara;
    if (!s) return;

    /* ---- 戦闘開始: キャプチャーチェーン10 */
    if (frame === 0) s.chains = 10;

    /* ---- 敵が破壊された時: バインド状態だったなら +1 */
    for (var i = s.binds.length - 1; i >= 0; i--) {
      var bn = s.binds[i];
      if (!bn.target.alive) {
        s.chains = Math.min(10, s.chains + 1);
        s.binds.splice(i, 1);
      }
    }

    /* ---- バースト3段階突入 = フルバースト開始。チェーンをすべて使用する */
    var lb = u.team && u.team.lastBurst;
    if (lb && lb.stage === 'B3' && lb.frame === frame && frame !== s.lastFbFrame) {
      s.lastFbFrame = frame;
      s.fbEndAt = frame + 10 * E.FPS;
      this._consumeChains(u, E, frame);
    }

    /* ---- フルバースト終了時: 直前にバーストしていれば +10 */
    if (s.fbEndAt >= 0 && frame >= s.fbEndAt) {
      s.fbEndAt = -1;
      if (s.burstInFb) {
        s.chains = Math.min(10, s.chains + 10);
        s.burstInFb = false;
        E.event({ frame: frame, kind: 'mihara-chains', side: u.side, unit: u.name, chains: s.chains });
      }
    }

    /* ---- skill2: FB中に通常攻撃が40回命中するごと、対象のバインド +1 */
    var hits = u.counters.attackHits;
    while (hits - s.hitAnchor >= 40) {
      s.hitAnchor += 40;
      if (frame <= s.fbEndAt) {
        var primary = this._target(u, E, frame);
        if (primary && this._bindOf(s, primary)) this._addBind(u, E, frame, primary, 1);
      }
    }

    /* ---- チェーンバインドの持続ダメージ（1秒ごと・スタック数ぶん） */
    for (var b = 0; b < s.binds.length; b++) {
      var bd = s.binds[b];
      if (!bd.target.alive || bd.until < frame) continue;
      while (frame >= bd.nextTick) {
        bd.nextTick += 60;
        for (var st = 0; st < bd.stacks; st++) {
          E.damage(u, bd.target, frame, { multiplierPct: 25.08, isSustained: true });
        }
      }
    }

    /* ---- プリング・チェーンの持続ダメージ */
    for (var d = s.dots.length - 1; d >= 0; d--) {
      var dot = s.dots[d];
      if (!dot.target.alive || frame > dot.end) { s.dots.splice(d, 1); continue; }
      while (frame >= dot.next && dot.next <= dot.end) {
        dot.next += 60;
        E.damage(u, dot.target, frame, { multiplierPct: dot.pct, isSustained: true });
      }
    }

    /* ---- コピーしたスタックの期限切れ */
    for (var r = s.binds.length - 1; r >= 0; r--) {
      if (s.binds[r].until !== Infinity && frame > s.binds[r].until) s.binds.splice(r, 1);
    }
  },

  _consumeChains: function (u, E, frame) {
    var s = u.mihara;
    var n = s.chains;
    s.chains = 0;
    for (var k = 0; k < n; k++) {
      var t = this._pick(u, E, frame, k);
      if (!t) break;
      E.damage(u, t, frame, { multiplierPct: 50.06 });
      this._addBind(u, E, frame, t, 1);
    }
    if (n > 0) E.event({ frame: frame, kind: 'mihara-chain-burst', side: u.side, unit: u.name, attacks: n });
  },

  onShot: function () { /* チェーン消費は tick 側で処理 */ },

  onBurst: function (u, E, frame) {
    var s = u.mihara;
    if (!s) return;
    s.burstInFb = true;

    /* ---- プリング・チェーン: バインド状態の敵に 50.05%（1秒間隔・10秒）
     *      スタックを10秒間コピーし、効果適用後にチェーンバインドを解除する */
    for (var i = 0; i < s.binds.length; i++) {
      var bd = s.binds[i];
      if (!bd.target.alive) continue;
      /* パーサ側の burst ブロックは trigger=unknown で動かないので、初回から自前で出す */
      s.dots.push({ target: bd.target, pct: 50.05, next: frame, end: frame + 10 * E.FPS });
      bd.until = frame + 10 * E.FPS;   /* コピーは10秒で消える（解除不可） */
    }
  }
};
