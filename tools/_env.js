/* テスト用のブラウザもどき.
 *
 *   require('./_env');
 *
 * js/config.js は location / localStorage を見るので、先に用意しておく。
 * これを読まないと COVER_HP_RATIO などが既定値のままになり、
 * ブラウザで動かしたときと結果が変わる。
 */
global.window = global.window || {};
global.location = { search: '', href: 'http://localhost/' };
global.URLSearchParams = global.URLSearchParams || URLSearchParams;
if (!global.localStorage) {
  global.localStorage = {
    _v: {},
    getItem: function (k) { return this._v[k] == null ? null : this._v[k]; },
    setItem: function (k, v) { this._v[k] = String(v); },
    removeItem: function (k) { delete this._v[k]; }
  };
}

require('../js/config.js');
Object.assign(global, window);

module.exports = true;
