/* ニケシミュ — UI */
(function () {
  'use strict';

  var CHARS = window.CHARACTERS;
  var BY_ID = {};
  CHARS.forEach(function (c) { BY_ID[c.id] = c; });

  var PORTRAIT_BASE = window.PORTRAIT_BASE || 'assets/portraits/';

  function portraitOf(c) {
    var p = window.PORTRAITS && c ? window.PORTRAITS[String(c.id)] : null;
    if (!p) return null;
    if (PORTRAIT_BASE !== 'assets/portraits/') {
      return PORTRAIT_BASE.replace(/\/?$/, '/') + p.replace(/^assets\/portraits\//, '');
    }
    return p;
  }

  var ELEMENT_BEATS = { '灼熱': '風圧', '風圧': '鉄甲', '鉄甲': '電撃', '電撃': '水冷', '水冷': '灼熱' };

  var ELEMENT_COLOR = {
    '灼熱': '#ff6b4a', '水冷': '#4aa8ff', '風圧': '#57d98b',
    '電撃': '#b47bff', '鉄甲': '#c9a24a'
  };

  var MODE = {
    champion: { label: 'チャンピオン', levelLocked: true, cpPenalty: false, trials: 60 },
    rookie: { label: 'ルーキー', levelLocked: false, cpPenalty: true, trials: 50 },
    special: { label: 'スペシャル', levelLocked: false, cpPenalty: true, trials: 50 }
  };

  /* ------------------------------------------------------------------ state */
  var MAX_LEVEL = 1400;

  /* スマホ・非力な端末では計算回数を減らす。結果が重いと操作が引っかかるため。 */
  var LOW_POWER = (function () {
    try {
      if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) return true;
      if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) return true;
    } catch (e) { /* ignore */ }
    return false;
  })();

  var store = {
    mode: 'champion',
    teams: { A: [null, null, null, null, null], B: [null, null, null, null, null] },
    editSide: 'A',
    teamLevel: { A: 400, B: 400 },
    selected: { side: 'A', index: 0 },
    search: '',
    filters: { burst: {}, element: {}, classType: {} },
    ownedOnly: false,
    sort: 'power',
    zoom: 1,
    pan: 0,
    expanded: false,
    playing: false,
    speed: 1,
    frame: 0,
    result: null,
    sample: null,
    sync: null
  };

  try {
    var saved = JSON.parse(localStorage.getItem('nikesmi.ui.v2') || 'null');
    if (saved) {
      if (saved.teams) store.teams = saved.teams;
      if (saved.mode) store.mode = saved.mode;
      if (saved.teamLevel) store.teamLevel = saved.teamLevel;
    }
  } catch (e) { /* ignore */ }

  function persist() {
    try {
      localStorage.setItem('nikesmi.ui.v2', JSON.stringify({
        teams: store.teams, mode: store.mode, teamLevel: store.teamLevel
      }));
    } catch (e) { /* quota */ }
  }

  /* ------------------------------------------------------------- drag */
  /* マウスでもタッチでも同じように動く、ポインタベースのドラッグ。 */
  var dragState = null;

  function placeGhost(x, y) {
    if (!dragState || !dragState.ghost) return;
    dragState.ghost.style.transform = 'translate(' + (x - 30) + 'px,' + (y - 30) + 'px)';
  }
  function slotUnder(x, y) {
    var elAt = document.elementFromPoint(x, y);
    return elAt && elAt.closest ? elAt.closest('.slot') : null;
  }
  function startDrag(payload, ev, label) {
    var g = document.createElement('div');
    g.className = 'dragghost';
    g.textContent = label || '';
    document.body.appendChild(g);
    dragState = { payload: payload, ghost: g, slot: null };
    document.body.classList.add('dragging');
    placeGhost(ev.clientX, ev.clientY);
  }
  function updateDrag(ev) {
    if (!dragState) return;
    placeGhost(ev.clientX, ev.clientY);
    var s = slotUnder(ev.clientX, ev.clientY);
    if (s !== dragState.slot) {
      if (dragState.slot) dragState.slot.classList.remove('dragover');
      dragState.slot = s;
      if (s) s.classList.add('dragover');
    }
  }
  function finishDrag(dropped) {
    if (!dragState) return;
    var s = dragState.slot;
    var payload = dragState.payload;
    if (dragState.ghost && dragState.ghost.parentNode) dragState.ghost.parentNode.removeChild(dragState.ghost);
    if (s) s.classList.remove('dragover');
    document.body.classList.remove('dragging');
    dragState = null;
    if (!dropped || !s) return;
    var side = s.dataset.side;
    var index = parseInt(s.dataset.index, 10);
    if (!side || !(index >= 0)) return;
    if (payload.type === 'char') placeCharAt(side, index, payload.id);
    else if (payload.type === 'slot') moveSlot(payload.side, payload.index, side, index);
  }

  function armDrag(el, payload, label, onClick) {
    el.addEventListener('pointerdown', function (ev) {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      if (ev.target && ev.target.closest && ev.target.closest('.gear')) return;
      var sx = ev.clientX, sy = ev.clientY, started = false;
      function move(e) {
        if (!started) {
          if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) < 8) return;
          started = true;
          el.dataset.dragging = '1';
          if (el._cancelPress) el._cancelPress();
          startDrag(payload, e, label);
        }
        if (e.cancelable) e.preventDefault();
        updateDrag(e);
      }
      function cleanup() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
      }
      function up() {
        cleanup();
        if (started) finishDrag(true);
      }
      // スクロール開始などでブラウザに奪われた場合は、置かずに取り消す
      function cancel() {
        cleanup();
        delete el.dataset.dragging;
        if (started) finishDrag(false);
      }
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    });
    el.addEventListener('click', function (ev) {
      if (el.dataset.dragging) { delete el.dataset.dragging; ev.preventDefault(); ev.stopPropagation(); return; }
      if (onClick) onClick(ev);
    });
  }

  /* ---------------------------------------------------------------- helpers */
  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  function cfgOf(entry) { return (entry && entry.cfg) || null; }

  function levelFor(side) {
    return MODE[store.mode].levelLocked ? 400 : (store.teamLevel[side || 'A'] || 400);
  }

  /* レベルはキャラごとに違う。シンクロデバイスに入っているキャラは共通だが、
   * 入っていないキャラは 1〜200 のまま。取り込み済みのレベルがあればそちらを使う。 */
  function levelForEntry(entry, side) {
    if (MODE[store.mode].levelLocked) return 400;
    var cfg = entry && cfgOf(entry);
    var own = cfg && cfg.stats && cfg.stats.level;
    if (own > 0) return own;
    return store.teamLevel[side || 'A'] || 400;
  }

  function statsOf(entry, side) {
    var c = BY_ID[entry.charId];
    if (!c) return null;
    var cfg = cfgOf(entry) || {};
    var s = Object.assign({}, cfg.stats || {});
    s.level = levelForEntry(entry, side);
    return window.Stats.compute(c, s);
  }

  /* このアプリの式で出した戦闘力。
   * チャンピオンアリーナは Lv400 固定なので、そのときは Lv400 の値になる。
   * チームの戦闘力（戦闘力補正の計算）はこちらを使う。 */
  function cpOf(entry, side) {
    var c = BY_ID[entry.charId];
    var cfg = cfgOf(entry) || {};
    var s = Object.assign({}, cfg.stats || {});
    s.level = levelForEntry(entry, side);
    var st = window.Stats.compute(c, s);
    return window.Stats.combatPower(st, s, cfg.skillLevels || {});
  }

  /* 名簿のカードはまだ編成に入っていないので cfg を持たない。
   * 同期していれば、そのキャラの実際の育成状況で戦闘力を出す。 */
  function rosterEntry(c) {
    var chars = store.sync && store.sync.chars;
    return { charId: c.id, cfg: (chars && chars[String(c.id)]) || null };
  }

  /* キャラを選ぶときの戦闘力。
   * 取り込み済みならゲームが持っている値をそのまま出す（このアプリの式とは一致しない）。 */
  function cpGame(entry, side) {
    var cfg = cfgOf(entry) || {};
    if (cfg.combat > 0) return cfg.combat;
    return cpOf(entry, side);
  }

  /* 戦闘力は1体ごとにステータスを全部計算するので軽くない。
   * 名簿は223枚あり、並べ替えでも同じキャラを何度も呼ぶため、
   * 描画1回のあいだは結果を使い回す（renderRoster で捨てる）。 */
  var cpCache = {};
  function cpOfChar(c, side) {
    var key = String(c.id) + '|' + (side || 'A') + '|' + store.mode;
    if (cpCache[key] == null) {
      var entry = rosterEntry(c);
      /* 取り込み済みで、そのキャラの値が無い＝所持していない。
       * ここで計算すると架空の戦闘力が上位に来て並びが崩れるので出さない。 */
      cpCache[key] = (store.sync && store.sync.chars && !entry.cfg) ? 0 : cpGame(entry, side);
    }
    return cpCache[key];
  }

  function totalCp(team, side) {
    var t = 0;
    team.forEach(function (e) { if (e) t += cpOf(e, side); });
    return t;
  }

  function ownedSet() {
    return store.sync && store.sync.owned ? store.sync.owned : null;
  }
  function isOwned(c) {
    var o = ownedSet();
    if (!o) return true;
    return !!o[String(c.nameCode)];
  }
  function burstStages(c) {
    var s = String(c.burstStage || '');
    return s.match(/B[123]/g) || ['B1', 'B2', 'B3'];
  }

  /* ----------------------------------------------------------------- roster */
  function rosterList() {
    var f = store.filters;
    var q = store.search.trim().toLowerCase();
    var burstSel = Object.keys(f.burst).filter(function (k) { return f.burst[k]; });
    var elemSel = Object.keys(f.element).filter(function (k) { return f.element[k]; });
    var clsSel = Object.keys(f.classType).filter(function (k) { return f.classType[k]; });

    var list = CHARS.filter(function (c) {
      if (burstSel.length && !burstStages(c).some(function (b) { return burstSel.indexOf(b) >= 0; })) return false;
      if (elemSel.length && elemSel.indexOf(c.element) < 0) return false;
      if (clsSel.length && clsSel.indexOf(c.classType) < 0) return false;
      if (store.ownedOnly && !isOwned(c)) return false;
      if (q) {
        var hay = (c.name + ' ' + (c.enName || '') + ' ' + (c.company || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });

    list.sort(function (a, b) {
      switch (store.sort) {
        case 'name': return a.name.localeCompare(b.name, 'ja');
        case 'burst': {
          var ba = burstStages(a)[0] || 'B9', bb = burstStages(b)[0] || 'B9';
          return ba.localeCompare(bb) || a.name.localeCompare(b.name, 'ja');
        }
        case 'atk': return statsOf(rosterEntry(b)).atk - statsOf(rosterEntry(a)).atk;
        case 'hp': return statsOf(rosterEntry(b)).hp - statsOf(rosterEntry(a)).hp;
        default: return cpOfChar(b) - cpOfChar(a);
      }
    });
    return list;
  }

  function inTeam(charId) {
    var where = null;
    ['A', 'B'].forEach(function (side) {
      store.teams[side].forEach(function (e) { if (e && e.charId === charId) where = side; });
    });
    return where;
  }

  function renderRoster() {
    var host = $('#roster');
    host.innerHTML = '';
    cpCache = {};
    var list = rosterList();
    $('#count').textContent = list.length + '体';

    if (!list.length) {
      if (rosterObserver) { rosterObserver.disconnect(); rosterObserver = null; }
      rosterQueue = []; rosterHost = null;
      host.appendChild(el('div', 'roster-empty', '条件に合うキャラがいません'));
      return;
    }

    /* 223枚を一度に作るとスマホで重い。60枚ずつ、スクロールに応じて足す。 */
    rosterQueue = list.slice();
    rosterHost = host;
    function makeRosterCard(c) {
      var card = el('div', 'card');
      card.dataset.charId = String(c.id);
      card.draggable = true;
      card.title = c.name + ' / ' + c.weapon + ' / ' + c.element + ' / ' + c.classType;

      var where = inTeam(c.id);
      if (where === 'A') card.classList.add('inA');
      if (where === 'B') card.classList.add('inB');

      var thumb = el('div', 'thumb');
      var p = portraitOf(c);
      if (p) {
        var img = document.createElement('img');
        img.src = p; img.alt = ''; img.draggable = false; img.loading = 'lazy';
        img.addEventListener('error', function () {
          if (img.parentNode) img.parentNode.replaceChild(el('div', 'fallback', c.name.charAt(0)), img);
        });
        thumb.appendChild(img);
      } else {
        thumb.appendChild(el('div', 'fallback', c.name.charAt(0)));
      }

      /* 左上に 属性 / 武器 / バースト段階 を縦に積む（ゲーム内の札と同じ並び）。 */
      var icons = el('div', 'icons');
      var elIcon = el('span', 'ic el', String(c.element || '').charAt(0));
      elIcon.style.setProperty('--el', ELEMENT_COLOR[c.element] || '#888');
      elIcon.title = c.element || '';
      icons.appendChild(elIcon);
      icons.appendChild(el('span', 'ic wp', c.weapon || ''));
      var stage = burstStages(c)[0] || '';
      var roman = { B1: 'I', B2: 'II', B3: 'III' }[stage] || '';
      var bIcon = el('span', 'ic bs ' + stage.toLowerCase(), roman);
      bIcon.title = 'バースト' + stage.replace('B', '');
      icons.appendChild(bIcon);
      thumb.appendChild(icons);
      if (c.treasure) thumb.appendChild(el('span', 'treasure', '宝物'));

      var plate = el('div', 'plate');
      var top = el('div', 'ptop');
      top.appendChild(el('span', 'lv', 'Lv.' + (levelForEntry({ charId: c.id, cfg: rosterEntry(c).cfg }, store.editSide) || 400)));
      top.appendChild(el('span', 'nm', c.name));
      plate.appendChild(top);

      var clsTag = { '火力型': '火力', '防御型': '防御', '支援型': '支援' }[c.classType] || c.classType;
      var line = el('div', 'sub');
      line.appendChild(el('span', 'tagcls ' + c.classType.replace('型', ''), clsTag));
      var cpv = cpOfChar(c, store.editSide);
      line.appendChild(el('span', 'tacp',
        cpv > 0 ? Math.round(cpv / 100) / 10 + 'k' : '—'));
      plate.appendChild(line);

      card.appendChild(thumb);
      card.appendChild(plate);
      if (where) card.appendChild(el('div', 'used'));
      if (store.sync && !isOwned(c)) card.classList.add('dim');

      var pressTimer = null, longPressed = false;
      card.addEventListener('pointerdown', function () {
        longPressed = false;
        pressTimer = setTimeout(function () {
          longPressed = true;
          openSkillSheet(c);
        }, 1000);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (evt) {
        card.addEventListener(evt, function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
      });
      card._cancelPress = function () {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        longPressed = false;
      };
      armDrag(card, { type: 'char', id: c.id }, c.name, function () {
        if (longPressed) { longPressed = false; return; }
        placeChar(c.id);
      });

      return card;
    }

    rosterMakeCard = makeRosterCard;
    if (!host.dataset.moreBound) {
      host.dataset.moreBound = '1';
      host.addEventListener('scroll', maybeAppendMore, { passive: true });
      window.addEventListener('scroll', maybeAppendMore, { passive: true });
    }
    appendRosterChunk();
  }

  /* IntersectionObserver が発火しない環境（非表示タブなど）でも止まらないよう、
   * スクロール時にも末尾カードの位置を見る。 */
  function maybeAppendMore() {
    if (!rosterQueue.length || !rosterHost) return;
    var last = rosterHost.lastElementChild;
    if (!last) return;
    var r = last.getBoundingClientRect();
    var vh = window.innerHeight || 0;
    if (r.bottom < vh + 600) appendRosterChunk();
  }

  var ROSTER_CHUNK = 60;
  var rosterQueue = [], rosterHost = null, rosterObserver = null, rosterMakeCard = null;

  function appendRosterChunk() {
    if (!rosterHost) return;
    if (rosterObserver) { rosterObserver.disconnect(); rosterObserver = null; }
    var frag = document.createDocumentFragment();
    var n = 0;
    while (rosterQueue.length && n < ROSTER_CHUNK) {
      frag.appendChild(rosterMakeCard(rosterQueue.shift()));
      n += 1;
    }
    rosterHost.appendChild(frag);
    if (!rosterQueue.length) return;
    /* 番人を別要素で置くとグリッドに行が1つ増えて隙間が空くので、末尾カードを見張る。 */
    if (!('IntersectionObserver' in window)) return;
    rosterObserver = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { appendRosterChunk(); return; }
      }
    }, { rootMargin: '600px 0px' });
    rosterObserver.observe(rosterHost.lastElementChild);
  }

  /* ------------------------------------------------------------------ board */
  /* 再生中は毎フレーム renderBoard を呼ぶと、10スロット分のDOMを作り直すことになり
   * スマホで重い。HPバーの幅だけを書き換える。 */
  function updateHpBars(side) {
    var host = document.querySelector('#slots' + side);
    if (!host || !store.sample) return;
    for (var i = 0; i < host.children.length; i++) {
      var slot = host.children[i];
      var fill = slot.querySelector('.hpfill');
      if (!fill) continue;
      var u = store.sample.teams[side][i];
      if (!u) { fill.style.transform = 'scaleX(0)'; continue; }
      var pct = Math.max(0, Math.min(1, hpAt(u, store.frame) / u.hpMax));
      /* width ではなく transform。毎フレームのレイアウトを避ける。 */
      fill.style.transform = 'scaleX(' + pct + ')';
      var ghost = slot.querySelector('.hpghost');
      if (ghost) ghost.style.transform = 'scaleX(' + pct + ')';
      var cov = slot.querySelector('.covfill');
      if (cov) {
        var c = u.coverMax ? Math.max(0, Math.min(1, coverAt(u, store.frame) / u.coverMax)) : 0;
        cov.style.transform = 'scaleX(' + c + ')';
      }
    }
  }

  function renderBoard(side) {
    var host = $('#slots' + side);
    host.innerHTML = '';
    for (var i = 0; i < 5; i++) host.appendChild(makeSlot(side, i));
    var cp = totalCp(store.teams[side], side);
    var meta = $('#meta' + side);
    meta.textContent = '';
    if (!MODE[store.mode].levelLocked) {
      var lvWrap = document.createElement('label');
      lvWrap.className = 'lvwrap';
      lvWrap.appendChild(el('span', null, 'Lv'));
      var inp = document.createElement('input');
      inp.type = 'number'; inp.min = 1; inp.max = MAX_LEVEL;
      inp.id = 'lv' + side;
      inp.value = store.teamLevel[side] || 400;
      var lvTimer = null;
      var applyLv = function () {
        var v = Math.max(1, Math.min(MAX_LEVEL, parseInt(inp.value, 10) || 400));
        store.teamLevel[side] = v;
        // このチームの全員をそのレベルにする（シンクロデバイスの考え方）
        store.teams[side].forEach(function (e) {
          if (!e) return;
          e.cfg = e.cfg || {};
          e.cfg.stats = e.cfg.stats || {};
          e.cfg.stats.level = v;
        });
        persist();
        // ここで renderBoard を呼ぶと input ごと作り直され、スピナーの押下が途切れる。
        // レベルは編成を変えないので、表示だけを差し替える。
        refreshLevelLabels(side);
        scheduleSim();
      };
      inp.addEventListener('input', function () {
        if (lvTimer) clearTimeout(lvTimer);
        lvTimer = setTimeout(function () { lvTimer = null; applyLv(); }, 250);
      });
      inp.addEventListener('change', function () {
        if (lvTimer) { clearTimeout(lvTimer); lvTimer = null; }
        applyLv();
      });
      lvWrap.appendChild(inp);
      meta.appendChild(lvWrap);
    }
    if (cp) meta.appendChild(el('span', 'cpv', Math.round(cp / 1000) + 'k'));
  }

  /* レベルの変更は編成に影響しないので、スロットとメタ表示の文字だけ更新する */
  function refreshLevelLabels(side) {
    var host = document.querySelector('#slots' + side);
    if (host) {
      Array.prototype.forEach.call(host.children, function (slot) {
        var idx = parseInt(slot.dataset.index, 10);
        var entry = store.teams[side][idx];
        var lab = slot.querySelector('.lv');
        if (!lab || !entry) return;
        var cfg = cfgOf(entry) || {};
        var v = (cfg.stats && cfg.stats.level) || 400;
        lab.textContent = MODE[store.mode].levelLocked ? 'Lv400' : 'Lv' + v;
      });
    }
    var meta = document.querySelector('#meta' + side);
    if (meta) {
      var cpv = meta.querySelector('.cpv');
      if (cpv) {
        var cp = totalCp(store.teams[side], side);
        if (cp) cpv.textContent = Math.round(cp / 1000) + 'k';
      }
    }
  }

  function makeSlot(side, index) {
    var entry = store.teams[side][index];
    var slot = el('div', 'slot');
    slot.dataset.side = side;
    slot.dataset.index = String(index);

    if (store.selected.side === side && store.selected.index === index) slot.classList.add('selected');

    if (!entry) {
      slot.classList.add('empty');
      var plus = el('span', 'plus');
      plus.appendChild(el('span', null, '＋'));
      slot.appendChild(plus);
      slot.appendChild(el('span', 'pnum', 'P' + (index + 1)));
    } else {
      var c = BY_ID[entry.charId];
      var stage = burstStages(c)[0];
      if (stage === 'B1') slot.classList.add('b1');
      else if (stage === 'B2') slot.classList.add('b2');
      else if (stage === 'B3') slot.classList.add('b3');
      var p = portraitOf(c);
      if (p) {
        var img = document.createElement('img');
        img.className = 'face'; img.src = p; img.alt = ''; img.draggable = false;
        img.addEventListener('error', function () {
          if (img.parentNode) img.parentNode.replaceChild(el('div', 'facefallback', c.name.charAt(0)), img);
        });
        slot.appendChild(img);
      } else {
        slot.appendChild(el('div', 'facefallback', c.name.charAt(0)));
      }

      var txt = el('div', 'txt');
      txt.appendChild(el('div', 'nm', c.name));
      var meta = el('div', 'meta');
      meta.appendChild(el('span', 'bst', burstStages(c)[0] || ''));
      var dot = el('span', 'el');
      dot.style.background = ELEMENT_COLOR[c.element] || '#888';
      meta.appendChild(dot);
      var cfg = cfgOf(entry) || {};
      var lv = (cfg.stats && cfg.stats.level) || 400;
      meta.appendChild(el('span', 'lv', MODE[store.mode].levelLocked ? 'Lv400' : 'Lv' + lv));
      txt.appendChild(meta);
      slot.appendChild(txt);

      var gear = el('button', 'gear', '⚙');
      gear.title = 'ステータスを設定';
      gear.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openUnitSheet(side, index);
      });
      slot.appendChild(gear);
      var clr = el('button', 'gear clear', '×');
      clr.title = 'この枠から外す';
      clr.style.right = '21px';
      clr.addEventListener('click', function (ev) {
        ev.stopPropagation();
        store.teams[side][index] = null;
        store.selected = { side: side, index: index };
        persist(); renderAll(); scheduleSim();
      });
      slot.appendChild(clr);
      slot.appendChild(el('span', 'pnum', 'P' + (index + 1)));

      if (store.sample) {
        var u = store.sample.teams[side][index];
        if (u) {
          /* 遮蔽物（上段・細い）と HP（下段・太い）。
           * HP は残像つきで、減った分が一瞬だけ明るく残る。 */
          var wrap = el('div', 'vitals');
          var covWrap = el('div', 'cov');
          var covFill = el('i', 'covfill');
          covWrap.appendChild(covFill);
          wrap.appendChild(covWrap);

          var hpWrap = el('div', 'hp');
          var ghost = el('i', 'hpghost');
          var fill = el('i', 'hpfill');
          hpWrap.appendChild(ghost);
          hpWrap.appendChild(fill);
          wrap.appendChild(hpWrap);

          var hp = hpAt(u, store.frame);
          var pct = Math.max(0, Math.min(1, hp / u.hpMax));
          var cov = coverAt(u, store.frame);
          var cpct = u.coverMax ? Math.max(0, Math.min(1, cov / u.coverMax)) : 0;
          fill.style.transform = 'scaleX(' + pct + ')';
          ghost.style.transform = 'scaleX(' + pct + ')';
          covFill.style.transform = 'scaleX(' + cpct + ')';
          slot.appendChild(wrap);
        }
      }
    }

    armDrag(
      slot,
      entry ? { type: 'slot', side: side, index: index } : { type: 'empty' },
      entry ? BY_ID[entry.charId] && BY_ID[entry.charId].name : '',
      function (ev) {
        if (ev.target.closest('.gear')) return;
        store.selected = { side: side, index: index };
        store.editSide = side;
        syncEditSeg();
        renderBoard('A'); renderBoard('B');
      }
    );

    return slot;
  }

  /* --------------------------------------------------------------- placing */
  function moveSlot(fromSide, fromIndex, toSide, toIndex) {
    if (fromSide === toSide && fromIndex === toIndex) return;
    var moving = store.teams[fromSide][fromIndex];
    if (!moving) return;
    var target = store.teams[toSide][toIndex];
    store.teams[toSide][toIndex] = moving;
    store.teams[fromSide][fromIndex] = target || null;
    store.selected = { side: toSide, index: toIndex };
    persist();
    renderAllLight();
    scheduleSim();
  }

  function firstEmpty(side) {
    for (var i = 0; i < 5; i++) if (!store.teams[side][i]) return i;
    return -1;
  }

  function placeChar(charId) {
    placeCharAt(store.selected.side, store.selected.index, charId);
  }

  function placeCharAt(side, index, charId) {
    // 同じニケを両チームに置ける。同じチーム内の重複だけ外す。
    store.teams[side].forEach(function (e, i) {
      if (e && e.charId === charId) store.teams[side][i] = null;
    });
    var cfg = null;
    if (store.sync && store.sync.chars) cfg = store.sync.chars[String(charId)] || null;
    store.teams[side][index] = { charId: charId, cfg: cfg };

    var next = firstEmpty(side);
    store.selected = { side: side, index: next >= 0 ? next : index };
    persist();
    renderAllLight();
    scheduleSim();
  }

  /* ---------------------------------------------------------------- party */
  function renderPartySelects() {
    ['A', 'B'].forEach(function (side) {
      var sel = $('#party' + side);
      sel.innerHTML = '';
      var cur = el('option', null, '読み込み');
      cur.value = '';
      sel.appendChild(cur);
      window.Parties.list().forEach(function (p) {
        var o = el('option', null, p.name);
        o.value = p.id;
        sel.appendChild(o);
      });
      sel.onchange = function () {
        var p = window.Parties.get(sel.value);
        if (!p) return;
        var units = p.units.map(function (u) {
          if (!u || !u.charId) return null;
          /* 保存した編成に育成状況が入っていなければ、いまの取り込み内容を使う */
          var cfg = u.cfg || (store.sync && store.sync.chars && store.sync.chars[String(u.charId)]) || null;
          return { charId: u.charId, cfg: cfg };
        });
        while (units.length < 5) units.push(null);
        store.teams[side] = units;
        sel.value = '';
        persist();
        renderAll();
        scheduleSim();
      };
    });

    ['A', 'B'].forEach(function (side) {
      $('#save' + side).onclick = function () {
        var name = prompt('編成の名前', (side === 'A' ? '自分' : '相手') + ' ' + new Date().toLocaleDateString('ja-JP'));
        if (name == null) return;
        window.Parties.save(name, store.teams[side]);
        renderPartySelects();
      };
    });
  }

  /* ----------------------------------------------------------- skill sheet */
  function openSkillSheet(c) {
    var st = c.skillText || {};
    var parts = [];
    parts.push('<h3>' + c.name + '</h3>');
    parts.push('<p style="color:var(--fg-3);margin-top:-4px">' +
      [c.weapon, c.element, c.classType, 'バースト ' + burstStages(c).join('/')].join(' ・ ') + '</p>');
    [['burst', 'バーストスキル'], ['skill1', 'スキル1'], ['skill2', 'スキル2']].forEach(function (pair) {
      var lines = st[pair[0]] || [];
      if (!lines.length) return;
      parts.push('<h4>' + pair[1] + '</h4>');
      parts.push('<div>' + lines.map(function (ln) {
        return String(ln).replace(/<b>|<\/b>/g, '').replace(/<font[^>]*>|<\/font>/g, '')
          .replace(/<br\s*\/?>/g, '<br>');
      }).join('<br>') + '</div>');
    });
    parts.push('<p style="color:var(--fg-3);font-size:11.5px;margin-top:16px">長押しで表示しています。タップすると編成に入ります。</p>');
    document.querySelector('#skillTitle').textContent = c.name + ' — スキル';
    document.querySelector('#skillBody').innerHTML = parts.join('');
    document.querySelector('#skillSheet').hidden = false;
  }

  /* ------------------------------------------------------------ unit sheet */
  var editing = null;

  function openUnitSheet(side, index) {
    var entry = store.teams[side][index];
    if (!entry) return;
    editing = { side: side, index: index };
    renderUnitSheet();
    $('#unitSheet').hidden = false;
  }

  function numField(label, value, min, max, step, onChange) {
    var row = el('div', 'field');
    row.appendChild(el('label', null, label));
    var inp = document.createElement('input');
    inp.type = 'number'; inp.value = value;
    inp.min = min; inp.max = max; if (step) inp.step = step;
    var apply = function () {
      var v = parseFloat(inp.value);
      if (!isFinite(v)) v = value;
      v = Math.max(min, Math.min(max, v));
      onChange(v);
      onEdited();
    };
    // 数字の矢印を押した時は change が来ないことがあるので input でも拾う
    var timer = null;
    inp.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; apply(); }, 250);
    });
    inp.addEventListener('change', function () {
      if (timer) { clearTimeout(timer); timer = null; }
      var v = parseFloat(inp.value);
      if (!isFinite(v)) v = value;
      inp.value = Math.max(min, Math.min(max, v));
      apply();
    });
    row.appendChild(inp);
    return row;
  }

  function selectField(label, value, options, onChange) {
    var row = el('div', 'field');
    row.appendChild(el('label', null, label));
    var sel = document.createElement('select');
    options.forEach(function (o) {
      var op = el('option', null, o.label);
      op.value = String(o.value);
      if (String(value) === String(o.value)) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener('change', function () { onChange(sel.value); onEdited(); });
    row.appendChild(sel);
    return row;
  }

  function onEdited() {
    persist();
    renderBoard('A'); renderBoard('B');
    renderRoster();
    scheduleSim();
    renderUnitSheet();
  }

  function renderUnitSheet() {
    var host = $('#unitBody');
    if (!editing) return;
    var entry = store.teams[editing.side][editing.index];
    if (!entry) { $('#unitSheet').hidden = true; return; }
    var c = BY_ID[entry.charId];
    var cfg = entry.cfg || (entry.cfg = {});
    cfg.stats = cfg.stats || {};
    cfg.skillLevels = cfg.skillLevels || { skill1: 10, skill2: 10, burst: 10 };
    var s = cfg.stats;
    var mode = MODE[store.mode];

    host.innerHTML = '';

    var head = el('div', 'unithead');
    var p = portraitOf(c);
    if (p) {
      var im = document.createElement('img'); im.className = 'face'; im.src = p; im.alt = '';
      im.addEventListener('error', function () {
        if (im.parentNode) im.parentNode.replaceChild(el('div', 'fallback', c.name.charAt(0)), im);
      });
      head.appendChild(im);
    } else head.appendChild(el('div', 'fallback', c.name.charAt(0)));

    var hw = el('div');
    hw.appendChild(el('h2', null, c.name));
    hw.appendChild(el('div', 'meta',
      [c.weapon, c.element, c.classType, 'バースト' + burstStages(c).join('/')].join(' ・ ') +
      '　戦闘力 ' + cpOf(entry).toLocaleString('ja-JP')));
    head.appendChild(hw);
    host.appendChild(head);

    var grid = el('div', 'unitgrid');
    host.appendChild(grid);

    var g1 = el('div', 'fieldset');
    g1.appendChild(el('h4', null, '育成'));
    var lvField = numField('レベル', levelForEntry(entry, editing.side), 1, MAX_LEVEL, 1, function (v) {
      s.level = mode.levelLocked ? 400 : v;
    });
    if (mode.levelLocked) {
      lvField.querySelector('input').disabled = true;
      lvField.querySelector('input').value = 400;
      lvField.title = 'チャンピオンアリーナは全員Lv400固定です';
    }
    lvField.title = 'レベルはチーム共通です（編成バーの Lv）';
    g1.appendChild(lvField);
    g1.appendChild(selectField('限界突破', s.lb == null ? 3 : s.lb,
      [0, 1, 2, 3].map(function (v) { return { value: v, label: v + '凸' }; }),
      function (v) { s.lb = +v; }));
    g1.appendChild(numField('コア強化', s.core == null ? 3 : s.core, 0, 7, 1, function (v) { s.core = v; }));
    g1.appendChild(numField('好感度', s.affection == null ? 40 : s.affection, 1, 40, 1, function (v) { s.affection = v; }));
    g1.appendChild(numField('スキル1', cfg.skillLevels.skill1, 1, 10, 1, function (v) { cfg.skillLevels.skill1 = v; }));
    g1.appendChild(numField('スキル2', cfg.skillLevels.skill2, 1, 10, 1, function (v) { cfg.skillLevels.skill2 = v; }));
    g1.appendChild(numField('バースト', cfg.skillLevels.burst, 1, 10, 1, function (v) { cfg.skillLevels.burst = v; }));
    grid.appendChild(g1);

    var g2 = el('div', 'fieldset');
    g2.appendChild(el('h4', null, '装備・ハーモニーキューブ・コレクション'));
    g2.appendChild(selectField('装備強化', s.equipLevel == null ? 5 : s.equipLevel,
      [0, 1, 2, 3, 4, 5].map(function (v) { return { value: v, label: 'T10 +' + v }; }),
      function (v) { s.equipLevel = +v; }));
    var cubeOpts = (window.CUBES || []).map(function (cb) {
      return { value: cb.id, label: cb.id === 'none' ? 'なし' : cb.name };
    });
    var cubeSel = s.cube || (s.cube = { id: 'none', level: 10 });
    if (typeof cubeSel === 'string') { s.cube = { id: cubeSel, level: s.cubeLevel || 10 }; cubeSel = s.cube; }
    g2.appendChild(selectField('ハーモニーキューブ', cubeSel.id, cubeOpts, function (v) { cubeSel.id = v; }));
    g2.appendChild(numField('ハーモニーキューブ Lv', cubeSel.level == null ? 10 : cubeSel.level, 0, 15, 1, function (v) {
      cubeSel.level = v; s.cubeLevel = v;
    }));
    var coll = s.collectible || { rarity: 'SR', level: 10 };
    s.collectible = coll;
    g2.appendChild(selectField('コレクション', coll.rarity,
      [{ value: 'SR', label: 'SR' }, { value: 'R', label: 'R' }],
      function (v) { coll.rarity = v; }));
    g2.appendChild(numField('コレクション Lv', coll.level, 0, 15, 1, function (v) { coll.level = v; }));
    if (c.treasure) {
      var note = el('div', 'statrow');
      note.appendChild(el('span', 'k', '宝物'));
      note.appendChild(el('span', null, 'コレクションSR Lv15 相当'));
      g2.appendChild(note);
    }
    grid.appendChild(g2);

    var g3 = el('div', 'fieldset');
    g3.appendChild(el('h4', null, '研究（リサイクルルーム）'));
    var res = s.research || { general: 180, classType: 100, company: 100 };
    s.research = res;
    g3.appendChild(numField('一般研究', res.general, 0, 300, 10, function (v) { res.general = v; }));
    g3.appendChild(numField('クラス研究', res.classType, 0, 300, 10, function (v) { res.classType = v; }));
    g3.appendChild(numField('企業研究', res.company, 0, 300, 10, function (v) { res.company = v; }));
    grid.appendChild(g3);

    var g4 = el('div', 'fieldset');
    g4.appendChild(el('h4', null, 'オーバーロード（合計 %）'));
    var ol = s.overload || (s.overload = {});
    var OL_FIELDS = [
      ['atk', '攻撃力'], ['critRate', '会心率'], ['critDmg', '会心ダメージ'],
      ['elementDmg', '有利コード'], ['chargeDmg', 'チャージダメージ'],
      ['chargeSpeed', 'チャージ速度'], ['magazine', '最大装弾数']
    ];
    OL_FIELDS.forEach(function (pair) {
      var key = pair[0];
      var row = el('div', 'field');
      row.appendChild(el('label', null, pair[1]));
      var inp = document.createElement('input');
      inp.type = 'number'; inp.step = '0.01';
      inp.value = (ol[key] || 0).toFixed(2);
      inp.style.width = '78px';
      inp.style.textAlign = 'right';
      inp.addEventListener('change', function () {
        ol[key] = Math.max(0, Math.min(400, parseFloat(inp.value) || 0));
        onEdited();
      });
      var wrap = el('span');
      wrap.style.display = 'flex'; wrap.style.alignItems = 'center'; wrap.style.gap = '4px';
      wrap.appendChild(inp);
      wrap.appendChild(el('span', 'val', '%'));
      row.appendChild(wrap);
      g4.appendChild(row);
    });
    grid.appendChild(g4);

    var g5 = el('div', 'fieldset');
    g5.appendChild(el('h4', null, '最終ステータス'));
    var st = statsOf(entry, editing ? editing.side : side);
    [['攻撃力', st.atk], ['HP', st.hp], ['防御力', st.def], ['戦闘力', cpOf(entry)]].forEach(function (row) {
      var r = el('div', 'statrow');
      r.appendChild(el('span', 'k', row[0]));
      r.appendChild(el('span', null, Math.round(row[1]).toLocaleString('ja-JP')));
      g5.appendChild(r);
    });
    var reset = el('button', 'iconbtn', 'このキャラの設定を初期化');
    reset.style.marginTop = '10px';
    reset.onclick = function () { entry.cfg = null; onEdited(); };
    g5.appendChild(reset);
    grid.appendChild(g5);

    $('#unitTitle').textContent = c.name + ' — ステータス';
  }

  /* ----------------------------------------------------------- simulation */
  var simTimer = null;

  function scheduleSim() {
    if (simTimer) clearTimeout(simTimer);
    simTimer = setTimeout(runSim, LOW_POWER ? 260 : 140);
  }

  function teamsToChars(side) {
    return store.teams[side].map(function (e) { return e ? BY_ID[e.charId] : null; });
  }

  function unitOptions() {
    var units = {};
    ['A', 'B'].forEach(function (side) {
      store.teams[side].forEach(function (e, i) {
        if (!e) return;
        var cfg = cfgOf(e) || {};
        var skills = cfg.skillLevels || {};
        var st = Object.assign({}, cfg.stats || {});
        st.level = levelForEntry(e, side);
        units[side + '|' + i] = {
          stats: st,
          cube: (cfg.stats && cfg.stats.cube) || null,
          quantumCube: !!(cfg.stats && cfg.stats.cube && cfg.stats.cube.id === 'quantum'),
          chargeSpeed: (cfg.stats && cfg.stats.overload && cfg.stats.overload.chargeSpeed) || 0,
          skillScale: {
            skill1: window.Stats.skillScale(skills.skill1 || 10),
            skill2: window.Stats.skillScale(skills.skill2 || 10),
            burst: window.Stats.skillScale(skills.burst || 10)
          }
        };
      });
    });
    return units;
  }

  function runSim() {
    var A = teamsToChars('A');
    var B = teamsToChars('B');
    if (!A.filter(Boolean).length || !B.filter(Boolean).length) {
      store.result = null; store.sample = null;
      renderVerdict(); drawTimeline(); renderBoard('A'); renderBoard('B');
      return;
    }

    var mode = MODE[store.mode];
    // チャンピオンアリーナは両者とも同じ隊列なので、参照実装の 'c' モードを使う
    var opts = { units: unitOptions(), arenaMode: store.mode === 'champion' ? 'c' : 'normal' };
    if (mode.cpPenalty) {
      opts.cpPenalty = { A: totalCp(store.teams.A), B: totalCp(store.teams.B) };
    }

    var r;
    try {
      r = window.Engine.runMany(A, B, opts, LOW_POWER ? Math.min(24, mode.trials) : mode.trials);
    } catch (e) {
      console.error(e);
      store.result = null; store.sample = null;
      renderVerdict('計算できませんでした');
      drawTimeline();
      return;
    }
    if (r.error) {
      store.result = null; store.sample = null;
      renderVerdict(r.error); drawTimeline(); return;
    }
    store.result = r;
    store.sample = r.sample;
    store.frame = Math.min(store.frame, r.sample.frames);
    renderVerdict();
    renderEvents();
    drawTimeline();
    renderBoard('A'); renderBoard('B');
    updateReadout();
  }

  /* -------------------------------------------------------------- verdict */
  function renderVerdict(overrideText) {
    var v = $('#verdict');
    v.className = 'verdict';

    if (overrideText) {
      v.classList.add('idle');
      v.innerHTML = '';
      v.appendChild(el('span', 'vl', '—'));
      v.appendChild(el('span', 'vm', overrideText));
      return;
    }
    if (!store.result) {
      v.classList.add('idle');
      v.innerHTML = '';
      v.appendChild(el('span', 'vl', 'STANDBY'));
      v.appendChild(el('span', 'vm', '編成を組むと 5 対 5 を試算します'));
      return;
    }

    var r = store.result;
    var pct = Math.round(r.winRate * 100);
    var win = pct >= 50;
    v.classList.add(win ? 'win' : 'lose');
    v.innerHTML = '';

    v.appendChild(el('span', 'vl', win ? 'WIN' : 'LOSE'));

    var stats = el('div', 'vstats');
    function f(k, val) {
      var d = el('div', 'vf');
      d.appendChild(el('span', 'vk', k));
      d.appendChild(el('span', 'vv', String(val)));
      stats.appendChild(d);
    }
    f('勝率', pct + '%');
    if (r.sample) f('残存', r.sample.survivors.A + ' — ' + r.sample.survivors.B);
    f('決着', (r.medianFrames / 60).toFixed(1) + '秒');
    var first = r.sample ? r.sample.bursts.filter(function (b) { return b.stage === 'B3'; })[0] : null;
    if (first) f('初回FB', (first.frame / 60).toFixed(2) + '秒');
    v.appendChild(stats);

    var bar = el('span', 'vbar');
    var fill = el('span', 'vfill');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    v.appendChild(bar);
  }

  /* 過去の大会記録から推定した「その編成が勝ちやすいか」.
   * シミュレーションとは別物で、理由の説明はできない。 */
  /* --------------------------------------------------------------- events */
  function renderEvents() {
    var host = $('#eventlist');
    host.innerHTML = '';
    if (!store.sample) return;
    var evs = [];
    store.sample.bursts.forEach(function (b) {
      evs.push({ frame: b.frame, kind: 'burst', side: b.side, text: b.name + ' ' + b.stage });
    });
    store.sample.events.forEach(function (e) {
      if (e.kind === 'death') {
        evs.push({
          frame: e.frame, kind: 'death', side: e.side,
          text: (e.killer ? e.killer + ' ▸ ' : '') + e.unit + ' 撃破'
        });
      }
      else if (e.kind === 'timeout') evs.push({ frame: e.frame, kind: 'fb', side: 'A', text: '時間切れ' });
    });
    evs.sort(function (a, b) { return a.frame - b.frame; });
    evs.forEach(function (e) {
      var row = el('div', 'evrow side' + e.side + ' ' + e.kind);
      row.appendChild(el('span', 't', (e.frame / 60).toFixed(2)));
      row.appendChild(el('span', 'who', e.text));
      row.addEventListener('click', function () {
        store.frame = e.frame; store.playing = false;
        drawTimeline(); renderBoard('A'); renderBoard('B'); updateReadout();
      });
      host.appendChild(row);
    });
  }

  /* ------------------------------------------------------------- timeline */
  var canvas = null, ctx2d = null, dpr = 1;

  function resizeCanvas() {
    if (!canvas) return;
    var box = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = Math.max(1, Math.round(box.height * dpr));
  }

  function timeWindow() {
    var maxT = store.sample ? Math.max(60, store.sample.frames) : 60 * 20;
    var visible = maxT / store.zoom;
    var start = store.pan * Math.max(0, maxT - visible);
    return { start: start, end: start + visible, max: maxT };
  }

  function coverAt(unit, frame) {
    var s = unit.hpSeries || [[0, unit.hp, unit.coverHp]];
    if (frame <= s[0][0]) return s[0][2] || 0;
    for (var i = 1; i < s.length; i++) {
      if (s[i][0] >= frame) {
        var a = s[i - 1], b = s[i];
        var t = (frame - a[0]) / Math.max(1, b[0] - a[0]);
        var av = a[2] == null ? 0 : a[2], bv = b[2] == null ? 0 : b[2];
        return av + (bv - av) * t;
      }
    }
    return s[s.length - 1][2] || 0;
  }

  function hpAt(unit, frame) {
    var s = unit.hpSeries || [[0, unit.hpMax]];
    if (frame <= s[0][0]) return s[0][1];
    for (var i = 1; i < s.length; i++) {
      if (s[i][0] >= frame) {
        var a = s[i - 1], b = s[i];
        var t = (frame - a[0]) / Math.max(1, b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * t;
      }
    }
    return s[s.length - 1][1];
  }

  /* タイムラインの配色。css/style.css の変数と揃える。 */
  var PAL = {
    a: '#3eafff', aSoft: '#cfe8ff',
    b: '#ff6b4a', bSoft: '#ffd2c7',
    grid: 'rgba(255,255,255,.05)',
    axis: '#5f7691',
    text: '#8b9bb0',
    death: '#f53636',
    plate: '#070a10'
  };

  function drawTimeline() {
    if (!canvas) return;
    var w = canvas.width / dpr, h = canvas.height / dpr;
    var g = ctx2d;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    var padL = 10, padR = 10, padT = 10, padB = 16;
    var plotW = w - padL - padR;

    if (!store.sample) {
      g.fillStyle = PAL.text;
      g.font = '12px "Yu Gothic UI", system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('編成を組むとタイムラインが表示されます', w / 2, h / 2);
      return;
    }

    var win = timeWindow();
    var span = Math.max(1, win.end - win.start);
    function xOf(frame) { return padL + (frame - win.start) / span * plotW; }

    var stepSec = span / 60 > 25 ? 10 : span / 60 > 9 ? 5 : span / 60 > 3.5 ? 2 : 1;
    g.strokeStyle = 'rgba(255,255,255,.05)';
    g.fillStyle = PAL.axis;
    g.font = '10px system-ui, sans-serif';
    g.textAlign = 'center';
    var startSec = Math.ceil(win.start / 60 / stepSec) * stepSec;
    for (var s = startSec; s * 60 <= win.end; s += stepSec) {
      var x = xOf(s * 60);
      if (x < padL || x > w - padR) continue;
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, h - padB); g.stroke();
      g.fillText(s + 's', x, h - 4);
    }

    if (store.expanded) {
      var iconsH = 38;
      var gaugeH = 30;
      var teamH = Math.max(50, (h - padT - padB - iconsH - gaugeH) * 0.34);
      drawTeamCurves(g, xOf, padL, padT, plotW, teamH, win);
      drawBurstIcons(g, xOf, padL, padT + teamH + 2, plotW, iconsH);
      drawGauge(g, xOf, padL, padT + teamH + iconsH + 2, plotW, gaugeH, win);
      var lanesTop = padT + teamH + iconsH + gaugeH + 10;
      var laneH = (h - padB - lanesTop) / 10;
      drawLanes(g, xOf, padL, lanesTop, plotW, laneH, win);
    } else {
      drawTeamCurves(g, xOf, padL, padT, plotW, h - padT - padB - 8, win);
      drawBurstTicks(g, xOf, padL, h - padB - 8, plotW);
    }

    // バーストした瞬間に縦線を引く
    g.save();
    g.beginPath();
    g.rect(padL, padT, plotW, h - padT - padB);
    g.clip();
    store.sample.bursts.forEach(function (b) {
      var bx = xOf(b.frame);
      if (bx < padL || bx > w - padR) return;
      var col = b.side === 'A' ? 'rgba(61,219,180,' : 'rgba(247,162,76,';
      g.strokeStyle = col + (b.stage === 'B3' ? '.75)' : '.45)');
      g.lineWidth = b.stage === 'B3' ? 2 : 1.4;
      g.beginPath();
      g.moveTo(bx, padT);
      g.lineTo(bx, h - padB);
      g.stroke();
      g.fillStyle = col + '.85)';
      g.font = '9px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(b.stage.replace('B', ''), bx, padT + 9);
    });
    g.restore();

    var px = xOf(store.frame);
    if (px >= padL && px <= w - padR) {
      g.strokeStyle = 'rgba(255,255,255,.72)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(px, padT); g.lineTo(px, h - padB); g.stroke();
    }
  }

  function gaugeAt(series, frame) {
    if (!series || !series.length) return 0;
    for (var i = 1; i < series.length; i++) {
      if (series[i][0] >= frame) return series[i][1];
    }
    return series[series.length - 1][1];
  }

  function drawGauge(g, xOf, x0, y0, w, h, win) {
    var s = store.sample;
    if (!s.gauge) return;
    var rowH = Math.max(6, (h - 4) / 2);
    ['A', 'B'].forEach(function (side, idx) {
      var series = s.gauge[side];
      var color = side === 'A' ? PAL.a : PAL.b;
      var baseY = y0 + idx * (rowH + 4);
      g.fillStyle = 'rgba(255,255,255,.05)';
      g.fillRect(x0, baseY, w, rowH);
      g.fillStyle = color + '99';
      var last = x0;
      var n = s.frames || 1;
      for (var f = 0; f <= n; f += 2) {
        var v = Math.max(0, Math.min(100, gaugeAt(series, f))) / 100;
        var x1 = xOf(f);
        if (x1 > last) {
          g.fillRect(last, baseY + rowH * (1 - v), x1 - last, rowH * v);
          last = x1;
        }
      }
      g.fillStyle = color;
      g.font = '9px system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillStyle = color;
      g.font = '9px system-ui, sans-serif';
      g.textAlign = 'left';
      var cur = Math.round(gaugeAt(series, store.frame));
      g.fillText((side === 'A' ? '自' : '相') + ' ゲージ ' + cur + '%', x0 + 3, baseY - 2);
    });
  }

  /* 中央線を挟んで、自チームは上・相手は下に伸びる「蝶」型。
   * 2本の曲線の距離が、そのまま優勢差になる。 */
  function drawTeamCurves(g, xOf, x0, y0, w, h, win) {
    var s = store.sample;
    var mid = y0 + h / 2;
    var half = Math.max(6, h / 2 - 4);

    g.strokeStyle = 'rgba(255,255,255,.055)';
    g.lineWidth = 1;
    [0.25, 0.75].forEach(function (v) {
      var y = Math.round(y0 + h * v) + .5;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + w, y); g.stroke();
    });

    g.strokeStyle = 'rgba(255,255,255,.16)';
    g.beginPath();
    g.moveTo(x0, Math.round(mid) + .5);
    g.lineTo(x0 + w, Math.round(mid) + .5);
    g.stroke();

    g.save();
    g.beginPath();
    g.rect(x0, y0 - 2, w, h + 4);
    g.clip();

    ['A', 'B'].forEach(function (side) {
      var team = s.teams[side];
      var color = side === 'A' ? PAL.a : PAL.b;
      var n = s.frames || 1;
      var pts = [];
      for (var f = 0; f <= n; f += 2) {
        var total = 0, max = 0;
        for (var i = 0; i < team.length; i++) {
          total += Math.max(0, hpAt(team[i], f));
          max += team[i].hpMax;
        }
        var r = max ? total / max : 0;
        pts.push([xOf(f), side === 'A' ? mid - half * r : mid + half * r]);
      }

      g.beginPath();
      g.moveTo(pts[0][0], mid);
      pts.forEach(function (p) { g.lineTo(p[0], p[1]); });
      g.lineTo(pts[pts.length - 1][0], mid);
      g.closePath();
      var grad = g.createLinearGradient(0, mid, 0, side === 'A' ? mid - half : mid + half);
      grad.addColorStop(0, color + '05');
      grad.addColorStop(1, color + '33');
      g.fillStyle = grad;
      g.fill();

      g.beginPath();
      pts.forEach(function (p, i) { if (i === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]); });
      g.strokeStyle = color;
      g.lineWidth = 1.6;
      g.stroke();

      var cur = pts.filter(function (p) { return p[0] <= xOf(store.frame); }).pop() || pts[0];
      var ratio = Math.abs(cur[1] - mid) / half;
      g.fillStyle = color;
      g.font = '700 11px "Chakra Petch", system-ui, sans-serif';
      g.textAlign = side === 'A' ? 'left' : 'right';
      g.fillText((side === 'A' ? '自 ' : '相 ') + Math.round(ratio * 100) + '%',
        side === 'A' ? x0 + 4 : x0 + w - 4, side === 'A' ? y0 + 11 : y0 + h - 4);
    });
    g.restore();
  }

  function drawBurstTicks(g, xOf, x0, y, w) {
    var s = store.sample;
    s.bursts.forEach(function (b) {
      var x = xOf(b.frame);
      if (x < x0 || x > x0 + w) return;
      var color = b.side === 'A' ? PAL.a : PAL.b;
      g.fillStyle = color;
      var tall = b.stage === 'B3' ? 7 : 4;
      g.fillRect(x - 1, y + (7 - tall), 2, tall);
    });
  }

  function drawBurstIcons(g, xOf, x0, y0, w, h) {
    var s = store.sample;
    var size = 16;
    s.bursts.forEach(function (b) {
      var x = xOf(b.frame);
      if (x < x0 || x > x0 + w) return;
      var team = s.teams[b.side];
      var u = team.filter(function (uu) { return uu.name === b.name; })[0];
      var color = b.side === 'A' ? PAL.a : PAL.b;
      var y = y0 + (b.stage === 'B1' ? 2 : b.stage === 'B2' ? size + 3 : 0);
      if (b.stage === 'B3') y = y0 + 2;
      var img = u ? imageFor(u.char.id) : null;
      g.save();
      g.beginPath();
      if (g.roundRect) g.roundRect(x - size / 2, y, size, size, 3); else g.rect(x - size / 2, y, size, size);
      g.fillStyle = color + '33';
      g.fill();
      g.clip();
      if (img && img.complete && img.naturalWidth) {
        g.drawImage(img, x - size / 2, y, size, size);
      }
      g.restore();

      g.strokeStyle = color;
      g.lineWidth = 1.2;
      g.beginPath();
      if (g.roundRect) g.roundRect(x - size / 2, y, size, size, 3); else g.rect(x - size / 2, y, size, size);
      g.stroke();

      g.fillStyle = PAL.plate;
      g.fillRect(x - 5, y + size - 8, 10, 8);
      g.fillStyle = color;
      g.font = 'bold 8px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(b.stage.replace('B', ''), x, y + size - 1);
    });
  }

  function drawLanes(g, xOf, x0, y0, w, laneH, win) {
    var s = store.sample;
    var gutter = 74;
    var bx = x0 + gutter;
    var bw = Math.max(20, w - gutter);
    var rows = [];
    for (var r = 0; r < 5; r++) {
      rows.push({ side: 'A', u: s.teams.A[r], i: r });
      rows.push({ side: 'B', u: s.teams.B[r], i: r });
    }

    g.save();
    g.beginPath();
    g.rect(x0, y0 - 4, w, laneH * rows.length + 8);
    g.clip();

    rows.forEach(function (row, idx) {
      var top = y0 + idx * laneH;
      var u = row.u;
      if (!u) return;
      var color = row.side === 'A' ? PAL.a : PAL.b;
      var barH = Math.max(5, laneH * 0.52);
      var barY = top + (laneH - barH) / 2;

      g.fillStyle = 'rgba(255,255,255,.03)';
      g.fillRect(bx, barY, bw, barH);

      var n = s.frames || 1;
      g.fillStyle = color + 'cc';
      var last = bx;
      for (var f = 0; f <= n; f += 2) {
        var v = Math.max(0, hpAt(u, f)) / u.hpMax;
        var x1 = bx + (xOf(f) - x0) / w * bw;
        g.fillRect(last, barY + barH * (1 - v), Math.max(0, x1 - last), barH * v);
        last = x1;
      }

      // 遮蔽物を上に細く重ねる（本体HPとは別枠）
      var covColor = row.side === 'A' ? PAL.a : PAL.b;
      g.fillStyle = covColor + '3a';
      var lastC = bx;
      for (var cf = 0; cf <= n; cf += 2) {
        var cv = Math.max(0, coverAt(u, cf)) / (u.coverMax || 1);
        var cx = bx + (xOf(cf) - x0) / w * bw;
        g.fillRect(lastC, barY - 4, Math.max(0, cx - lastC), 3 * cv);
        lastC = cx;
      }

      g.fillStyle = row.side === 'A' ? PAL.aSoft : PAL.bSoft;
      g.font = '10px "Yu Gothic UI", system-ui, sans-serif';
      g.textAlign = 'right';
      var label = u.name.length > 6 ? u.name.slice(0, 6) : u.name;
      g.fillText(label, x0 + gutter - 8, top + laneH / 2 + 3.5);

      g.fillStyle = color + '88';
      g.font = '9px "Inter", system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillText('P' + (row.i + 1), x0 + 2, top + laneH / 2 + 3);

      if (u.deathFrame >= 0) {
        var dx = bx + (xOf(u.deathFrame) - x0) / w * bw;
        if (dx >= bx && dx <= bx + bw) {
          g.strokeStyle = PAL.death; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(dx, barY - 1); g.lineTo(dx, barY + barH + 1); g.stroke();
        }
      }
    });
    g.restore();
  }

  var images = {};
  function imageFor(id) {
    if (images[id] !== undefined) return images[id];
    var c = BY_ID[id];
    var p = portraitOf(c);
    if (!p) { images[id] = null; return null; }
    var im = new Image();
    im.onload = function () { drawTimeline(); };
    im.src = p;
    images[id] = im;
    return im;
  }

  /* ------------------------------------------------------------ transport */
  var playRaf = null, lastTs = 0;

  function setupTransport() {
    $('#playBtn').onclick = togglePlay;
    $('#toStart').onclick = function () {
      store.frame = 0; drawTimeline(); renderBoard('A'); renderBoard('B'); updateReadout();
    };
    $('#speed').onchange = function () { store.speed = parseFloat($('#speed').value); };
    var scrub = $('#scrub');
    scrub.step = '1';
    scrub.addEventListener('input', function () {
      store.playing = false;
      $('#playBtn').textContent = '▶';
      // 拡大しているときは、スライダーは「見えている範囲」を動く。
      // 全体を映しているときだけ試合全体を動かす。
      var w = timeWindow();
      var f = Math.round(w.start + (scrub.value / 1000) * (w.end - w.start));
      store.frame = Math.max(0, Math.min(store.sample ? store.sample.frames : 0, f));
      drawTimeline(); renderBoard('A'); renderBoard('B'); updateReadout();
    });
  }

  function togglePlay() {
    if (!store.sample) return;
    store.playing = !store.playing;
    $('#playBtn').textContent = store.playing ? '❚❚' : '▶';
    if (store.playing) {
      if (store.frame >= store.sample.frames) store.frame = 0;
      lastTs = performance.now();
      playRaf = requestAnimationFrame(stepPlay);
    } else if (playRaf) {
      cancelAnimationFrame(playRaf); playRaf = null;
    }
  }

  function stepPlay(ts) {
    if (!store.playing || !store.sample) return;
    var dt = (ts - lastTs) / 1000;
    lastTs = ts;
    store.frame += dt * 60 * store.speed;
    if (store.frame >= store.sample.frames) {
      store.frame = store.sample.frames;
      store.playing = false;
      $('#playBtn').textContent = '▶';
    }
    drawTimeline(); updateReadout(); updateHpBars('A'); updateHpBars('B');
    if (store.playing) playRaf = requestAnimationFrame(stepPlay);
  }

  function updateReadout() {
    var f = Math.round(store.frame);
    $('#rdT').textContent = (f / 60).toFixed(2);
    $('#rdF').textContent = f;
    var scrub = $('#scrub');
    if (document.activeElement === scrub) return;
    var w = timeWindow();
    var span = Math.max(1, w.end - w.start);
    scrub.value = Math.max(0, Math.min(1000, (f - w.start) / span * 1000));
  }

  /* ------------------------------------------------------------------ stage */
  function setZoom(z) {
    store.zoom = Math.max(1, Math.min(20, z));
    $('#zoomLabel').textContent = store.zoom.toFixed(1) + '×';
    drawTimeline();
    updateReadout();
  }

  function setupStage() {
    $('#expandBtn').onclick = function () {
      store.expanded = !store.expanded;
      var stage = $('#stage');
      stage.classList.toggle('open', store.expanded);
      $('#expandBtn').setAttribute('aria-expanded', String(store.expanded));
      $('#expandBtn').querySelector('.expandlabel').textContent =
        store.expanded ? 'タイムラインを閉じる' : 'タイムラインを開く';
      $('#stageHint').textContent = store.expanded ? 'キャラごとのHPとバースト' : 'チームの残りHP';
      $('#eventpane').hidden = !store.expanded;
      requestAnimationFrame(function () { resizeCanvas(); drawTimeline(); });
    };
    $('#zoomIn').onclick = function () { setZoom(store.zoom * 1.5); };
    $('#zoomOut').onclick = function () { setZoom(store.zoom / 1.5); };
    $('#zoomFit').onclick = function () { store.pan = 0; setZoom(1); };

    var wrap = document.querySelector('.canvaswrap');
    wrap.addEventListener('wheel', function (ev) {
      if (!store.sample) return;
      ev.preventDefault();
      var rect = canvas.getBoundingClientRect();
      var rel = (ev.clientX - rect.left) / rect.width;
      var before = timeWindow();
      var focusFrame = before.start + (before.end - before.start) * rel;
      var factor = ev.deltaY < 0 ? 1.18 : 1 / 1.18;
      var newZoom = Math.max(1, Math.min(20, store.zoom * factor));
      var maxT = Math.max(60, store.sample.frames);
      var visible = maxT / newZoom;
      var start = Math.max(0, Math.min(maxT - visible, focusFrame - visible * rel));
      store.zoom = newZoom;
      store.pan = maxT - visible > 0 ? start / (maxT - visible) : 0;
      $('#zoomLabel').textContent = store.zoom.toFixed(1) + '×';
      drawTimeline();
      updateReadout();
    }, { passive: false });

    var dragging = false;
    canvas.addEventListener('pointerdown', function (ev) {
      dragging = true;
      canvas.setPointerCapture(ev.pointerId);
      scrubTo(ev);
    });
    canvas.addEventListener('pointermove', function (ev) { if (dragging) scrubTo(ev); });
    canvas.addEventListener('pointerup', function () { dragging = false; });

    function scrubTo(ev) {
      if (!store.sample) return;
      var rect = canvas.getBoundingClientRect();
      var rel = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      var win = timeWindow();
      store.frame = Math.round(win.start + (win.end - win.start) * rel);
      store.playing = false;
      $('#playBtn').textContent = '▶';
      drawTimeline(); renderBoard('A'); renderBoard('B'); updateReadout();
    }
  }

  /* ------------------------------------------------------------------ misc */
  function renderModeHint() {
    var el2 = document.querySelector('#modeHint');
    if (!el2) return;
    el2.textContent = {
      champion: '全員Lv400固定 ・ 戦闘力補正なし',
      rookie: '実際のレベル ・ 戦闘力補正あり',
      special: '実際のレベル ・ 編成ごとに戦闘力補正'
    }[store.mode] || '';
  }

  function syncEditSeg() {
    document.querySelectorAll('#editSeg .seg').forEach(function (b) {
      b.classList.toggle('on', b.dataset.side === store.editSide);
    });
  }

  function renderAll() {
    renderBoard('A'); renderBoard('B');
    renderRoster();
    updateReadout();
  }

  /* 編成が変わっただけのときは、名簿を作り直さずクラスだけ付け替える。
   * 223枚のDOMを作り直すのが重いので、スマホでの引っかかりを減らす。 */
  function renderAllLight() {
    renderBoard('A'); renderBoard('B');
    updateRosterState();
    updateReadout();
  }

  function updateRosterState() {
    var cards = document.querySelectorAll('#roster .card');
    if (!cards.length) { renderRoster(); return; }
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var id = parseInt(card.dataset.charId, 10);
      var where = inTeam(id);
      card.classList.toggle('inA', where === 'A');
      card.classList.toggle('inB', where === 'B');
      var used = card.querySelector('.used');
      if (where && !used) card.appendChild(el('div', 'used'));
      else if (!where && used && used.parentNode) used.parentNode.removeChild(used);
    }
  }

  function setupFilters() {
    document.querySelectorAll('.fchip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var key = chip.dataset.filter, val = chip.dataset.value;
        store.filters[key][val] = !store.filters[key][val];
        chip.classList.toggle('on', store.filters[key][val]);
        renderRoster();
      });
    });

    $('#search').addEventListener('input', function (e) { store.search = e.target.value; renderRoster(); });

    $('#ownedOnly').addEventListener('click', function () {
      store.ownedOnly = !store.ownedOnly;
      $('#ownedOnly').classList.toggle('on', store.ownedOnly);
      renderRoster();
    });

    $('#sortBy').addEventListener('change', function (e) { store.sort = e.target.value; renderRoster(); });


    document.querySelectorAll('#editSeg .seg').forEach(function (b) {
      b.addEventListener('click', function () {
        store.editSide = b.dataset.side;
        syncEditSeg();
        var idx = firstEmpty(b.dataset.side);
        store.selected = { side: b.dataset.side, index: idx >= 0 ? idx : 0 };
        renderBoard('A'); renderBoard('B');
      });
    });

    document.querySelectorAll('#modes .mode').forEach(function (b) {
      b.addEventListener('click', function () {
        store.mode = b.dataset.mode;
        document.querySelectorAll('#modes .mode').forEach(function (x) { x.classList.toggle('on', x === b); });
        if (MODE[store.mode].levelLocked) {
          ['A', 'B'].forEach(function (side) {
            store.teams[side].forEach(function (e) {
              if (e && e.cfg && e.cfg.stats) e.cfg.stats.level = 400;
            });
          });
        }
        persist();
        renderModeHint();
        renderAll();
        scheduleSim();
      });
    });
  }

  function setupModals() {
    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { $('#' + b.dataset.close).hidden = true; });
    });
    document.querySelectorAll('.modal').forEach(function (m) {
      m.addEventListener('click', function (ev) { if (ev.target === m) m.hidden = true; });
    });
    $('#helpBtn').onclick = function () {
      $('#helpBody').innerHTML = window.DOCS.help;
      $('#helpSheet').hidden = false;
    };
    $('#notesBtn').onclick = function () {
      $('#notesBody').innerHTML = window.DOCS.notes;
      $('#notesSheet').hidden = false;
    };
    $('#syncBtn').onclick = function () { window.SyncUI && window.SyncUI.open(); };

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(function (m) { m.hidden = true; });
      }
      var tag = document.activeElement.tagName;
      if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && !/input|textarea|select/i.test(tag) && store.sample) {
        ev.preventDefault();
        var step = ev.shiftKey ? 10 : 1;
        store.frame = Math.max(0, Math.min(store.sample.frames, store.frame + (ev.key === 'ArrowRight' ? step : -step)));
        store.playing = false;
        $('#playBtn').textContent = '▶';
        drawTimeline(); renderBoard('A'); renderBoard('B'); updateReadout();
        return;
      }
      if (ev.code === 'Space' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
        ev.preventDefault();
        togglePlay();
      }
    });
  }

  /* ------------------------------------------------------------------ init */
  function init() {
    canvas = $('#tl');
    ctx2d = canvas.getContext('2d');
    resizeCanvas();

    setupFilters();
    setupTransport();
    setupStage();
    setupModals();
    renderPartySelects();

    try {
      var sync = JSON.parse(localStorage.getItem('nikesmi.sync.v1') || 'null');
      if (sync) {
        store.sync = sync;
        /* 前回の続きから始めるときも、編成に残っているキャラへ
         * 取り込み済みの育成状況を配り直す。 */
        ['A', 'B'].forEach(function (side) {
          store.teams[side].forEach(function (e) {
            if (!e) return;
            var cfg = sync.chars && sync.chars[String(e.charId)];
            if (cfg) e.cfg = cfg;
          });
        });
      }
    } catch (e) { /* ignore */ }

    document.querySelectorAll('#modes .mode').forEach(function (x) {
      x.classList.toggle('on', x.dataset.mode === store.mode);
    });

    syncEditSeg();
    renderModeHint();
    renderAll();
    setZoom(1);
    runSim();

    new ResizeObserver(function () { resizeCanvas(); drawTimeline(); }).observe(document.querySelector('.canvaswrap'));
    window.addEventListener('resize', function () { resizeCanvas(); drawTimeline(); });
    document.addEventListener('dragend', function () {
      document.querySelectorAll('.slot.dragover').forEach(function (s) { s.classList.remove('dragover'); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.Nikesmi = {
    store: store,
    rerender: function () { renderAll(); scheduleSim(); },
    setSync: function (data) {
      store.sync = data;
      try { localStorage.setItem('nikesmi.sync.v1', JSON.stringify(data)); } catch (e) {}

      // 取り込んだキャラのレベルをチームレベルに反映する（いちばん多いレベル）
      var counts = {};
      Object.keys(data.chars || {}).forEach(function (id) {
        var lv = data.chars[id] && data.chars[id].stats && data.chars[id].stats.level;
        if (lv > 0) counts[lv] = (counts[lv] || 0) + 1;
      });
      var best = 0, bestN = 0;
      Object.keys(counts).forEach(function (lv) {
        if (counts[lv] > bestN) { bestN = counts[lv]; best = Number(lv); }
      });
      if (best > 0) {
        store.teamLevel.A = best;
        store.teamLevel.B = best;
        persist();
      }

      /* 取り込み前に編成へ入れたキャラにも、取り込んだ育成状況を反映する。
       * ここを飛ばすと、画面の戦闘力が既定値のまま取り残される。 */
      ['A', 'B'].forEach(function (side) {
        store.teams[side].forEach(function (e) {
          if (!e) return;
          var cfg = data.chars && data.chars[String(e.charId)];
          if (cfg) e.cfg = cfg;
        });
      });
      /* 編集中のシートは中身が古くなるので閉じる */
      if (editing) { editing = null; $('#unitSheet').hidden = true; }
      cpCache = {};
      renderAll();
      window.Parties && renderPartySelects();
      scheduleSim();
    }
  };
})();
