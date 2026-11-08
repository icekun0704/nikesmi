# 同期サーバー

BlablaLink とニケシミュをつなぐ中継です。Cloudflare Workers で動きます。

## なぜ要るのか

BlablaLink のキャラクター情報は、BlablaLink にログインしていないと取得できません。
ブラウザから直接問い合わせることもできません（別サイトからの取得が禁止されている）。
そこで、ログイン状態を持った中継を1つ置きます。

中継は「誰の情報か」を指定して取りに行くだけなので、**公開設定になっている人の編成なら誰でも取り込めます**。
あなたのアカウント情報が他人に渡ることはありません。

## 用意するもの

- Cloudflare のアカウント（無料で足ります）
- Node.js

## 手順

### 1. ログイン

```bash
cd worker
npx wrangler login
```

ブラウザが開くので、Cloudflare にログインして許可します。

### 2. Cookie を入れる

PC のブラウザで <https://www.blablalink.com> を開き、ログインします。次に F12 を押して
**Application → Cookies → https://www.blablalink.com** を開き、`名前=値` を `;` でつないで1行にします。

その1行を、次のコマンドに貼り付けます（画面には表示されません）。

```bash
npx wrangler secret put BLABLINK_COOKIE
```

### 3. 公開する

```bash
npx wrangler deploy
```

`https://nikesmi-sync.<あなたのID>.workers.dev` が発行されます。

### 4. サイトに教える

ニケシミュを開き、`アカウント同期` → `同期サーバー` に上の URL を貼って「保存」。
次回からは URL を貼るだけで同期できます。

`?proxy=https://…` を付けて開いても同じです。

## 動作確認

```bash
curl https://nikesmi-sync.<あなたのID>.workers.dev/
```

```json
{"ok":true,"service":"nikesmi-sync","version":3,"has_cookie":true,"cached":false}
```

`has_cookie` が `false` なら手順2が済んでいません。

## 任意: キャッシュ

同じ人の情報を何度も取りに行かないようにする場合だけ。

```bash
npx wrangler kv namespace create SESSIONS
```

表示された `id` を `wrangler.toml` の `[[kv_namespaces]]` に書き、コメントを外してから `npx wrangler deploy`。

## 注意

- Cookie は Cloudflare の Secret にだけ入ります。リポジトリにもブラウザにも残りません。
- Cookie の有効期限が切れると `has_cookie: false` 相当のエラーになります。手順2をやり直してください。
- `ALLOWED_ORIGINS` を自分のサイトだけに絞っておくと、他人のページから勝手に使われるのを防げます。
