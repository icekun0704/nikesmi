/* 画像の置き場所.
 *
 * 既定ではこのフォルダの assets/portraits/ を見ます。
 * 画像を別の場所（CDN・R2 など）に置く場合は、次のどちらかで切り替えられます。
 *
 *   1. URL に一度だけ付ける:  .../nikesmi/?img=https://example.com/portraits/
 *      （次回からも同じ場所を使います。ブラウザに記憶されます）
 *   2. このファイルの既定値を書き換える
 *
 * 画像が無い場合でも、キャラ名の頭文字を表示して動作します。
 */
(function () {
  var KEY = 'nikesmi.portraitBase';
  var fromQuery = null;
  try {
    fromQuery = new URLSearchParams(location.search).get('img');
    if (fromQuery) localStorage.setItem(KEY, fromQuery);
  } catch (e) { /* ignore */ }

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* ignore */ }

  window.PORTRAIT_BASE = window.PORTRAIT_BASE || fromQuery || saved || 'assets/portraits/';
})();

/* 遮蔽物のHP（ニケの基礎HPに対する比率）.
 *
 * 遮蔽物は「射撃していないあいだ身を隠す板」で、実質もう一本のHPバーです。
 * 単体攻撃はまずここが受け、バーストの範囲攻撃は貫通します。
 * レベル400での実数値は公開されていないため比率で持ちます。
 * 実戦では遮蔽物はそこまで硬くなく、バーストの範囲攻撃は完全に貫通します。
 * 初期値は決着時間が実戦のテンポになるように置いた暫定値です。
 */
window.COVER_HP_RATIO = window.COVER_HP_RATIO == null ? 0.35 : window.COVER_HP_RATIO;

/* BlablaLink 同期の中継サーバー.
 *
 * 例: window.SYNC_PROXY = 'https://nikke-sync.example.workers.dev';
 * 同梱の tools/cloudflare-worker.js を Cloudflare Workers に置くと、そのURLになる。
 */
window.SYNC_PROXY = window.SYNC_PROXY || '';

/* 戦闘のテンポ.
 *
 * ダメージ式そのものは資料どおりだが、そのままだと最初のフルバーストで
 * 決着がついてしまい、実戦（20〜30秒・バースト3〜4回）より短くなる。
 * 実戦のテンポに合わせるための係数。1.0 で資料どおりの式。
 */
window.DAMAGE_SCALE = window.DAMAGE_SCALE == null ? 0.35 : window.DAMAGE_SCALE;
