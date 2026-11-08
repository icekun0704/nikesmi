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
