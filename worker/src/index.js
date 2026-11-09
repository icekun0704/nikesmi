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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function upstreamError(data, fallback) {
  const err = new Error(fallback || 'blablalink が応答しませんでした');
  if (data && typeof data === 'object') {
    if (data.msg) err.message = String(data.msg);
    err.upstream_code = data.code;
  }
  return err;
}

/* 一時的な失敗（通信断・5xx・応答が壊れている）は、少し待ってやり直す。
 * blablalink は同じ接続から続けて叩くと、ときどき空の応答を返す。 */
const RETRY_DELAYS = [0, 500, 1200];

async function callUpstream(env, path, body, cookieOverride) {
  let lastError = null;
  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    if (RETRY_DELAYS[attempt]) await sleep(RETRY_DELAYS[attempt]);
    try {
      return await callUpstreamOnce(env, path, body, cookieOverride);
    } catch (e) {
      if (e && e.code === 'not_logged_in') throw e;
      lastError = e;
    }
  }
  throw lastError || upstreamError(null, 'blablalink に接続できませんでした');
}

async function callUpstreamOnce(env, path, body, cookieOverride) {
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
    const err = new Error('blablalink にログインしていません（ログインの有効期限が切れている可能性があります）');
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
  let lastProblem = null;

  for (let i = 0; i < order.length; i++) {
    const candidate = order[i];
    if (i > 0) await sleep(250); // 連続で叩くと上流が空を返すことがある
    let res = null;
    try {
      res = await callUpstream(env, '/api/game/proxy/Game/GetUserCharacters', {
        intl_open_id: intlOpenId,
        nikke_area_id: candidate
      }, cookieOverride);
    } catch (e) {
      lastProblem = e;
      continue;
    }
    const got = res && res.data && (res.data.characters || res.data.list);
    if (got && got.length) {
      list = got;
      usedArea = candidate;
      break;
    }
    if (res && res.code && res.code !== 0) lastProblem = upstreamError(res);
  }
  if (!list) {
    if (lastProblem && lastProblem.code === 'not_logged_in') throw lastProblem;
    const err = new Error(
      'この URL からはキャラクター情報を取得できませんでした。BlablaLink のプロフィール画面の URL か確認してください'
    );
    err.code = 'not_found';
    throw err;
  }

  const codes = list.map((c) => c.name_code).filter(Boolean);
  const details = {};
  const effects = {};
  const missing = [];
  for (let i = 0; i < codes.length; i += 20) {
    const batch = codes.slice(i, i + 20);
    let res = null;
    try {
      res = await callUpstream(env, '/api/game/proxy/Game/GetUserCharacterDetails', {
        intl_open_id: intlOpenId,
        nikke_area_id: usedArea,
        name_codes: batch
      }, cookieOverride);
    } catch (e) {
      /* 1バッチ取れなくても全体は返す（取れた分だけ反映できるように） */
      missing.push(...batch);
      continue;
    }
    const dl =
      (res && res.data && (res.data.character_details || res.data.characters || res.data.list)) || [];
    if (!dl.length) missing.push(...batch);
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
    partial: missing.length > 0,
    missing: missing.slice(0, 60),
    option_effects: effects,
    characters: list.map((c) => {
      const d = details[c.name_code] || {};
      const pick = (key) => Number(d[key] != null ? d[key] : c[key]) || 0;
      return {
        name_code: Number(c.name_code),
        // レベルは一覧側の値を使う（詳細側の lv は常に 1 が返る）
        level: Number(c.lv) || 0,
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
        /* アリーナ用の戦闘力が返っていればそちらを使う（通常とは値が違うことがある） */
        combat: pick('arena_combat') || pick('combat'),
        arena_combat: pick('arena_combat'),
        normal_combat: pick('combat')
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

        const fresh = !!body.fresh;
        const cacheKey = 'sync:' + openid;
        if (!fresh && env.SESSIONS) {
          const hit = await env.SESSIONS.get(cacheKey, 'json');
          if (hit) return json(hit, 200, cors);
        }
        if (!fresh) {
          const hit = await cacheGet(openid);
          if (hit) return json(hit, 200, cors);
        }

        const roster = await fetchRoster(env, openid, inlineCookie);
        if (env.SESSIONS) {
          await env.SESSIONS.put(cacheKey, JSON.stringify(roster), { expirationTtl: SYNC_TTL });
        }
        if (!roster.partial) await cachePut(openid, roster);
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
      const status =
        e && e.code === 'not_logged_in' ? 401 : e && e.code === 'not_found' ? 404 : 502;
      return json({ ok: false, error: (e && e.message) || String(e) }, status, cors);
    }
  }
};

/* 取り込み結果を数分だけ覚えておく。
 * 同じ人が続けて押したときに上流を何十回も叩かないためのもので、
 * 設定なしで使える（Cache API）。失敗しても同期そのものは続行する。 */
const CACHE_URL = 'https://nikesmi-cache.internal/sync/';

async function cacheGet(openid) {
  if (typeof caches === 'undefined' || !caches.default) return null;
  try {
    const res = await caches.default.match(CACHE_URL + encodeURIComponent(openid));
    if (!res) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function cachePut(openid, roster) {
  if (typeof caches === 'undefined' || !caches.default) return;
  try {
    await caches.default.put(
      CACHE_URL + encodeURIComponent(openid),
      new Response(JSON.stringify(roster), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'max-age=' + SYNC_TTL
        }
      })
    );
  } catch (e) {
    /* 失敗しても構わない */
  }
}

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
