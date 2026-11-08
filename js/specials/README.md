# js/specials — 固有スキルの実装

キャラ固有の状態機械（スタック、モード切替、ロックオン、変形など）を1キャラ1ファイルで書く。
`tools/build_specials.py` が全部連結して `js/specials.js` を作る。

## ファイル名

`<id>.js`（`js/data.js` の `id`）。宝物版だけ挙動が違う場合は `<id>star.js`。
同じ id を2ファイルで登録するとビルドが失敗するので、担当が被らない。

## 書式

```js
(window.SPECIALS = window.SPECIALS || {})[123] = {
  // 戦闘開始時に1回
  init: function (u, E) { u.mystate = 0; },

  // 毎フレーム（生存中のみ）
  tick: function (u, E, frame) { },

  // 通常攻撃を1回撃った直後
  onShot: function (u, E, frame, shot) { },

  // バーストを撃った直後
  onBurst: function (u, E, frame) { }
};
```

## E（API）でできること

| 名前 | 内容 |
|---|---|
| `E.FPS` | 60 |
| `E.team(u)` / `E.enemies(u)` | 自チーム／敵チームの配列 |
| `E.alive(list)` | 生存だけ |
| `E.pickTarget(u, frame)` | そのユニットが今狙う相手 |
| `E.slotsInRange(enemies, pos, r)` | 爆風が届く範囲 |
| `E.damage(u, target, frame, {multiplierPct, ignoreDef, isBurst, rng不要})` | ダメージ |
| `E.buff(u, key, stat, value, dir, until, opts)` | バフ。`until` はフレーム。`Infinity` で永続 |
| `E.heal(u, amount, frame)` | 回復 |
| `E.sumStat(u, stat)` | 現在の合計バフ値 |
| `E.atkEff(u)` | 最終攻撃力 |
| `E.gauge(side, v)` | バーストゲージ加算 |
| `E.event(obj)` | タイムラインにイベントを追加 |

`stat` に使える名前は `js/engine.js` の `sumStat` 呼び出しを見てください
（atkPct / defPct / maxHpPct / atkDmgPct / burstDmgPct / critRate / critDmgPct /
takenDmgPct / chargeDmgPct / chargeSpeedPct / reloadSpeedPct / magazinePct /
elementDmgPct / pierceDmgPct / ignoreDefDmgPct など）。

## すでに engine.js が面倒を見ていること

パーサが解釈できた効果（数値バフ、回復、シールド、挑発、無敵、気絶、ダメージ）は
`js/skills.js` 経由で自動的に動きます。**ここに書くのは、パーサで表現できない
状態機械だけ**にしてください。二重計上に注意。
