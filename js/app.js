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
  var store = {
    mode: 'champion',
    teams: { A: [null, null, null, null, null], B: [null, null, null, null, null] },
    editSide: 'A',
    selected: { side: 'A', index: 0 },
    search: '',
    filters: { burst: {}, element: {}, classType: {} },
    ownedOnly: false,
    liveCorrection: false,
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
    }
  } catch (e) { /* ignore */ }

  function persist() {
    try {
      localStorage.setItem('nikesmi.ui.v2', JSON.stringify({
        teams: store.teams, mode: store.mode
      }));
    } catch (e) { /* quota */ }
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

  function statsOf(entry) {
    var c = BY_ID[entry.charId];
    if (!c) return null;
    var cfg = cfgOf(entry) || {};
    var s = Object.assign({}, cfg.stats || {});
    if (MODE[store.mode].levelLocked) s.level = 400;
    return window.Stats.compute(c, s);
  }

  function cpOf(entry) {
    var c = BY_ID[entry.charId];
    var cfg = cfgOf(entry) || {};
    var s = Object.assign({}, cfg.stats || {});
    if (MODE[store.mode].levelLocked) s.level = 400;
    var st = window.Stats.compute(c, s);
    return window.Stats.combatPower(st, s, cfg.skillLevels || {});
  }

  function totalCp(team) {
    var t = 0;
    team.forEach(function (e) { if (e) t += cpOf(e); });
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
        case 'atk': return statsOf({ charId: b.id }).atk - statsOf({ charId: a.id }).atk;
        case 'hp': return statsOf({ charId: b.id }).hp - statsOf({ charId: a.id }).hp;
        default: return cpOf({ charId: b.id }) - cpOf({ charId: a.id });
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
    var list = rosterList();
    $('#count').textContent = list.length + '体';

    if (!list.length) {
      host.appendChild(el('div', 'roster-empty', '条件に合うキャラがいません'));
      return;
    }

    var frag = document.createDocumentFragment();
    list.forEach(function (c) {
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

      thumb.appendChild(el('span', 'badgeB', burstStages(c)[0] || ''));
      var dot = el('span', 'badgeE');
      dot.style.background = ELEMENT_COLOR[c.element] || '#888';
      thumb.appendChild(dot);
      if (c.treasure) thumb.appendChild(el('span', 'treasure', '宝物'));

      var plate = el('div', 'plate');
      plate.appendChild(el('div', 'nm', c.name));
      var clsTag = { '火力型': '火力', '防御型': '防御', '支援型': '支援' }[c.classType] || c.classType;
      var beats = ELEMENT_BEATS[c.element];
      var line = el('div', 'sub');
      line.appendChild(el('span', 'tagcls ' + c.classType.replace('型', ''), clsTag));
      var advSpan = el('span', 'tadev', '→' + (beats || '—'));
      advSpan.style.color = ELEMENT_COLOR[beats] || '#888';
      advSpan.title = c.element + ' は ' + (beats || '—') + ' に有利';
      line.appendChild(advSpan);
      line.appendChild(el('span', 'tacp', Math.round(cpOf({ charId: c.id }) / 100) / 10 + 'k'));
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
      card.addEventListener('click', function (ev) {
        if (longPressed) { longPressed = false; ev.preventDefault(); return; }
        placeChar(c.id);
      });
      card.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.setData('text/plain', String(c.id));
        ev.dataTransfer.effectAllowed = 'copy';
        card.style.opacity = '.45';
      });
      card.addEventListener('dragend', function () { card.style.opacity = ''; });

      frag.appendChild(card);
    });
    host.appendChild(frag);
  }

  /* ------------------------------------------------------------------ board */
  function renderBoard(side) {
    var host = $('#slots' + side);
    host.innerHTML = '';
    for (var i = 0; i < 5; i++) host.appendChild(makeSlot(side, i));
    var cp = totalCp(store.teams[side]);
    $('#meta' + side).textContent = cp ? Math.round(cp / 1000) + 'k' : '';
  }

  function makeSlot(side, index) {
    var entry = store.teams[side][index];
    var slot = el('div', 'slot');
    slot.dataset.side = side;
    slot.dataset.index = String(index);

    if (store.selected.side === side && store.selected.index === index) slot.classList.add('selected');

    if (!entry) {
      slot.classList.add('empty');
      slot.appendChild(el('span', 'plus', '＋'));
      slot.appendChild(el('span', 'pnum', 'P' + (index + 1)));
    } else {
      var c = BY_ID[entry.charId];
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
          var wrap = el('div', 'hpwrap');
          var fill = el('span', 'hpfill');
          var hp = hpAt(u, store.frame);
          var pct = Math.max(0, Math.min(1, hp / u.hpMax));
          fill.style.width = (pct * 100) + '%';
          wrap.appendChild(fill);
          slot.appendChild(wrap);
        }
      }
    }

    slot.addEventListener('click', function (ev) {
      if (ev.target.closest('.gear')) return;
      store.selected = { side: side, index: index };
      store.editSide = side;
      syncEditSeg();
      renderBoard('A'); renderBoard('B');
    });
    slot.addEventListener('dragover', function (ev) { ev.preventDefault(); slot.classList.add('dragover'); });
    slot.addEventListener('dragleave', function () { slot.classList.remove('dragover'); });
    slot.addEventListener('drop', function (ev) {
      ev.preventDefault();
      slot.classList.remove('dragover');
      var id = parseInt(ev.dataTransfer.getData('text/plain'), 10);
      if (id) placeCharAt(side, index, id);
    });

    return slot;
  }

  /* --------------------------------------------------------------- placing */
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
    renderAll();
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
          return u && u.charId ? { charId: u.charId, cfg: u.cfg || null } : null;
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
    inp.addEventListener('change', function () {
      var v = parseFloat(inp.value);
      if (!isFinite(v)) v = value;
      v = Math.max(min, Math.min(max, v));
      inp.value = v;
      onChange(v);
      onEdited();
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
    var lvField = numField('レベル', s.level == null ? 400 : s.level, 1, 400, 1, function (v) {
      s.level = mode.levelLocked ? 400 : v;
    });
    if (mode.levelLocked) {
      lvField.querySelector('input').disabled = true;
      lvField.querySelector('input').value = 400;
      lvField.title = 'チャンピオンアリーナは全員Lv400固定です';
    }
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
    g2.appendChild(el('h4', null, '装備・魔方・コレクション'));
    g2.appendChild(selectField('装備強化', s.equipLevel == null ? 5 : s.equipLevel,
      [0, 1, 2, 3, 4, 5].map(function (v) { return { value: v, label: 'T10 +' + v }; }),
      function (v) { s.equipLevel = +v; }));
    g2.appendChild(numField('魔方 Lv', s.cubeLevel == null ? 10 : s.cubeLevel, 0, 15, 1, function (v) { s.cubeLevel = v; }));
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
    var st = statsOf(entry);
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
    simTimer = setTimeout(runSim, 140);
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
        units[side + '|' + i] = {
          stats: cfg.stats || null,
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
    var opts = { units: unitOptions() };
    if (mode.cpPenalty) {
      opts.cpPenalty = { A: totalCp(store.teams.A), B: totalCp(store.teams.B) };
    }

    var r;
    try {
      r = window.Engine.runMany(A, B, opts, mode.trials);
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
    var facts = $('#facts');
    facts.innerHTML = '';
    v.className = 'verdict';

    if (overrideText) { v.classList.add('idle'); v.textContent = overrideText; return; }
    if (!store.result) {
      v.classList.add('idle');
      v.textContent = '編成を組みましょう';
      return;
    }
    var r = store.result;
    var pct = Math.round(r.winRate * 100);
    var lp = store.liveCorrection ? liveProbability() : null;

    if (lp != null) {
      var lpc = Math.round(lp * 100);
      if (lpc >= 55) { v.classList.add('win'); v.textContent = '勝ち ' + lpc + '%'; }
      else if (lpc <= 45) { v.classList.add('lose'); v.textContent = '負け ' + (100 - lpc) + '%'; }
      else { v.classList.add('even'); v.textContent = '互角 ' + lpc + '%'; }
    } else if (pct >= 55) { v.classList.add('win'); v.textContent = '勝ち ' + pct + '%'; }
    else if (pct <= 45) { v.classList.add('lose'); v.textContent = '負け ' + (100 - pct) + '%'; }
    else { v.classList.add('even'); v.textContent = '互角 ' + pct + '%'; }

    function fact(k, val, small) {
      var f = el('div', 'fact');
      f.appendChild(el('div', 'k', k));
      var vv = el('div', 'v', String(val));
      if (small) vv.appendChild(el('small', null, small));
      f.appendChild(vv);
      facts.appendChild(f);
    }
    if (lp != null) fact('シミュレーション', pct + '%', ' ' + r.trials + '回試行');
    else fact('勝率', pct + '%', ' ' + r.trials + '回試行');
    fact('決着', (r.medianFrames / 60).toFixed(1), ' 秒');
    fact('残存', r.sample ? r.sample.survivors.A + ' — ' + r.sample.survivors.B : '—');
    var first = r.sample ? r.sample.bursts.filter(function (b) { return b.stage === 'B3'; })[0] : null;
    fact('初回フルバースト', first ? (first.frame / 60).toFixed(2) : '—',
      first ? ' 秒 ' + (first.side === 'A' ? '自' : '相') : '');
    var killer = r.sample ? r.sample.events.filter(function (e) { return e.kind === 'death'; })[0] : null;
    fact('初回撃破', killer ? (killer.frame / 60).toFixed(1) : '—', killer ? ' 秒 ' + killer.unit : '');

    if (lp != null) fact('実戦データ', Math.round(lp * 100) + '%', ' 過去の大会記録');
  }

  /* 過去の大会記録から推定した「その編成が勝ちやすいか」.
   * シミュレーションとは別物で、理由の説明はできない。 */
  function liveProbability() {
    var R = window.RATINGS;
    if (!R || !R.ratings) return null;
    function score(team) {
      var s = 0;
      team.forEach(function (e) {
        if (!e) return;
        var rec = R.ratings[String(e.charId)];
        if (rec) s += rec.r;
      });
      return s;
    }
    var a = score(store.teams.A), b = score(store.teams.B);
    if (!a && !b) return null;
    return 1 / (1 + Math.exp(-(a - b) / (R.scale || 4)));
  }

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
      if (e.kind === 'death') evs.push({ frame: e.frame, kind: 'death', side: e.side, text: e.unit + ' 撃破' });
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
    dpr = window.devicePixelRatio || 1;
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

  function drawTimeline() {
    if (!canvas) return;
    var w = canvas.width / dpr, h = canvas.height / dpr;
    var g = ctx2d;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    var padL = 10, padR = 10, padT = 10, padB = 16;
    var plotW = w - padL - padR;

    if (!store.sample) {
      g.fillStyle = '#6d788a';
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
    g.fillStyle = '#5c6678';
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
      var teamH = Math.max(58, (h - padT - padB - iconsH) * 0.34);
      drawTeamCurves(g, xOf, padL, padT, plotW, teamH, win);
      drawBurstIcons(g, xOf, padL, padT + teamH + 2, plotW, iconsH);
      var lanesTop = padT + teamH + iconsH + 6;
      var laneH = (h - padB - lanesTop) / 10;
      drawLanes(g, xOf, padL, lanesTop, plotW, laneH, win);
    } else {
      drawTeamCurves(g, xOf, padL, padT, plotW, h - padT - padB - 8, win);
      drawBurstTicks(g, xOf, padL, h - padB - 8, plotW);
    }

    var px = xOf(store.frame);
    if (px >= padL && px <= w - padR) {
      g.strokeStyle = 'rgba(255,255,255,.72)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(px, padT); g.lineTo(px, h - padB); g.stroke();
    }
  }

  function drawTeamCurves(g, xOf, x0, y0, w, h, win) {
    var s = store.sample;

    // horizontal guides
    g.strokeStyle = 'rgba(255,255,255,.045)';
    g.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach(function (v) {
      var y = y0 + h * (1 - v);
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + w, y); g.stroke();
    });

    g.save();
    g.beginPath();
    g.rect(x0, y0 - 2, w, h + 4);
    g.clip();

    ['A', 'B'].forEach(function (side) {
      var team = s.teams[side];
      var color = side === 'A' ? '#3ddbb4' : '#f7a24c';
      var n = s.frames || 1;
      var pts = [];
      for (var f = 0; f <= n; f += 2) {
        var total = 0, max = 0;
        for (var i = 0; i < team.length; i++) {
          total += Math.max(0, hpAt(team[i], f));
          max += team[i].hpMax;
        }
        pts.push([xOf(f), y0 + h * (1 - (max ? total / max : 0))]);
      }

      // fill
      g.beginPath();
      g.moveTo(pts[0][0], y0 + h);
      pts.forEach(function (p) { g.lineTo(p[0], p[1]); });
      g.lineTo(pts[pts.length - 1][0], y0 + h);
      g.closePath();
      var grad = g.createLinearGradient(0, y0, 0, y0 + h);
      grad.addColorStop(0, color + '2e');
      grad.addColorStop(1, color + '02');
      g.fillStyle = grad;
      g.fill();

      // stroke
      g.beginPath();
      pts.forEach(function (p, i) { if (i === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]); });
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.stroke();

      // current value at the playhead
      var cur = pts.filter(function (p) { return p[0] <= xOf(store.frame); }).pop() || pts[0];
      g.fillStyle = color;
      g.font = '600 11px "Inter", system-ui, sans-serif';
      g.textAlign = 'left';
      var ratio = 1 - (cur[1] - y0) / h;
      g.textAlign = side === 'A' ? 'left' : 'right';
      g.fillText((side === 'A' ? '自 ' : '相 ') + Math.round(ratio * 100) + '%',
        side === 'A' ? x0 + 4 : x0 + w - 4, y0 + 13);
    });
    g.restore();
  }

  function drawBurstTicks(g, xOf, x0, y, w) {
    var s = store.sample;
    s.bursts.forEach(function (b) {
      var x = xOf(b.frame);
      if (x < x0 || x > x0 + w) return;
      var color = b.side === 'A' ? '#3ddbb4' : '#f7a24c';
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
      var color = b.side === 'A' ? '#3ddbb4' : '#f7a24c';
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

      g.fillStyle = '#0a0c10';
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
      var color = row.side === 'A' ? '#3ddbb4' : '#f7a24c';
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
      var covColor = row.side === 'A' ? '#3ddbb4' : '#f7a24c';
      g.fillStyle = covColor + '3a';
      var lastC = bx;
      for (var cf = 0; cf <= n; cf += 2) {
        var cv = Math.max(0, coverAt(u, cf)) / (u.coverMax || 1);
        var cx = bx + (xOf(cf) - x0) / w * bw;
        g.fillRect(lastC, barY - 4, Math.max(0, cx - lastC), 3 * cv);
        lastC = cx;
      }

      g.fillStyle = row.side === 'A' ? '#bfeedd' : '#f8d9b6';
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
          g.strokeStyle = '#ff5d76'; g.lineWidth = 1.5;
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
    drawTimeline(); updateReadout(); renderBoard('A'); renderBoard('B');
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

    var lc = $('#liveCorrection');
    if (lc) lc.addEventListener('click', function () {
      store.liveCorrection = !store.liveCorrection;
      lc.classList.toggle('on', store.liveCorrection);
      renderVerdict();
    });

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
      if (sync) store.sync = sync;
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
      renderRoster();
      window.Parties && renderPartySelects();
    }
  };
})();
