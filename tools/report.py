#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""進捗を1コマンドで出す.

    python -I tools/report.py

- スキル本文のうち、パースで表現できていない量
- 固有スキル（js/specials）で何キャラ実装済みか
- どれだけのキャラが「完全に解析できている」か
"""
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import compile_skills as CS  # noqa: E402


def load_js(path, var):
    text = io.open(path, encoding='utf-8').read()
    i = text.index('=')
    return json.loads(text[i + 1:].strip().rstrip(';'))


def main():
    chars = CS.read_bundle(os.path.join(os.path.dirname(APP), 'キャラ+スキル.txt'))
    db = load_js(os.path.join(APP, 'js', 'skills.js'), 'SKILL_DB')
    data = load_js(os.path.join(APP, 'js', 'data.js'), 'CHARACTERS')
    by_org = {}
    for c in data:
        by_org.setdefault((c['orgId'], bool(c['treasure'])), c)

    special_dir = os.path.join(APP, 'js', 'specials')
    specials = set()
    if os.path.isdir(special_dir):
        for f in os.listdir(special_dir):
            if f.endswith('.js'):
                try:
                    t = io.open(os.path.join(special_dir, f), encoding='utf-8').read()
                    specials.update(int(x) for x in re.findall(r'\)\[(\d+)\]', t))
                except Exception:
                    pass

    forms = 0
    clean = 0
    bad_total = 0
    unk_total = 0
    missing_chars = []
    for c in chars:
        org = c.get('orgid')
        for form in (False, True):
            key = ('%d' % org) if not form else ('%d*' % org)
            sk = db.get(key)
            if not sk:
                continue
            rec = by_org.get((org, form))
            if not rec:
                continue
            forms += 1
            bad = 0
            unk = 0
            for slot in ('skill1', 'skill2', 'burst'):
                for b in sk[slot]['blocks']:
                    if b['trigger'].get('kind') == 'unknown':
                        unk += 1
                    for e in b['effects']:
                        if e.get('op') == 'unparsed':
                            bad += 1
            bad_total += bad
            unk_total += unk
            base_id = by_org.get((org, False), {}).get('id')
            has_special = rec['id'] in specials or (base_id is not None and base_id in specials)
            if (bad == 0 and unk == 0) or has_special:
                clean += 1
            elif not has_special:
                missing_chars.append((rec['name'], bad, unk))

    print('形態            %d' % forms)
    print('未解釈の効果    %d' % bad_total)
    print('不明な発動条件  %d' % unk_total)
    print('完全に解析済み  %d (%.0f%%)' % (clean, 100.0 * clean / max(1, forms)))
    print('固有スキル実装  %d キャラ' % len(specials))
    print('未着手          %d 形態' % len(missing_chars))
    missing_chars.sort(key=lambda r: -(r[1] * 3 + r[2]))
    out = []
    ARENA_NA = {
        'アンカー': '破壊可能な発射体がアリーナに無い',
        'ライ': '自分のデコイが条件。範囲攻撃は防げない',
        'マリ': 'コアヒットがアリーナに無い',
    }
    for name, bad, unk in missing_chars:
        if name in ARENA_NA:
            out.append('  %-24s 未解釈 %2d / 不明 %2d  ← アリーナ非該当: %s'
                       % (name, bad, unk, ARENA_NA[name]))
            continue
        out.append('  %-24s 未解釈 %2d / 不明 %2d' % (name, bad, unk))
    io.open(os.path.join(APP, '_report.txt'), 'w', encoding='utf-8').write(chr(10).join(out))
    print('')
    for line in out[:15]:
        print(line)


if __name__ == '__main__':
    main()
