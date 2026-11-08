# -*- coding: utf-8 -*-
"""残っている未実装箇所を、原文つきで一覧にする（開発用）."""
import io, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compile_skills as CS

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)

chars = CS.read_bundle(os.path.join(os.path.dirname(APP), 'キャラ+スキル.txt'))
text = io.open(os.path.join(APP, 'js', 'skills.js'), encoding='utf-8').read()
db = json.loads(text[text.index('=') + 1:].strip().rstrip(';'))
dtext = io.open(os.path.join(APP, 'js', 'data.js'), encoding='utf-8').read()
data = json.loads(dtext[dtext.index('=') + 1:].strip().rstrip(';'))
by_org = {}
for c in data:
    by_org.setdefault((c['orgId'], bool(c['treasure'])), c)

specials = set()
for f in os.listdir(os.path.join(APP, 'js', 'specials')):
    if f.endswith('.js'):
        t = io.open(os.path.join(APP, 'js', 'specials', f), encoding='utf-8').read()
        specials.update(int(x) for x in re.findall(r'\)\[(\d+)\]', t))

out = []
for c in chars:
    org = c.get('orgid')
    for form in (False, True):
        key = ('%d' % org) if not form else ('%d*' % org)
        sk = db.get(key)
        rec = by_org.get((org, form))
        if not sk or not rec:
            continue
        base = by_org.get((org, False), {}).get('id')
        if rec['id'] in specials or (base is not None and base in specials):
            continue
        rows = []
        for slot in ('skill1', 'skill2', 'burst'):
            for b in sk[slot]['blocks']:
                if b['trigger'].get('kind') == 'unknown':
                    rows.append('  [%s] 条件不明: %s' % (slot, b.get('raw', '')))
                for e in b['effects']:
                    if e.get('op') == 'unparsed':
                        rows.append('  [%s] 未解釈: %s' % (slot, e.get('raw', '')))
        if rows:
            out.append('%s  id=%s org=%s' % (rec['name'], rec['id'], org))
            out.extend(rows)

io.open(os.path.join(APP, '_todo.txt'), 'w', encoding='utf-8').write('\n'.join(out))
print('remaining forms:', sum(1 for l in out if not l.startswith('  ')))
