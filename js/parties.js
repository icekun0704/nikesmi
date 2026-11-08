/* 編成の保存と読み出し.
 *
 *   Parties.list()            保存済み編成の一覧
 *   Parties.save(name, units) 上書き保存（同名があれば置き換え）
 *   Parties.remove(id)
 *   Parties.get(id)
 *
 * units は [{ charId, cfg }] の5要素。cfg はキャラごとの育成設定。
 */
window.Parties = (function () {
  'use strict';

  var KEY = 'nikesmi.parties.v2';
  var mem = null;

  function read() {
    if (mem) return mem;
    try {
      mem = JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch (e) { mem = []; }
    if (!Array.isArray(mem)) mem = [];
    return mem;
  }

  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* quota */ }
  }

  function uid() {
    return 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }

  function list() {
    return read().slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
  }

  function get(id) {
    return read().filter(function (p) { return p.id === id; })[0] || null;
  }

  function save(name, units, id) {
    name = String(name || '').trim() || '名称未設定';
    var all = read();
    var existing = id ? all.filter(function (p) { return p.id === id; })[0] : null;
    var clean = units.map(function (u) {
      return u && u.charId ? { charId: u.charId, cfg: u.cfg || null } : null;
    });
    if (existing) {
      existing.name = name;
      existing.units = clean;
      existing.updated = Date.now();
    } else {
      existing = { id: uid(), name: name, units: clean, updated: Date.now() };
      all.push(existing);
    }
    mem = all;
    write();
    return existing;
  }

  function remove(id) {
    mem = read().filter(function (p) { return p.id !== id; });
    write();
  }

  return { list: list, get: get, save: save, remove: remove };
})();
