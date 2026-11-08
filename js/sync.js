/* BlablaLink とのアカウント同期.
 *
 * api.blablalink.com は Cookie 必須で、しかも blablalink.com 以外のページには
 * CORS ヘッダを返さない。だからこのページから直接は取りに行けない。
 * Cookie がブラウザの外に出ない方法はひとつだけ: blablalink.com の上で動く
 * ブックマークレットに取ってもらい、結果だけを受け取る。
 *
 * 受け取る側は origin / source / type を検証し、数値は Number() で矯正する。
 */
window.Sync = (function () {
  'use strict';

  var PROTOCOL = 'nikesmi-sync/v2';
  var LEGACY = 'nikke-sync/v1';
  var ORIGIN = 'https://www.blablalink.com';
  var STORAGE_KEY = 'nikesmi.sync.v1';

  /* ---------------------------------------------------------- bookmarklet */
  function bookmarkletBody() {
    return '(' + function () {
      var BL = 'https://www.blablalink.com';
      var API = '/api/game/proxy/Game/';
      var UGC = '/api/ugc/proxy/standalonesite/';
      var COMMON = JSON.stringify({
        game_id: '16', intl_game_id: '29080',
        source: 'pc_web', env: 'prod', language: 'ja'
      });

      function post(path, body) {
        return fetch(BL + path, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Channel-Type': '2',
            'X-Language': 'ja',
            'X-Common-Params': COMMON
          },
          body: JSON.stringify(body || {})
        }).then(function (r) { return r.json(); });
      }

      function fail(msg) {
        try {
          if (window.opener) window.opener.postMessage({ type: 'nikesmi-sync/v2', error: String(msg) }, '*');
        } catch (e) { }
        alert('同期に失敗しました: ' + msg);
      }

      var AREAS = [81, 82, 83, 84, 85];

      post(UGC + 'User/GetUserInfoNew', {})
        .then(function (info) {
          var openid = (info && info.data && (info.data.info || info.data).intl_openid) || '';
          if (!openid) throw new Error('ログイン情報が取れません（code ' + (info && info.code) + '）');
          openid = String(openid);
          var digits = (openid.match(/\d{19}/) || [openid])[0];
          return post(API + 'GetSavedRoleInfo', {}).then(function (role) {
            var area = role && role.data && role.data.role_info && role.data.role_info.area_id;
            return { openid: digits, area: area };
          }, function () { return { openid: digits, area: null }; });
        })
        .then(function (ctx) {
          var areas = ctx.area ? [ctx.area].concat(AREAS) : AREAS;
          function attempt(i) {
            if (i >= areas.length) throw new Error('サーバーが見つかりません');
            return post(API + 'GetUserCharacters', {
              intl_open_id: Number(ctx.openid), nikke_area_id: areas[i]
            }).then(function (res) {
              var list = res && res.data && (res.data.characters || res.data.list);
              if (!list || !list.length) return attempt(i + 1);
              ctx.area = areas[i];
              ctx.chars = list;
              return ctx;
            }, function () { return attempt(i + 1); });
          }
          return attempt(0);
        })
        .then(function (ctx) {
          var list = ctx.chars;
          var codes = list.map(function (c) { return c.name_code; }).filter(Boolean);
          var batches = [];
          for (var i = 0; i < codes.length; i += 20) batches.push(codes.slice(i, i + 20));

          var details = {};
          var chain = Promise.resolve();
          batches.forEach(function (batch) {
            chain = chain.then(function () {
              return post(API + 'GetUserCharacterDetails', {
                intl_open_id: Number(ctx.openid),
                nikke_area_id: ctx.area,
                name_codes: batch
              }).then(function (res) {
                var dl = (res && res.data && (res.data.character_details || res.data.characters || res.data.list)) || [];
                dl.forEach(function (d) { details[d.name_code] = d; });
              }, function () { }).then(function () {
                return new Promise(function (r) { setTimeout(r, 700); });
              });
            });
          });

          return chain.then(function () {
            return {
              type: 'nikesmi-sync/v2',
              version: 2,
              source: 'blablalink-bookmarklet',
              exported_at: new Date().toISOString(),
              area_id: ctx.area,
              characters: list.map(function (c) {
                var d = details[c.name_code] || {};
                var pick = function (a, b, fb) {
                  var v = d[a] != null ? d[a] : (c[b] != null ? c[b] : fb);
                  return Number(v) || 0;
                };
                return {
                  name_code: Number(c.name_code),
                  level: pick('lv', 'lv', 0),
                  limit_break: pick('grade', 'grade', 0),
                  core: pick('core', 'core', 0),
                  affection: pick('attractive_lv', 'attractive_lv', 0),
                  skills: {
                    s1: pick('skill1_lv', 'skill1_lv', 0),
                    s2: pick('skill2_lv', 'skill2_lv', 0),
                    burst: pick('ulti_skill_lv', 'ulti_skill_lv', 0)
                  },
                  cube_lv: pick('harmony_cube_lv', 'harmony_cube_lv', 0),
                  equip: {
                    head: pick('head_equip_lv', 'head_equip_lv', 0),
                    body: pick('torso_equip_lv', 'torso_equip_lv', 0),
                    arm: pick('arm_equip_lv', 'arm_equip_lv', 0),
                    leg: pick('leg_equip_lv', 'leg_equip_lv', 0)
                  },
                  options: [
                    d.head_equip_option1_id, d.head_equip_option2_id, d.head_equip_option3_id,
                    d.torso_equip_option1_id, d.torso_equip_option2_id, d.torso_equip_option3_id,
                    d.arm_equip_option1_id, d.arm_equip_option2_id, d.arm_equip_option3_id,
                    d.leg_equip_option1_id, d.leg_equip_option2_id, d.leg_equip_option3_id
                  ].map(Number),
                  favorite_item_lv: pick('favorite_item_lv', 'favorite_item_lv', 0),
                  treasure: !!((d.favorite_item_tid || d.favorite_tid || c.favorite_item_tid) &&
                    Number(d.favorite_item_tid || d.favorite_tid || c.favorite_item_tid) > 0),
                  combat: pick('combat', 'combat', 0)
                };
              })
            };
          });
        })
        .then(function (payload) {
          if (window.opener) {
            window.opener.postMessage(payload, '*');
            setTimeout(function () { window.close(); }, 400);
          } else {
            var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'nikesmi-sync.json';
            a.click();
          }
        })
        .catch(function (e) { fail((e && e.message) || e); });
    }.toString() + ')();';
  }

  var href = 'javascript:' + encodeURIComponent(bookmarkletBody().replace(/\s*\n\s*/g, ' '));

  /* ------------------------------------------------------------- import */
  function toNumber(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }

  function normalise(payload) {
    if (!payload || typeof payload !== 'object') return null;
    var list = null;
    if (Array.isArray(payload)) list = payload;
    else if (Array.isArray(payload.characters)) list = payload.characters;
    else if (payload.data && Array.isArray(payload.data.characters)) list = payload.data.characters;
    else if (payload.data && Array.isArray(payload.data.list)) list = payload.data.list;
    else if (payload.data && Array.isArray(payload.data.character_details)) list = payload.data.character_details;
    if (!list) return null;

    var out = { version: 2, areaId: toNumber(payload.area_id, 0), characters: [] };
    list.forEach(function (raw) {
      var code = toNumber(raw.name_code, 0);
      if (!code) return;
      out.characters.push({
        nameCode: code,
        level: toNumber(raw.level != null ? raw.level : raw.lv),
        limitBreak: toNumber(raw.limit_break != null ? raw.limit_break : raw.grade),
        core: toNumber(raw.core),
        affection: toNumber(raw.affection != null ? raw.affection : raw.attractive_lv),
        skills: {
          s1: toNumber(raw.skills && raw.skills.s1 != null ? raw.skills.s1 : (raw.skill1_lv)),
          s2: toNumber(raw.skills && raw.skills.s2 != null ? raw.skills.s2 : (raw.skill2_lv)),
          burst: toNumber(raw.skills && raw.skills.burst != null ? raw.skills.burst : (raw.ulti_skill_lv))
        },
        cube: toNumber(raw.cube_lv != null ? raw.cube_lv : raw.harmony_cube_lv),
        equip: raw.equip || null,
        options: Array.isArray(raw.options) ? raw.options.map(Number) : null,
        treasure: !!(raw.treasure && raw.treasure.equipped != null ? raw.treasure.equipped : raw.treasure),
        favoriteItemLv: toNumber(raw.favorite_item_lv),
        combat: toNumber(raw.combat)
      });
    });
    return out.characters.length ? out : null;
  }

  /* オーバーロードの option id は statNo*100 + tier の並びで来る。
   * statNo: 0=有利コード 1=命中率 2=最大装弾数 3=攻撃力 4=チャージダメージ
   *         5=チャージ速度 6=会心率 7=会心ダメージ */
  var OPT_MAP = {
    0: 'elementDmg', 1: 'hitRate', 2: 'magazine', 3: 'atk',
    4: 'chargeDmg', 5: 'chargeSpeed', 6: 'critRate', 7: 'critDmg'
  };

  function overloadFrom(options) {
    var out = {};
    if (!options) return out;
    options.forEach(function (id) {
      if (!id || id <= 0) return;
      var statNo = Math.floor(id / 100);
      var tier = id % 100;
      var key = OPT_MAP[statNo];
      if (!key || tier < 1 || tier > 15) return;
      var v = window.Stats ? window.Stats.overloadValue(key, tier) : 0;
      out[key] = Math.round(((out[key] || 0) + v) * 100) / 100;
    });
    return out;
  }

  function buildLookup() {
    var byCode = {};
    (window.CHARACTERS || []).forEach(function (c) {
      if (c.treasure) return;
      if (c.nameCode != null && byCode[String(c.nameCode)] == null) byCode[String(c.nameCode)] = c;
    });
    return byCode;
  }

  function cfgFor(entry) {
    var equipLevels = entry.equip
      ? [entry.equip.head, entry.equip.body, entry.equip.arm, entry.equip.leg].map(Number)
      : [];
    var avg = equipLevels.length
      ? Math.round(equipLevels.reduce(function (a, b) { return a + (b || 0); }, 0) / equipLevels.length)
      : 5;
    return {
      stats: {
        level: entry.level || 400,
        lb: Math.max(0, Math.min(3, entry.limitBreak || 0)),
        core: Math.max(0, Math.min(7, entry.core || 0)),
        affection: Math.max(1, Math.min(40, entry.affection || 1)),
        cubeLevel: Math.max(0, Math.min(15, entry.cube || 0)),
        equipLevel: Math.max(0, Math.min(5, avg)),
        collectible: { rarity: 'SR', level: 10 },
        overload: overloadFrom(entry.options)
      },
      skillLevels: {
        skill1: Math.max(1, Math.min(10, entry.skills.s1 || 1)),
        skill2: Math.max(1, Math.min(10, entry.skills.s2 || 1)),
        burst: Math.max(1, Math.min(10, entry.skills.burst || 1))
      }
    };
  }

  function applyTo(data) {
    var byCode = buildLookup();
    var owned = {};
    var chars = {};
    var unknown = [];
    data.characters.forEach(function (e) {
      var c = byCode[String(e.nameCode)];
      if (!c) { unknown.push(e.nameCode); return; }
      owned[String(e.nameCode)] = true;
      chars[String(c.id)] = cfgFor(e);
    });
    return {
      owned: owned,
      chars: chars,
      unknown: unknown,
      areaId: data.areaId,
      syncedAt: new Date().toISOString()
    };
  }

  function save(result) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(result)); } catch (e) { }
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { return null; }
  }
  function clear() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
  }

  return {
    PROTOCOL: PROTOCOL,
    LEGACY: LEGACY,
    ORIGIN: ORIGIN,
    bookmarkletHref: href,
    normalise: normalise,
    applyTo: applyTo,
    save: save,
    load: load,
    clear: clear
  };
})();

/* ------------------------------------------------------------------ UI */

/* URL を貼るだけで同期するための取得経路.
 *
 * blablalink のゲームAPIは blablalink.com 以外のオリジンに CORS ヘッダを返さない。
 * そのため、静的サイトからは中継なしでは呼べない。中継先は js/config.js の
 * SYNC_PROXY に置く（同梱の tools/cloudflare-worker.js をそのまま配備すればよい）。
 */
window.SyncFetch = (function () {
  'use strict';

  var COMMON = JSON.stringify({
    game_id: '16', intl_game_id: '29080',
    source: 'pc_web', env: 'prod', language: 'ja'
  });

  function openidFrom(text) {
    if (!text) return null;
    var m = String(text).match(/openid=([^&\s]+)/);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }
    if (/^[A-Za-z0-9+/=]{20,}$/.test(String(text).trim())) return String(text).trim();
    return null;
  }

  function digitsOf(openid) {
    var m = String(openid).match(/\d{19}/);
    return m ? m[0] : null;
  }

  function call(path, body) {
    var proxy = window.SYNC_PROXY;
    if (!proxy) return Promise.reject(new Error('中継先が未設定です（js/config.js の SYNC_PROXY）'));
    var base = String(proxy).replace(/\/$/, '');
    return fetch(base + '?path=' + encodeURIComponent(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: body || {}, common: COMMON })
    }).then(function (r) {
      if (!r.ok) throw new Error('中継先が ' + r.status + ' を返しました');
      return r.json();
    });
  }

  var AREAS = [81, 82, 83, 84, 85];

  function fetchByUrl(url) {
    var openid = openidFrom(url);
    if (!openid) return Promise.reject(new Error('URL から openid を読み取れませんでした'));
    var digits = digitsOf(openid) || openid;

    function chars(area) {
      return call('/api/game/proxy/Game/GetUserCharacters', {
        intl_open_id: Number(digits), nikke_area_id: area
      });
    }

    return call('/api/game/proxy/Game/GetSavedRoleInfo', {}).then(function (role) {
      var a = role && role.data && role.data.role_info && role.data.role_info.area_id;
      return a || AREAS[0];
    }).catch(function () { return AREAS[0]; }).then(function (area) {
      return chars(area).then(function (res) {
        var list = res && res.data && (res.data.characters || res.data.list);
        if (list && list.length) return { list: list, area: area };
        return chars(AREAS[0]).then(function (res2) {
          var l2 = res2 && res2.data && (res2.data.characters || res2.data.list);
          if (!l2 || !l2.length) throw new Error('キャラクター情報が空でした');
          return { list: l2, area: AREAS[0] };
        });
      });
    }).then(function (got) {
      var codes = got.list.map(function (c) { return c.name_code; }).filter(Boolean);
      return call('/api/game/proxy/Game/GetUserCharacterDetails', {
        intl_open_id: Number(digits), nikke_area_id: got.area, name_codes: codes
      }).then(function (res) {
        var dl = (res && res.data && (res.data.character_details || res.data.characters || res.data.list)) || [];
        return {
          type: 'nikesmi-sync/v2', version: 2, source: 'blablalink-url',
          area_id: got.area,
          characters: got.list.map(function (c) {
            var d = dl.filter(function (x) { return x.name_code === c.name_code; })[0] || {};
            var pick = function (k) { return Number(d[k] != null ? d[k] : c[k]) || 0; };
            return {
              name_code: Number(c.name_code),
              level: pick('lv'), limit_break: pick('grade'), core: pick('core'),
              affection: pick('attractive_lv'),
              skills: { s1: pick('skill1_lv'), s2: pick('skill2_lv'), burst: pick('ulti_skill_lv') },
              cube_lv: pick('harmony_cube_lv'),
              equip: {
                head: pick('head_equip_lv'), body: pick('torso_equip_lv'),
                arm: pick('arm_equip_lv'), leg: pick('leg_equip_lv')
              },
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
      });
    });
  }

  return { openidFrom: openidFrom, fetchByUrl: fetchByUrl };
})();

window.SyncUI = (function () {
  'use strict';

  var popup = null;

  function receive(ev) {
    if (ev.origin !== window.Sync.ORIGIN) return;
    if (popup && ev.source !== popup) return;
    var d = ev.data;
    if (!d || (d.type !== window.Sync.PROTOCOL && d.type !== window.Sync.LEGACY)) return;
    if (d.error) { status('失敗: ' + d.error); return; }
    importPayload(d);
  }

  function status(text) {
    var s = document.querySelector('#syncStatus');
    if (s) s.textContent = text;
  }

  function open() {
    var body = document.querySelector('#syncBody');
    body.innerHTML = [
      '<p>BlablaLink のプロフィールURLを貼ると、所持ニケと育成状況を取り込みます。</p>',
      '<div style="display:flex;gap:8px;margin:14px 0">',
      '<input id="syncUrl" type="text" placeholder="https://www.blablalink.com/user?openid=..." ',
      'style="flex:1;background:var(--panel-2);border:1px solid var(--line);border-radius:5px;padding:8px 11px;outline:none">',
      '<button id="syncGo" class="tbtn-ghost" style="white-space:nowrap">取り込む</button></div>',
      '<p id="syncStatus" style="color:var(--fg-3);font-size:12px">待機中…</p>',
      '<h3>はじめての人へ</h3>',
      '<p style="font-size:12px">BlablaLink のAPIは、ほかのサイトから直接呼べないようにブロックされています。' +
      'そのため中継サーバーが要ります。同梱の <code>tools/cloudflare-worker.js</code> を Cloudflare Workers に置き、' +
      'そのURLを <code>js/config.js</code> の <code>SYNC_PROXY</code> に書いてください。1回設定すれば、以後はURLを貼るだけです。</p>',
      '<h3>中継しない方法</h3>',
      '<p style="font-size:12px">下のボタンをブックマークバーにドラッグし、BlablaLink のページで押してください。' +
      'Cookie はブラウザの外に出ません。</p>',
      '<p><a class="bmk" id="bmk" href="#" onclick="return false" ',
      'style="display:inline-block;background:var(--self);color:#04140f;text-decoration:none;padding:5px 14px;border-radius:4px;font-weight:700;font-size:12px;cursor:grab">NIKESMI 同期</a></p>',
      '<h3>JSON をドロップ</h3>',
      '<div id="dropzone" style="border:1px dashed var(--line);border-radius:5px;padding:16px;text-align:center;color:var(--fg-3);cursor:pointer">',
      'JSON をドロップ / クリックで選択<input type="file" id="syncFile" accept="application/json,.json" hidden></div>'
    ].join('\n');

    document.querySelector('#bmk').href = window.Sync.bookmarkletHref;

    var input = document.querySelector('#syncUrl');
    try { input.value = localStorage.getItem('nikesmi.syncUrl') || ''; } catch (e) { }

    document.querySelector('#syncGo').onclick = function () {
      var url = input.value.trim();
      if (!url) { status('URLを入れてください'); return; }
      try { localStorage.setItem('nikesmi.syncUrl', url); } catch (e) { }
      status('取得中…');
      window.SyncFetch.fetchByUrl(url).then(function (payload) {
        importPayload(payload);
      }).catch(function (e) {
        status('失敗: ' + (e && e.message ? e.message : e));
      });
    };

    var zone = document.querySelector('#dropzone');
    var file = document.querySelector('#syncFile');
    zone.onclick = function () { file.click(); };
    zone.ondragover = function (e) { e.preventDefault(); };
    zone.ondrop = function (e) { e.preventDefault(); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); };
    file.onchange = function () { if (file.files[0]) readFile(file.files[0]); };

    function readFile(f) {
      var fr = new FileReader();
      fr.onload = function () { importPayload(safeParse(fr.result)); };
      fr.readAsText(f);
    }

    document.querySelector('#syncSheet').hidden = false;
  }

  function importPayload(d) {
    if (!d) { status('内容を読み取れませんでした'); return; }
    var norm = window.Sync.normalise(d);
    if (!norm) { status('内容を読み取れませんでした'); return; }
    var result = window.Sync.applyTo(norm);
    window.Sync.save(result);
    if (window.Nikesmi) window.Nikesmi.setSync(result);
    status('取り込みました — ' + Object.keys(result.owned).length + '体');
    setTimeout(function () { document.querySelector('#syncSheet').hidden = true; }, 800);
  }

  function safeParse(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  window.addEventListener('message', receive);

  return { open: open };
})();
