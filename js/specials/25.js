/* ラプラス（宝物）(id 25 / org 102, RL, B3, 火力型, 鉄甲)
 *
 * 原文の状態機械:
 *   ヒーロービジョン（自分）
 *     フルチャージ攻撃時: 爆発範囲3.57%▲：5スタック：15秒間維持（宝物3で5秒→15秒）
 *   バースト: 使用武器変更（10秒間）
 *     初回ダメージ：最終攻撃力の1455.72%（宝物2）
 *     通常ダメージ：最終攻撃力の22.2%（宝物2）：10秒間維持
 *     追加効果1：貫通特化
 *     追加効果2：ヒーロービジョンがフルスタックなら通常ダメージを防御力無視に
 *     ヒーロービジョンがフルスタックなら、同じ敵に最終攻撃力の11.9%の防御力無視ダメージ
 *   skill2: フルチャージ攻撃が命中した時、対象に 132.45% の追加ダメージ（宝物1）
 *
 * パーサの扱い:
 *   - ヒーロービジョンは trigger=unknown で未発動。
 *   - skill2 のフルチャージ追加ダメージも trigger=unknown で未発動。
 *   - 武器変更は op=weaponChange で engine が処理しない。
 *
 * 本ファイルでは、武器変更中だけ u.char.stats.weaponDamage を
 * 「22.2 ÷ チャージ倍率」に差し替え（engine が RL の通常攻撃にチャージ倍率を
 * 掛けるため）、初回ショットに差分（1455.72 - 22.2）を上乗せする。
 * フルスタック時の「通常ダメージを防御力無視に」は、通常攻撃の防御力減算を
 * 差し替える口が engine に無いため実装しない（11.9%の追加ぶんだけ実装）。
 */
(function () {
  'use strict';

  var HV_MAX = 5;
  var HV_PCT = 3.57;
  var HV_FRAMES = 15 * 60;
  var BURST_FRAMES = 10 * 60;
  var FIRST_DAMAGE = 1455.72;
  var NORMAL_DAMAGE = 22.2;
  var FULL_STACK_EXTRA = 11.9;
  var FULL_CHARGE_EXTRA = 132.45;

  function pick(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  function st(u) {
    if (!u.lapT) {
      u.lapT = {
        hv: 0,
        until: -1,
        first: false,
        origChar: null,
        changedChar: null
      };
    }
    return u.lapT;
  }

  function hvBuff(u) {
    for (var i = 0; i < u.buffs.length; i++) {
      if (u.buffs[i].key === 'laplace-hv') return u.buffs[i];
    }
    return null;
  }

  function restoreWeapon(u, s, E, frame) {
    s.until = -1;
    if (s.origChar) {
      u.char = s.origChar;
      s.origChar = null;
      s.changedChar = null;
      E.event({ frame: frame, kind: 'laplace-weapon-end', side: u.side, unit: u.name });
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[25] = {
    init: function (u, E) {
      st(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);
      if (s.until >= 0 && frame > s.until) restoreWeapon(u, s, E, frame);
    },

    onShot: function (u, E, frame, shot) {
      var s = st(u);
      if (!s) return;
      var t = pick(u, E, frame);

      /* ヒーロービジョン：フルチャージ攻撃時 爆発範囲3.57%▲：5スタック：15秒 */
      E.buff(u, 'laplace-hv', 'explosionRangePct', HV_PCT, 'up',
        frame + HV_FRAMES, { maxStacks: HV_MAX });
      var b = hvBuff(u);
      if (b) s.hv = b.stacks || 1;

      /* skill2: フルチャージ攻撃が命中した時、対象に 132.45% の追加ダメージ */
      if (t && t.alive) {
        E.damage(u, t, frame, { multiplierPct: FULL_CHARGE_EXTRA });
      }

      /* 使用武器変更中 */
      if (s.until >= frame && t && t.alive) {
        if (s.first) {
          s.first = false;
          E.damage(u, t, frame, { multiplierPct: FIRST_DAMAGE - NORMAL_DAMAGE });
        }
        /* ヒーロービジョンがフルスタックなら、同じ敵に 11.9% の防御力無視ダメージ */
        if (s.hv >= HV_MAX) {
          E.damage(u, t, frame, { multiplierPct: FULL_STACK_EXTRA, ignoreDef: true });
        }
      }
    },

    onBurst: function (u, E, frame) {
      var s = st(u);
      if (s.until >= 0) return;   /* すでに変更中なら何もしない */

      /* 使用武器変更：通常ダメージ 22.2%（10秒間） */
      s.until = frame + BURST_FRAMES;
      s.first = true;
      s.origChar = u.char;
      var stats = Object.assign({}, u.char.stats || {});
      /* 原文の「通常ダメージ22.2%」は1発ぶんの最終倍率。engine は RL の通常攻撃に
       * チャージ倍率（maxCharge/100）を掛けるので、基礎値に割り戻して入れる。 */
      var chargeMult = (Number(u.char.stats && u.char.stats.maxCharge) || 250) / 100;
      stats.weaponDamage = NORMAL_DAMAGE / chargeMult;
      s.changedChar = Object.assign({}, u.char, { stats: stats });
      u.char = s.changedChar;
      E.event({ frame: frame, kind: 'laplace-weapon', side: u.side, unit: u.name });
    }
  };
})();
