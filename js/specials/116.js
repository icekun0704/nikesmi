/* ミルク：ブルーミングバニー (id 116 / org 167)
 *
 * 実装する状態機械: 羞恥心 / 何見てんだよお前ら!!（羞恥心免疫）
 *
 * 原文 skill1:
 *   フルチャージを0.5秒以上維持した時、自分が羞恥心状態でなければ
 *   ・羞恥心：機能：リロード速度低下状態での強制リロードと引き換えに、攻撃能力増加と分配ダメージ付与
 *   ・効果1：敵全体に最終攻撃力の290%の分配ダメージ
 *   ・効果2：自分に残弾数100%減少
 *   ・効果3：自分にリロード速度50%低下で固定：リロード1回に適用
 *   ・効果4：自分に強制リロード
 *   ・効果5：自分に攻撃力118.7%▲：40秒間持続
 * 原文 skill2:
 *   羞恥心状態の時のみ、自分に ・貫通ダメージ64.7%▲：持続
 *   自分が何見てんだよお前ら!!状態の時のみ、2秒ごとに敵全体に
 *   ・最終攻撃力の447.7%の分配ダメージ
 * 原文 burst:
 *   自分に ・何見てんだよお前ら!!：羞恥心免疫：10秒間維持
 *
 * パーサ側の扱い:
 *   - 効果1・効果5 は skill1 の block が trigger=always として解釈され、
 *     戦闘開始時に敵味方の区別なく味方側へ適用されてしまっている
 *     （効果5 の攻撃力118.7% は常時かかっている）。二重計上を避けるため、
 *     ここでは効果5 を再度付与しない。
 *   - 効果1 の分配ダメージは本来のトリガーで発生させる（下記）。
 *   - 効果2〜4（残弾・強制リロード・リロード速度）は未解釈。
 */
(function () {
  'use strict';

  var HOLD_FRAMES = Math.round(0.5 * 60);   /* 「フルチャージを0.5秒以上維持」 */
  var DOT_FRAMES = 2 * 60;                  /* 「2秒ごと」 */
  var IMMUNE_FRAMES = 10 * 60;              /* 「羞恥心免疫：10秒間維持」 */

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  /* パーサは skill1 の「羞恥心」ブロックを trigger=always として解釈し、
   * 戦闘開始時に味方側へ 290% の分配ダメージと攻撃力118.7% を付与してしまっている。
   * 本来のトリガーで正しく撃ち直すため、ユニット専用にスキル定義を複製して
   * そのブロックの効果だけを取り除く（SKILL_DB は全ユニット共有なので直接は触らない）。 */
  function neutraliseParserBlock(u) {
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (!src || !u.skillState) return;
    u.skills = JSON.parse(JSON.stringify(src));
    for (var s = 0; s < u.skillState.length; s++) {
      var st = u.skillState[s];
      var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
      if (!arr) continue;
      for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
    }
    var blocks = (u.skills.skill1 && u.skills.skill1.blocks) || [];
    for (var i = 0; i < blocks.length; i++) {
      blocks[i].effects = (blocks[i].effects || []).filter(function (e) {
        if (e.op === 'damage' && e.type === 'distributed' && Math.abs(e.value - 290) < 1e-6) return false;
        if (e.op === 'stat' && e.stat === 'atkPct' && Math.abs(e.value - 118.7) < 1e-6) return false;
        return true;
      });
    }
  }

  function enterShame(u, E, frame) {
    var m = u.milk;
    m.shy = true;
    m.forcedAt = frame;
    m.reloadCostPaid = false;

    /* 効果1: 敵全体に最終攻撃力の290%の分配ダメージ */
    var enemies = E.alive(E.enemies(u));
    var dmg = 290 * scaleOf(u, 'skill1');
    for (var i = 0; i < enemies.length; i++) {
      E.damage(u, enemies[i], frame, { multiplierPct: dmg, isDistributed: true });
    }

    /* 効果2: 残弾数100%減少 → 効果4: 強制リロード（弾倉を空にする） */
    if (u.firing && isFinite(u.firing.magazine) && u.firing.magazine > 0) {
      u.firing.shotsInMagazine = u.firing.magazine;
    }

    /* 効果5: 自分に攻撃力118.7%▲：40秒間持続 */
    E.buff(u, 'milk-shy-atk', 'atkPct', 118.7 * scaleOf(u, 'skill1'), 'up',
      frame + 40 * E.FPS, { label: '羞恥心' });
  }

  (window.SPECIALS = window.SPECIALS || {})[116] = {
    init: function (u, E) {
      neutraliseParserBlock(u);
      u.milk = {
        shy: false,
        immunityUntil: -1,
        triggerFrame: -1,
        nextDot: -1,
        forcedAt: -1,
        reloadCostPaid: true
      };
    },

    tick: function (u, E, frame) {
      var m = u.milk;
      if (!m) return;

      /* 0.5秒ホールドし終えたフレームで羞恥心に入る */
      if (m.triggerFrame >= 0 && frame >= m.triggerFrame &&
          !m.shy && frame > m.immunityUntil) {
        enterShame(u, E, frame);
        m.triggerFrame = -1;
      }

      /* 羞恥心状態の時のみ: 貫通ダメージ64.7%▲（状態中だけ有効） */
      if (m.shy) {
        E.buff(u, 'milk-shy-pierce', 'pierceDmgPct', 64.7 * scaleOf(u, 'skill2'),
          'up', Infinity, { aura: true, label: '羞恥心' });
      }

      /* 何見てんだよお前ら!!状態の時のみ: 2秒ごとに敵全体へ447.7%分配ダメージ */
      if (m.nextDot >= 0 && frame >= m.nextDot && frame <= m.immunityUntil) {
        var enemies = E.alive(E.enemies(u));
        var dmg = 447.7 * scaleOf(u, 'skill2');
        for (var i = 0; i < enemies.length; i++) {
          E.damage(u, enemies[i], frame, { multiplierPct: dmg, isDistributed: true });
        }
        m.nextDot = frame + DOT_FRAMES;
      } else if (frame > m.immunityUntil) {
        m.nextDot = -1;
      }
    },

    onShot: function (u, E, frame, shot) {
      var m = u.milk;
      if (!m) return;

      /* 効果3/4: 羞恥心に入った直後の1回のリロードだけ速度50%低下 */
      if (m.forcedAt === frame && !m.reloadCostPaid) {
        var rf = u.firing.reloadFrames;
        if (!(rf > 0)) rf = Math.round((u.char.stats.reloadSeconds || 0) * E.FPS);
        u.firing.nextFrame += Math.round(rf * 1.5);
        m.reloadCostPaid = true;
      }

      if (m.shy) return;
      if (frame <= m.immunityUntil) return;
      if (m.triggerFrame >= 0) return;

      /* フルチャージを0.5秒以上維持してから撃つ */
      u.firing.nextFrame += HOLD_FRAMES;
      m.triggerFrame = u.firing.nextFrame;
    },

    onBurst: function (u, E, frame) {
      var m = u.milk;
      if (!m) return;
      /* 何見てんだよお前ら!!：羞恥心免疫10秒（羞恥心は解除される） */
      m.shy = false;
      m.triggerFrame = -1;
      m.immunityUntil = frame + IMMUNE_FRAMES;
      m.nextDot = frame + DOT_FRAMES;
    }
  };
})();
