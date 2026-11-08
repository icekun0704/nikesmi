/* ポリ (id 63, SG, B2)
 *
 * パーサで表現できなかった部分:
 *   - バースト「自分に スキル発動者の最終最大HPの22.27%の味方共用バリア：
 *     10秒間維持」が op:'unparsed' になっている。
 *     engine は barrier を「ユニットの shield（ダメージを吸収する別HP）」として
 *     持っているので、そこへ加算し、10秒で残量を落とす。
 *
 * 実装していないもの:
 *   - 「味方共用」の部分（自分だけでなく味方へのダメージも防ぐ）。
 *     engine には共有バリアの受け皿が無いため、単一プールとして自分に持たせる。
 *   - 宝物版（id 64）側で追加されるポリスバッジ／不屈は 64.js で実装。
 */
(function () {
  'use strict';

  function st(u) {
    if (!u.poli) u.poli = { barrierAdded: 0, barrierPrev: 0, barrierUntil: -1 };
    return u.poli;
  }

  (window.SPECIALS = window.SPECIALS || {})[63] = {
    init: function (u, E) {
      st(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);
      if (s.barrierUntil >= 0 && frame > s.barrierUntil) {
        // 残っている分だけバリアを落とす（既存のシールドは巻き込まない）
        var leftover = Math.max(0, Math.min(s.barrierAdded, u.shield - s.barrierPrev));
        u.shield = Math.max(0, u.shield - leftover);
        s.barrierAdded = 0;
        s.barrierPrev = 0;
        s.barrierUntil = -1;
        E.event({ frame: frame, kind: 'poli-barrier-end', side: u.side, unit: u.name });
      }
    },

    onBurst: function (u, E, frame) {
      var s = st(u);

      // スキル発動者の最終最大HPの22.27%の味方共用バリア：10秒間維持
      var amt = Math.round(u.hpMax * 0.2227);
      s.barrierPrev = u.shield;
      s.barrierAdded = Math.max(0, amt - u.shield);
      u.shield = Math.max(u.shield, amt);
      s.barrierUntil = frame + 10 * E.FPS;
      E.event({ frame: frame, kind: 'poli-barrier', side: u.side, unit: u.name });
    }
  };
})();
