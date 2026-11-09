/* ディーゼル：ウィンタースイーツ (id 35, RL, B3, 火力型)
 *
 * パーサで表現できなかった部分:
 *   - イントロ / クライマックス（skill1）
 *       初めてフルバーストが発動した時、直前に自分がバーストしていれば
 *       イントロ、していなければクライマックス。どちらもクリティカルダメージ
 *       +20.28%（持続・解除不可）で、以後フルバーストのたびに
 *       イントロ → 持続ダメージ60.19%、クライマックス → 235.03%（10秒）。
 *     パーサは両方の分岐を同時に恒久バフとして置き、FB時も両方発動してしまう。
 *   - 持続ダメージ（1秒間隔）の実処理
 *       skill2: FB発動時、ターゲットに 63.33%（9秒）
 *       burst : 敵全体に 18.43%（9秒）／対象へ 181.2%（9秒）
 *     パーサは初回の1発だけを即時ダメージとして出しているので、
 *     ここでは2秒目以降（1秒ごと）を処理する。
 *
 * 実装していないもの:
 *   - パーツ破壊まわり（消音・騒音公害・持続ダメージ68.04%）：アリーナにパーツが無い
 *   - クライマックス時の消音スタック -1（同上）
 */
(window.SPECIALS = window.SPECIALS || {})[35] = {
  /* 持続ダメージの刻みはエンジン側で行う */
  suppress: {'skill2': [3], 'burst': [0, 1]},
  init: function (u, E) {
    u.diesel = {
      form: null,          /* 'intro' | 'climax' */
      lastFb: -1,
      dots: []
    };
  },

  tick: function (u, E, frame) {
    var s = u.diesel;
    if (!s) return;
    var base = u.side + u.pos + ':';

    /* パーサが「always」で置いたイントロ／クライマックスのクリティカルダメージを外す */
    if (frame === 0) {
      var k0 = base + 'skill1:0:stat:critDmgPct';
      var k1 = base + 'skill1:1:stat:critDmgPct';
      u.buffs = u.buffs.filter(function (b) {
        return b.key.indexOf(k0) !== 0 && b.key.indexOf(k1) !== 0;
      });
    }

    /* ---- フルバースト開始（バースト3段階突入） */
    var lb = u.team && u.team.lastBurst;
    if (lb && lb.stage === 'B3' && lb.frame === frame && frame !== s.lastFb) {
      s.lastFb = frame;

      /* パーサが FB 時に置く持続ダメージバフ（両分岐ぶん）を外す */
      var k2 = base + 'skill1:2:stat:sustainedDmgPct';
      var k3 = base + 'skill1:3:stat:sustainedDmgPct';
      u.buffs = u.buffs.filter(function (b) {
        return b.key.indexOf(k2) !== 0 && b.key.indexOf(k3) !== 0;
      });

      if (!s.form) {
        /* 初回: 直前に自分がバーストしていたか（= 自分がFBを開いたか）で決まる */
        s.form = (lb.unit === u) ? 'intro' : 'climax';
        E.buff(u, 'diesel-form', 'critDmgPct', 20.28, 'up', Infinity,
          { label: s.form === 'intro' ? 'イントロ' : 'クライマックス' });
        E.event({ frame: frame, kind: 'diesel-form', side: u.side, unit: u.name, form: s.form });
      }
      E.buff(u, 'diesel-fb', 'sustainedDmgPct', s.form === 'intro' ? 60.19 : 235.03,
        'up', frame + 10 * E.FPS, { label: s.form });

      /* skill2: FB発動時、ターゲットに 63.33% の持続ダメージ（9秒） */
      var t = this._target(u, E, frame);
      if (t) this._dot(s, t, 63.33, frame);
    }

    /* ---- 持続ダメージ */
    this._tickDots(u, E, frame, s);
  },

  /* パーサが初回1発を即時ダメージで出しているので、2秒目以降を1秒ごとに */
  _dot: function (s, target, pct, frame) {
    s.dots.push({ target: target, pct: pct, next: frame + 60, end: frame + 9 * 60 });
  },

  _tickDots: function (u, E, frame, s) {
    for (var i = s.dots.length - 1; i >= 0; i--) {
      var d = s.dots[i];
      if (!d.target.alive || frame > d.end) { s.dots.splice(i, 1); continue; }
      while (frame >= d.next && d.next <= d.end) {
        d.next += 60;
        E.damage(u, d.target, frame, { multiplierPct: d.pct, isSustained: true });
      }
    }
  },

  onShot: function () { /* 通常攻撃に固有処理なし */ },

  /* E.pickTarget は README では (u, frame) だが engine の実装は (u, enemies, frame)。
   * どちらでも動くようにしておく。 */
  _target: function (u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  },


  onBurst: function (u, E, frame) {
    var s = u.diesel;
    if (!s) return;
    /* burst: 敵全体に 18.43%、対象に 181.2%（どちらも9秒・1秒間隔） */
    var enemies = E.alive(E.enemies(u));
    for (var i = 0; i < enemies.length; i++) this._dot(s, enemies[i], 18.43, frame);
    var primary = this._target(u, E, frame);
    if (primary) this._dot(s, primary, 181.2, frame);
  }
};
