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

/* URL を貼るだけで同期するための取り込み口.
 *
 * blablalink のキャラクター情報は、そのサイトにログインしていないと取得できません。
 * ブラウザから直に問い合わせることもできません（CORS）。
 * そのため、ログイン状態を持った中継サーバー（worker/）を経由します。
 * 中継先は ?proxy=… で一度指定すれば、このブラウザに記憶されます。
 */
window.SyncFetch = (function () {
  'use strict';

  function proxyBase() {
    return String(window.SYNC_PROXY || '').replace(/\/+$/, '');
  }

  function openidFrom(text) {
    if (!text) return null;
    var m = String(text).match(/[?&]openid=([^&\s]+)/);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }
    if (/^[A-Za-z0-9+/=_-]{16,}$/.test(String(text).trim())) return String(text).trim();
    return null;
  }

  function request(path, payload) {
    var base = proxyBase();
    if (!base) return Promise.reject(new Error('同期サーバーが未設定です'));
    return fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }).then(function (r) {
      return r.json().catch(function () {
        throw new Error('同期サーバーが応答しませんでした（' + r.status + '）');
      }).then(function (data) {
        if (!r.ok || data.error) throw new Error(data.error || ('同期サーバーが ' + r.status + ' を返しました'));
        return data;
      });
    });
  }

  function fetchByUrl(url) {
    var openid = openidFrom(url);
    if (!openid) return Promise.reject(new Error('URL を読み取れませんでした'));
    return request('/sync', { url: String(url) }).then(function (data) {
      if (!data || !data.characters || !data.characters.length) {
        throw new Error('キャラクター情報が空でした');
      }
      return data;
    });
  }

  function health() {
    var base = proxyBase();
    if (!base) return Promise.resolve(null);
    return fetch(base + '/', { method: 'GET' })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
  }

  return { openidFrom: openidFrom, fetchByUrl: fetchByUrl, health: health, proxyBase: proxyBase };
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

  function status(text, kind) {
    var s = document.querySelector('#syncStatus');
    if (!s) return;
    s.textContent = text || '';
    s.className = 'syncstatus' + (kind ? ' ' + kind : '');
  }

  function open() {
    var body = document.querySelector('#syncBody');
    var configured = !!window.SyncFetch.proxyBase();

    body.innerHTML = [
      '<p class="synclead">BlablaLink の URL を貼ると、所持ニケと育成状況を取り込んで、' +
      'ステータスに反映します。取り込んだ内容はこのブラウザの中だけに保存され、どこにも送られません。</p>',

      '<div class="syncrow">',
      '<input id="syncUrl" type="url" spellcheck="false" autocomplete="off" ' +
      'placeholder="https://www.blablalink.com/user?openid=…">',
      '<button class="syncbtn" id="syncGo">同期</button>',
      '</div>',
      '<p id="syncStatus" class="syncstatus"></p>',

      '<details class="syncadv" id="syncAdv">',
      '<summary>同期サーバー</summary>',
      '<p>キャラクター情報は BlablaLink にログインしていないと取得できないため、' +
      '中継サーバーを1つ用意します。URL を一度入れておけば、次回からは不要です。</p>',
      '<div class="syncrow">',
      '<input id="syncProxy" type="url" spellcheck="false" autocomplete="off" ' +
      'placeholder="https://nikesmi-sync.xxxx.workers.dev">',
      '<button class="syncbtn ghost" id="syncProxySave">保存</button>',
      '</div>',
      '<p class="synchint">作り方は <code>worker/README.md</code> にあります。</p>',
      '</details>',

      '<details class="syncadv">',
      '<summary>うまくいかないとき</summary>',
      '<p>BlablaLink を開いてログインした状態で、下のブックマークを押すと取り込めます。' +
      '（初回だけブックマークバーへドラッグ。Ctrl+Shift+B でバーが出ます）</p>',
      '<p><a class="bmk" id="bmk" href="#" onclick="return false">NIKESMI 同期</a></p>',
      '<p>同期用のファイルをお持ちなら、ここにドロップしても取り込めます。</p>',
      '<div id="dropzone">ここにドロップ、またはクリックして選択' +
      '<input type="file" id="syncFile" accept="application/json,.json" hidden></div>',
      '</details>'
    ].join('');

    var urlInput = document.querySelector('#syncUrl');
    var proxyInput = document.querySelector('#syncProxy');
    var adv = document.querySelector('#syncAdv');

    proxyInput.value = window.SyncFetch.proxyBase();
    if (!configured) adv.open = true;

    document.querySelector('#syncGo').onclick = function () { run(urlInput.value); };
    urlInput.onkeydown = function (e) {
      if (e.key === 'Enter') run(urlInput.value);
    };

    document.querySelector('#syncProxySave').onclick = function () {
      var saved = window.setSyncProxy(proxyInput.value);
      proxyInput.value = saved;
      status(saved ? '保存しました' : '解除しました', saved ? '' : 'warn');
    };

    document.querySelector('#bmk').href = window.Sync.bookmarkletHref;

    var zone = document.querySelector('#dropzone');
    var file = document.querySelector('#syncFile');
    zone.onclick = function () { file.click(); };
    zone.ondragover = function (e) { e.preventDefault(); };
    zone.ondrop = function (e) {
      e.preventDefault();
      if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
    };
    file.onchange = function () { if (file.files[0]) readFile(file.files[0]); };

    function readFile(f) {
      var fr = new FileReader();
      fr.onload = function () { importPayload(safeParse(fr.result)); };
      fr.readAsText(f);
    }

    document.querySelector('#syncSheet').hidden = false;
    setTimeout(function () { urlInput.focus(); }, 60);

    if (configured) {
      window.SyncFetch.health().then(function (h) {
        if (!h) return;
        if (h.has_cookie === false) {
          status('同期サーバーにログイン情報がありません', 'warn');
        }
      });
    }
  }

  function run(text) {
    var value = String(text || '').trim();
    if (!value) { status('URL を入れてください', 'warn'); return; }
    if (!window.SyncFetch.proxyBase()) {
      status('先に同期サーバーを設定してください', 'warn');
      document.querySelector('#syncAdv').open = true;
      return;
    }
    status('読み込み中…');
    var go = document.querySelector('#syncGo');
    go.disabled = true;

    window.SyncFetch.fetchByUrl(value).then(function (data) {
      importPayload(data);
    }).catch(function (e) {
      status((e && e.message) || '同期できませんでした', 'warn');
    }).then(function () {
      go.disabled = false;
    });
  }

  function importPayload(d) {
    if (!d) { status('内容を読み取れませんでした', 'warn'); return; }
    var norm = window.Sync.normalise(d);
    if (!norm) { status('内容を読み取れませんでした', 'warn'); return; }
    var result = window.Sync.applyTo(norm);
    window.Sync.save(result);
    if (window.Nikesmi) window.Nikesmi.setSync(result);
    status('取り込みました — ' + Object.keys(result.owned).length + '体', 'ok');
    setTimeout(function () {
      var sheet = document.querySelector('#syncSheet');
      if (sheet) sheet.hidden = true;
    }, 900);
  }

  function safeParse(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  window.addEventListener('message', receive);

  return { open: open };
})();
