/* 画像の置き場所.
 *
 * 既定では Cloudflare の配信先から読みます（リポジトリには画像を置きません）。
 * 別の場所に切り替えたいときは、次のどちらか。
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

  window.PORTRAIT_BASE = window.PORTRAIT_BASE || fromQuery || saved || 'https://nikkeimage.icekun.workers.dev/';
})();

/* 遮蔽物のHP（ニケの基礎HPに対する比率）.
 *
 * 遮蔽物は「射撃していないあいだ身を隠す板」で、実質もう一本のHPバーです。
 * 単体攻撃はまずここが受け、バーストの範囲攻撃は貫通します。
 * 遮蔽物のHPはゲーム内で数値を見ることができず、実測もできません。
 * そのため比率を持ち、決着時間が実戦のテンポになるように置いた暫定値です。
 * 実戦では遮蔽物はそこまで硬くなく、バーストの範囲攻撃は完全に貫通します。
 */
window.COVER_HP_RATIO = window.COVER_HP_RATIO == null ? 0.35 : window.COVER_HP_RATIO;

/* BlablaLink 同期の中継サーバー.
 *
 * 一度 ?proxy=https://... を付けて開けば、以後このブラウザでは覚えておきます。
 * 中継サーバーの作り方は worker/README.md を見てください。
 */
(function () {
  var KEY = 'nikesmi.syncProxy';
  var fromQuery = null;
  try {
    fromQuery = new URLSearchParams(location.search).get('proxy');
    if (fromQuery) localStorage.setItem(KEY, fromQuery);
  } catch (e) { /* ignore */ }

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* ignore */ }

  window.SYNC_PROXY =
    window.SYNC_PROXY || fromQuery || saved || 'https://nikesmi-sync.icekun-33d.workers.dev';

  window.setSyncProxy = function (url) {
    var clean = String(url || '').trim().replace(/\/+$/, '');
    window.SYNC_PROXY = clean;
    try {
      if (clean) localStorage.setItem(KEY, clean);
      else localStorage.removeItem(KEY);
    } catch (e) { /* ignore */ }
    return clean;
  };
})();

/* 戦闘のテンポ.
 *
 * ダメージ式そのものは資料どおりだが、そのままだと最初のフルバーストで
 * 決着がついてしまい、実戦（20〜30秒・バースト3〜4回）より短くなる。
 * 実戦は5秒前後で決着するので、既定は 1.0（資料どおりの式）。
 */
window.DAMAGE_SCALE = window.DAMAGE_SCALE == null ? 1.0 : window.DAMAGE_SCALE;
