/* ドロシー：セレンディピティ (id 70 / org 161, SG, B3, 火力型, 水冷)
 *
 * 原文の状態機械:
 *   skill1（ペレットが80回命中した時）
 *     自分に 貫通特化：3発間維持
 *            命中率98.18%▲：3発間維持
 *            攻撃ダメージ72%▲：3発間維持
 *            ペレットの数を1個に固定：3発間維持
 *   skill2（ペレットが160回命中した時）
 *     自分に 貫通範囲200%拡大：3発間維持
 *     戦闘開始時、自分に 貫通ダメージ55.08%▲：持続        ← パーサ済み
 *     フルバーストタイム発動中のみ、自分に
 *       攻撃力75.24%▲：持続／命中率40.68%▲：持続
 *   burst
 *     自分に 攻撃速度65%▲：15秒／攻撃力88.12%▲：15秒／ペレット数5個▲：15秒
 *       （攻撃力はパーサ済み）
 *
 * パーサの扱い:
 *   - skill1/skill2 の counter on:'pelletHits' は engine が
 *     counters.pelletHits を増やさないため一度も発動しない（未実装と同じ）。
 *     ここでペレット数を自前で数える（SGは1射10ペレット）。
 *   - skill2 の「フルバースト中のみ」は trigger:unknown。
 *   - burst の pelletFlat は engine が参照しないため、発動中の通常攻撃に
 *     ペレット5個ぶんの追加ダメージを足して表現する。
 *
 * 実装しないもの:
 *   - 貫通特化／貫通範囲拡大：engine の通常攻撃に貫通判定が無い。
 *   - ペレット数を1個に固定：engine のSGは常に10ペレットで、発射数を
 *     差し替える口が無い（命中数・ダメージの両方を再現できない）。
 *   - 命中率・攻撃速度：engine のダメージ計算／射撃間隔で使われない。
 */
(function () {
  'use strict';

  var FPS = 60;
  var FB_FRAMES = 10 * FPS;
  var SG_PELLETS = 10;            /* engine のSGは常に10ペレット */

  var S1_PELLETS = 80;            /* ペレットが80回命中した時 */
  var S1_HIT = 98.18;             /* 命中率98.18%▲：3発間 */
  var S1_ATKDMG = 72;             /* 攻撃ダメージ72%▲：3発間 */
  var S1_SHOTS = 3;               /* 3発間維持 */

  var S2_PELLETS = 160;           /* ペレットが160回命中した時 */
  var S2_PIERCE_RANGE = 200;      /* 貫通範囲200%拡大：3発間 */
  var S2_SHOTS = 3;

  var FB_ATK = 75.24;             /* 攻撃力75.24%▲：持続（FB中のみ） */
  var FB_HIT = 40.68;             /* 命中率40.68%▲：持続（FB中のみ） */

  var BURST_PELLETS = 5;          /* ペレット数5個▲：15秒 */
  var BURST_SEC = 15;

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  function inFullBurst(u, frame) {
    var lb = u.team && u.team.lastBurst;
    return !!(lb && lb.stage === 'B3' && frame >= lb.frame && frame <= lb.frame + FB_FRAMES);
  }

  /* key のバフを取り除く */
  function dropBuff(u, key) {
    u.buffs = u.buffs.filter(function (b) { return b.key !== key; });
  }

  (window.SPECIALS = window.SPECIALS || {})[70] = {
    init: function (u, E) {
      u.dorothyS = {
        pellets: 0,
        shots: 0,
        s1UntilShot: -1,
        s2UntilShot: -1,
        pelletUntil: -1
      };
    },

    tick: function (u, E, frame) {
      var s = u.dorothyS;
      if (!s) return;

      /* フルバーストタイム発動中のみ：攻撃力75.24%▲／命中率40.68%▲ */
      if (inFullBurst(u, frame)) {
        E.buff(u, 'dorothy-fb-atk', 'atkPct',
          FB_ATK * scaleOf(u, 'skill2'), 'up', Infinity, { aura: true });
        E.buff(u, 'dorothy-fb-hit', 'hitRate',
          FB_HIT * scaleOf(u, 'skill2'), 'up', Infinity, { aura: true });
      }

      /* 3発間のバフの期限（撃った回数で管理） */
      if (s.s1UntilShot >= 0 && s.shots >= s.s1UntilShot) {
        s.s1UntilShot = -1;
        dropBuff(u, 'dorothy-s1-atkdmg');
        dropBuff(u, 'dorothy-s1-hit');
      }
      if (s.s2UntilShot >= 0 && s.shots >= s.s2UntilShot) {
        s.s2UntilShot = -1;
        dropBuff(u, 'dorothy-s2-pierce-range');
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = u.dorothyS;
      if (!s) return;
      var hits = (shot && shot.hits) || 1;
      /* SGは 1射 = 10ペレット命中。engine の hits は射数なので掛ける。 */
      var pellets = SG_PELLETS * hits;
      var before = s.pellets;
      s.shots += hits;
      s.pellets += pellets;

      /* 「N回命中した時」は累計がNの倍数を跨ぐたびに発動する
       * （80回ごと／160回ごと。片方が他方を消費しない）。 */
      if (Math.floor(s.pellets / S1_PELLETS) > Math.floor(before / S1_PELLETS)) {
        E.buff(u, 'dorothy-s1-hit', 'hitRate', S1_HIT * scaleOf(u, 'skill1'),
          'up', Infinity, {});
        E.buff(u, 'dorothy-s1-atkdmg', 'atkDmgPct', S1_ATKDMG * scaleOf(u, 'skill1'),
          'up', Infinity, {});
        s.s1UntilShot = s.shots + S1_SHOTS;
        E.event({ frame: frame, kind: 'dorothy-s1', side: u.side, unit: u.name });
      }

      if (Math.floor(s.pellets / S2_PELLETS) > Math.floor(before / S2_PELLETS)) {
        E.buff(u, 'dorothy-s2-pierce-range', 'pierceRangePct',
          S2_PIERCE_RANGE * scaleOf(u, 'skill2'), 'up', Infinity, {});
        s.s2UntilShot = s.shots + S2_SHOTS;
        E.event({ frame: frame, kind: 'dorothy-s2', side: u.side, unit: u.name });
      }

      /* burst のペレット数+5：通常攻撃の追加ペレットぶんのダメージ */
      if (frame <= s.pelletUntil) {
        var t = E.pickTarget(u, E.enemies(u), frame);
        if (t) {
          var weaponMult = (u.char.stats && u.char.stats.weaponDamage) || 10;
          for (var i = 0; i < BURST_PELLETS; i++) {
            E.damage(u, t, frame, { multiplierPct: weaponMult / 10 });
          }
        }
      }
    },

    onBurst: function (u, E, frame) {
      var s = u.dorothyS;
      if (!s) return;
      /* ペレット数5個▲：15秒（pelletFlat は engine が使わない） */
      s.pelletUntil = frame + BURST_SEC * FPS;
    }
  };
})();
