/* BlablaLink の中継（Cloudflare Workers）.
 *
 * なぜ要るか:
 *   api.blablalink.com は blablalink.com 以外のオリジンに CORS ヘッダを返さない。
 *   静的サイト（GitHub Pages）からは直接呼べないので、同じオリジンで受け直す。
 *
 * 置き方:
 *   1. Cloudflare のダッシュボード → Workers & Pages → Create → Worker
 *   2. このファイルの中身をそのまま貼り付けて Deploy
 *   3. 発行された https://xxxx.yyyy.workers.dev を
 *      js/config.js の window.SYNC_PROXY に書く
 *
 * 中継するのは「公開プロフィールの読み取り」だけで、Cookie は扱わない。
 * 送られてくるのは openid（プロフィールURLに含まれる公開ID）だけ。
 */

const ALLOWED = [
  '/api/game/proxy/Game/GetUserCharacters',
  '/api/game/proxy/Game/GetUserCharacterDetails',
  '/api/game/proxy/Game/GetSavedRoleInfo',
  '/api/game/proxy/Game/GetUserProfileBasicInfo'
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'POST') {
      return new Response('method not allowed', { status: 405, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.searchParams.get('path') || '';
    if (ALLOWED.indexOf(path) < 0) {
      return new Response(JSON.stringify({ error: 'path not allowed' }), {
        status: 400, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS)
      });
    }

    let payload = {};
    try { payload = await request.json(); } catch (e) { /* empty */ }

    const upstream = await fetch('https://api.blablalink.com' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Channel-Type': '2',
        'X-Language': 'ja',
        'X-Common-Params': payload.common || '{}',
        'Origin': 'https://www.blablalink.com',
        'Referer': 'https://www.blablalink.com/'
      },
      body: JSON.stringify(payload.body || {})
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: Object.assign({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }, CORS)
    });
  }
};
