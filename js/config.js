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
 * 初期値1.0は「遮蔽物のHPはニケの最大HPとほぼ同じ」というコミュニティの実測にもとづきます。
 */
window.COVER_HP_RATIO = window.COVER_HP_RATIO == null ? 1.0 : window.COVER_HP_RATIO;
