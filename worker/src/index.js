/* ニケシミュ同期サーバー (Cloudflare Worker)
 *
 * blablalink のゲームAPIは「そのアカウントでログインしている人」しか叩けない。
 * ブラウザから直接は CORS でも弾かれるため、この Worker が代理で問い合わせる。
 *
 * 公開するエンドポイント:
 *   GET  /            稼働確認
 *   POST /sync        { url } を渡すと、編成に必要な数値をまとめて返す
 *   POST /api?path=…  生の中継（1本ずつ叩きたいとき用）
 */

const UPSTREAM = 'https://api.blablalink.com';
const VERSION = 3;

const GAME_PATHS = new Set([
  '/api/game/proxy/Game/GetUserCharacters',
  '/api/game/proxy/Game/GetUserCharacterDetails',
  '/api/game/proxy/Game/GetSavedRoleInfo',
  '/api/game/proxy/Game/GetUserProfileBasicInfo',
  '/api/user/CheckLogin'
]);

const AREA_IDS = [81, 82, 83, 84, 85];
const SYNC_TTL = 300;

/* ------------------------------------------------------------------ 基本 */

function corsHeaders(env, request) {
  const allow = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  let value = allow.includes('*') ? '*' : '';
  if (!value && origin && allow.includes(origin)) value = origin;
  if (!value) value = allow[0] || '*';
  return {
    'Access-Control-Allow-Origin': value,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Blablalink-Cookie',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(data, status, extra) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      extra || {}
    )
  });
}

function fail(message, status, extra) {
  return json({ ok: false, error: message }, status || 400, extra);
}

function commonParams() {
  return JSON.stringify({
    game_id: '29080',
    area_id: '',
    source: 'pc_web',
    intl_game_id: '29080',
    language: 'ja',
    env: 'prod'
  });
}

/* ------------------------------------------------------ blablalink 呼び出し */

async function callUpstream(env, path, body, cookieOverride) {
  if (!GAME_PATHS.has(path)) throw new Error('unsupported path: ' + path);

  const headers = {
    'Content-Type': 'application/json',
    'X-Channel-Type': '2',
    'X-Language': 'ja',
    'X-Common-Params': commonParams(),
    Origin: 'https://www.blablalink.com',
    Referer: 'https://www.blablalink.com/',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
  };

  const cookie = cookieOverride || (await getCookie(env));
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(UPSTREAM + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {})
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('upstream returned ' + res.status + ': ' + text.slice(0, 160));
  }

  if (data && data.code === 300001) {
    const err = new Error('blablalink にログインしていません（Cookie の有効期限が切れている可能性があります）');
    err.code = 'not_logged_in';
    throw err;
  }
  return data;
}

async function getCookie(env) {
  if (env.SESSIONS) {
    try {
      const saved = await env.SESSIONS.get('cookie');
      if (saved) return saved;
    } catch (e) {
      /* KV 未設定でも動かす */
    }
  }
  return env.BLABLINK_COOKIE || '';
}

/* ---------------------------------------------------------------- 同期本体 */

function openidFromUrl(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const m = text.match(/[?&]openid=([^&\s]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch (e) {
      return m[1];
    }
  }
  if (/^[A-Za-z0-9+/=_-]{16,}$/.test(text)) return text;
  return null;
}

/* openid は base64（"29080-6956346013834238874"）で来ることが多い。
 * ゲームAPIは数字だけを受け付けるので、19桁を取り出す。 */
function digitsOf(openid) {
  const m = String(openid).match(/\d{19}/);
  return m ? m[0] : null;
}

function decodeBase64(value) {
  try {
    const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return bin;
  } catch (e) {
    return '';
  }
}

async function fetchRoster(env, openid, cookieOverride) {
  const digits = digitsOf(openid) || digitsOf(decodeBase64(openid));
  if (!digits) throw new Error('URL からアカウント情報を読み取れませんでした');
  // ここは数値ではなく文字列で渡す。数値だと上流が system error を返す。
  const intlOpenId = String(digits);

  let area = null;
  try {
    const role = await callUpstream(env, '/api/game/proxy/Game/GetSavedRoleInfo', {}, cookieOverride);
    const found = role && role.data && role.data.role_info && role.data.role_info.area_id;
    if (found) area = Number(found);
  } catch (e) {
    /* 取れなければ総当たりに進む */
  }

  const order = area ? [area].concat(AREA_IDS.filter((a) => a !== area)) : AREA_IDS;
  let list = null;
  let usedArea = area || order[0];

  for (const candidate of order) {
    const res = await callUpstream(env, '/api/game/proxy/Game/GetUserCharacters', {
      intl_open_id: intlOpenId,
      nikke_area_id: candidate
    }, cookieOverride);
    const got = res && res.data && (res.data.characters || res.data.list);
    if (got && got.length) {
      list = got;
      usedArea = candidate;
      break;
    }
  }
  if (!list) throw new Error('キャラクター情報が空でした');

  const codes = list.map((c) => c.name_code).filter(Boolean);
  const details = {};
  const effects = {};
  for (let i = 0; i < codes.length; i += 20) {
    const res = await callUpstream(env, '/api/game/proxy/Game/GetUserCharacterDetails', {
      intl_open_id: intlOpenId,
      nikke_area_id: usedArea,
      name_codes: codes.slice(i, i + 20)
    }, cookieOverride);
    const dl =
      (res && res.data && (res.data.character_details || res.data.characters || res.data.list)) || [];
    for (const d of dl) details[d.name_code] = d;

    // オーバーロードの option id → 効果の対応表。推測せず上流の値を使う。
    const se = (res && res.data && res.data.state_effects) || [];
    for (const e of se) {
      const fn = (e.function_details && e.function_details[0]) || null;
      if (!fn) continue;
      effects[String(e.id)] = [fn.function_type, fn.function_value, fn.function_value_type];
    }
  }

  return {
    ok: true,
    version: VERSION,
    source: 'nikesmi-worker',
    exported_at: new Date().toISOString(),
    area_id: usedArea,
    option_effects: effects,
    characters: list.map((c) => {
      const d = details[c.name_code] || {};
      const pick = (key) => Number(d[key] != null ? d[key] : c[key]) || 0;
      return {
        name_code: Number(c.name_code),
        level: pick('lv'),
        limit_break: pick('grade'),
        core: pick('core'),
        affection: pick('attractive_lv'),
        skills: {
          s1: pick('skill1_lv'),
          s2: pick('skill2_lv'),
          burst: pick('ulti_skill_lv')
        },
        cube_lv: pick('harmony_cube_lv'),
        cube_tid: pick('harmony_cube_tid'),
        equip: {
          head: pick('head_equip_lv'),
          body: pick('torso_equip_lv'),
          arm: pick('arm_equip_lv'),
          leg: pick('leg_equip_lv')
        },
        equip_tier: pick('head_equip_tier'),
        options: [
          d.head_equip_option1_id, d.head_equip_option2_id, d.head_equip_option3_id,
          d.torso_equip_option1_id, d.torso_equip_option2_id, d.torso_equip_option3_id,
          d.arm_equip_option1_id, d.arm_equip_option2_id, d.arm_equip_option3_id,
          d.leg_equip_option1_id, d.leg_equip_option2_id, d.leg_equip_option3_id
        ].map(Number),
        favorite_item_lv: pick('favorite_item_lv'),
        treasure: !!Number(d.favorite_item_tid || c.favorite_item_tid),
        combat: pick('combat')
      };
    })
  };
}

/* ------------------------------------------------------------------ 本体 */

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, '') || '/';

    // ブラウザが持っている Cookie を、その場で転送するだけ。保存はしない。
    const inlineCookie = sanitizeCookie(request.headers.get('X-Blablalink-Cookie'));

    try {
      if (route === '/') {
        return json(
          {
            ok: true,
            service: 'nikesmi-sync',
            version: VERSION,
            has_cookie: !!(await getCookie(env)),
            cached: !!env.SESSIONS
          },
          200,
          cors
        );
      }

      if (request.method !== 'POST') return fail('method not allowed', 405, cors);

      if (route === '/sync') {
        const body = await safeJson(request);
        const openid = openidFromUrl(body.url || body.openid);
        if (!openid) return fail('URL を読み取れませんでした', 400, cors);

        const cacheKey = 'sync:' + openid;
        if (env.SESSIONS) {
          const hit = await env.SESSIONS.get(cacheKey, 'json');
          if (hit) return json(hit, 200, cors);
        }

        const roster = await fetchRoster(env, openid, inlineCookie);
        if (env.SESSIONS) {
          await env.SESSIONS.put(cacheKey, JSON.stringify(roster), { expirationTtl: SYNC_TTL });
        }
        return json(roster, 200, cors);
      }

      if (route === '/api') {
        const path = url.searchParams.get('path') || '';
        if (!GAME_PATHS.has(path)) return fail('この問い合わせには対応していません', 400, cors);
        const body = await safeJson(request);
        const data = await callUpstream(env, path, body.body || body, inlineCookie);
        return json(data, 200, cors);
      }

      return fail('not found', 404, cors);
    } catch (e) {
      const status = e && e.code === 'not_logged_in' ? 401 : 502;
      return json({ ok: false, error: (e && e.message) || String(e) }, status, cors);
    }
  }
};

/* Cookie ヘッダに使える文字だけ通す */
function sanitizeCookie(value) {
  if (!value) return '';
  const text = String(value).replace(/[\r\n]/g, '');
  if (text.length > 4096) return '';
  if (!/^[ -~;=]*$/.test(text)) return '';
  return text;
}

async function safeJson(request) {
  try {
    return (await request.json()) || {};
  } catch (e) {
    return {};
  }
}
