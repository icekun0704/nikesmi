/* E.H. (id 165 / org 184)
 *
 * 原文のうち、パーサで表現できていない部分。
 *
 *  スキル1: 廃品を10個回収した時、自家製弾倉が4本未満なら
 *           廃品リセット＋弾倉1本増加（最大4本）＋攻撃力7.5%×弾倉数
 *  スキル2: 廃品の入手源
 *           ・戦闘開始時 10個（最大10）
 *           ・敵が倒れた時 2個
 *           ・廃品を回収した時 有利コードの攻撃ダメージ16.36%（15秒）
 *           （破壊可能な発射体・パーツはアリーナに存在しないので扱わない）
 *  バースト: 使用武器変更
 *           ・チャージ時間0.4秒固定／ダメージ61%／フルチャージ250%
 *           ・最大装弾数 1発 × 自家製弾倉の数／10秒
 *           ・攻撃力430.05%（10秒）
 */
(function () {
  var CYCLE = 10;      // 弾倉1本に必要な廃品
  var MAX_MAG = 4;

  (window.SPECIALS = window.SPECIALS || {})[165] = {
  /* バーストの攻撃力バフはここで実装している */
  suppress: { burst: [1] },
    init: function (u, E) {
      u.eh = {
        scrap: 10,        // 戦闘開始時に10個
        mags: 0,
        lastAlive: null,
        windowUntil: -1,
        baseMagazine: u.firing.magazine
      };
      applyMagazines(u, E, 0);
      collect(u, E, 0);   // 開始時の10個は回収済みとして扱う
    },

    tick: function (u, E, frame) {
      var st = u.eh;
      var aliveEnemies = E.alive(E.enemies(u)).length;

      // 敵が倒れた時 廃品2個
      if (st.lastAlive !== null && aliveEnemies < st.lastAlive) {
        var gained = (st.lastAlive - aliveEnemies) * 2;
        st.scrap = Math.min(10, st.scrap + gained);
        collect(u, E, frame);
      }
      st.lastAlive = aliveEnemies;

      // バースト後の武器変更が切れたら元に戻す
      if (st.windowUntil > 0 && frame > st.windowUntil) {
        st.windowUntil = -1;
        u.chargeFixed = 0;
        u.firing.magazine = st.baseMagazine;
        u.firing.shotsInMagazine = 0;
      }
    },

    onBurst: function (u, E, frame) {
      var st = u.eh;
      // 攻撃力430.05%：10秒
      E.buff(u, 'eh-atk', 'atkPct', 430.05, 'up', frame + 10 * E.FPS);
      // 武器変更：チャージ0.4秒固定・装弾数＝弾倉の数・10秒
      st.windowUntil = frame + 10 * E.FPS;
      u.chargeFixed = Math.round(0.4 * E.FPS);
      u.firing.magazine = Math.max(1, st.mags);
      u.firing.shotsInMagazine = 0;
      E.event({ frame: frame, kind: 'eh-burst', side: u.side, unit: u.name });
    }
  };

  /* 廃品を回収したときの効果（有利コードの攻撃ダメージ16.36%：15秒） */
  function collect(u, E, frame) {
    E.buff(u, 'eh-elem', 'elementDmgPct', 16.36, 'up', frame + 15 * E.FPS);
  }

  /* 弾倉を製造できるだけ作る（10個ごとに1本、最大4本） */
  function applyMagazines(u, E, frame) {
    var st = u.eh;
    var made = false;
    while (st.scrap >= CYCLE && st.mags < MAX_MAG) {
      st.scrap -= CYCLE;
      st.mags += 1;
      made = true;
    }
    if (made) {
      // 攻撃力7.5%×弾倉数（持続）。作り直すたびに上書きする。
      E.buff(u, 'eh-mag', 'atkPct', 7.5 * st.mags, 'up', Infinity);
    }
  }
})();
