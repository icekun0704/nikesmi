/* ツバイ（宝物）(id 30, SG, B1, 支援型, 電撃)
 *
 * 宝物版の読み替え:
 *   - 貫通学概論 15.48% → 25.03%（宝物1）
 *   - skill2 のクリティカル確率18.63% の持続 5秒 → 10秒（宝物2）
 *   - skill1 宝物3「フルバーストタイム中に通常攻撃した時、味方全体に
 *     貫通ダメージ24.99%▲：3スタック：1発間」
 *   - skill2 宝物2「通常攻撃をした時、自分が貫通学概論状態なら、味方全体に
 *     クリティカル確率15%▲：3スタック：5秒間」
 *
 * パーサで表現できなかった部分:
 *   - 「1発間維持」の貫通ダメージバフ（パーサは duration を付けずに恒久バフにしている）。
 *     各味方が次に1回射撃したら外す。
 *   - 遮蔽物HP回復7.52%（op=coverStat で engine 側に処理が無い）
 *   - 貫通学概論 25.03% への宝物補正
 *
 * 実装していないもの:
 *   - バースト「使用武器変更（チャージ1.5秒 / 50.69% / フルチャージ300% / 装弾1発 /
 *     貫通特化）」: engine に戦闘中に武器を差し替える仕組みが無い。
 *   - フルバースト状態そのものは API に無いため、skill2 の fullBurst バフが
 *     付いたフレームを開始点として10秒間を「フルバースト中」とみなす。
 */
(window.SPECIALS = window.SPECIALS || {})[30] = {
  /* 遮蔽物の回復はここで実装している */
  suppress: { skill2: [0] },
  init: function (u, E) {
    u.tsubai = {
      pierceUntil: -1,   // 貫通学概論の終了
      fbUntil: -1,       // フルバースト中とみなす区間
      marks: {},         // pos -> その味方が撃った回数（1発間バフの管理）
      coverMark: 0
    };
  },

  tick: function (u, E, frame) {
    var t = u.tsubai;
    if (!t) return;
    var allies = E.team(u);

    var critKey = u.side + u.pos + ':undefined:1:stat:critRate';
    var oneShotKeys = [
      u.side + u.pos + ':undefined:0:stat:pierceDmgPct', // 20.13% : 1発間
      'tsubai-fb-pierce:' + u.side + u.pos              // 24.99% : 1発間（宝物3）
    ];

    for (var i = 0; i < allies.length; i++) {
      var a = allies[i];
      if (!a) continue;

      /* --- クリティカル確率18.63%: 宝物2で10秒間（パーサは恒久で置く） */
      for (var b = 0; b < a.buffs.length; b++) {
        var bf = a.buffs[b];
        if (bf.key.indexOf(critKey) === 0 && bf.until === Infinity) {
          bf.until = bf.refreshed + 10 * E.FPS;
          t.fbUntil = bf.refreshed + 10 * E.FPS;
        }
      }

      /* --- 「1発間」バフ: この味方が1回撃ったら外す */
      var hasOneShot = false;
      for (var k = 0; k < a.buffs.length; k++) {
        for (var n = 0; n < oneShotKeys.length; n++) {
          if (a.buffs[k].key.indexOf(oneShotKeys[n]) === 0) { hasOneShot = true; break; }
        }
        if (hasOneShot) break;
      }
      if (hasOneShot) {
        if (t.marks[a.pos] == null) t.marks[a.pos] = a.shots;
        else if (a.shots > t.marks[a.pos]) {
          a.buffs = a.buffs.filter(function (x) {
            for (var m = 0; m < oneShotKeys.length; m++) {
              if (x.key.indexOf(oneShotKeys[m]) === 0) return false;
            }
            return true;
          });
          t.marks[a.pos] = null;
        }
      } else {
        t.marks[a.pos] = null;
      }
    }
  },

  onShot: function (u, E, frame, shot) {
    var t = u.tsubai;
    if (!t) return;
    var allies = E.alive(E.team(u));

    /* 遮蔽物HP回復7.52%（通常攻撃5回ごと） */
    if (u.counters.attackShots > 0 && u.counters.attackShots % 5 === 0) {
      for (var i = 0; i < allies.length; i++) {
        var a = allies[i];
        a.coverHp = Math.min(a.coverMax, a.coverHp + a.coverMax * 0.0752);
      }
    }

    /* 宝物2: 貫通学概論状態なら、通常攻撃のたびに味方全体へ
     * クリティカル確率15%▲：3スタック：5秒間 */
    if (frame <= t.pierceUntil) {
      for (var k = 0; k < allies.length; k++) {
        var m = allies[k];
        var b = E.buff(m, 'tsubai-crit:' + u.side + u.pos + ':' + m.pos, 'critRate',
          15, 'up', frame + 5 * E.FPS, { maxStacks: 3 });
        if (b && (b.stacks || 1) < 3) b.stacks = 3;
      }
    }

    /* 宝物3: フルバーストタイム中の通常攻撃 → 味方全体へ
     * 貫通ダメージ24.99%▲：3スタック：1発間 */
    if (frame <= t.fbUntil) {
      for (var q = 0; q < allies.length; q++) {
        var al = allies[q];
        var pb = E.buff(al, 'tsubai-fb-pierce:' + u.side + u.pos + ':' + al.pos,
          'pierceDmgPct', 24.99, 'up', Infinity, { maxStacks: 3 });
        if (pb && (pb.stacks || 1) < 3) pb.stacks = 3;
      }
    }
  },

  onBurst: function (u, E, frame) {
    var t = u.tsubai;
    if (!t) return;
    /* 貫通学概論（宝物1で25.03%）。パーサが15.48%を張るので差分だけ足す。 */
    t.pierceUntil = frame + 10 * E.FPS;
    var allies = E.alive(E.team(u));
    for (var i = 0; i < allies.length; i++) {
      E.buff(allies[i], 'tsubai-pierce-treasure:' + u.side + u.pos + ':' + allies[i].pos,
        'pierceDmgPct', 25.03 - 15.48, 'up', frame + 10 * E.FPS, {});
    }
  }
};
