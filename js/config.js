/* 画像の置き場所.
 *
 * 既定ではこのフォルダの assets/portraits/ を見ます。
 * 画像を別の場所（CDN・R2 など）に置く場合は、下の URL を書き換えてください。
 * 例: window.PORTRAIT_BASE = 'https://pub-xxxxxxxx.r2.dev/portraits/';
 *
 * 画像が無い場合でも、キャラ名の頭文字を表示して動作します。
 */
window.PORTRAIT_BASE = window.PORTRAIT_BASE || 'assets/portraits/';
