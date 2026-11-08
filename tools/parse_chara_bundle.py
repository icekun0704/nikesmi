# -*- coding: utf-8 -*-
"""
Extract the character+skill table out of キャラ+スキル.txt.

The file is a webpack bundle, not JSON:
    webpackJsonp([1],{"+BEf":function(e,t){}, … }, …)
Inside it the game's master character table appears as plain object literals:

    {orgid:1,id:"nikke001",name:"ミランダ",…,
     skill1Infos:[{id:1,note:"…"},…], burstInfos:[{id:1,note:"…"},…]}

We NEVER execute it. We locate each `{orgid:…,id:"nikke…"` literal with a small
brace-matching scanner that understands string literals, convert the JS object
syntax to JSON (bare keys -> quoted), and json.loads the result.

Output: arena-sim/data/game_master.json
        arena-sim/data/game_master.js   (window.GAME_MASTER, same content)

Run: python -I tools/parse_chara_bundle.py
"""
import json, io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
ROOT = os.path.dirname(APP)
SRC = os.path.join(ROOT, 'キャラ+スキル.txt')

RECORD_START = re.compile(r'\{orgid:\s*\d+,\s*id:\s*"nikke\d+"')


def find_records(text):
    """Yield (start, end) of every balanced brace block that starts a record."""
    out = []
    for m in RECORD_START.finditer(text):
        i = m.start()
        depth = 0
        in_str = False
        quote = ''
        esc = False
        for j in range(i, len(text)):
            ch = text[j]
            if in_str:
                if esc:
                    esc = False
                elif ch == '\\':
                    esc = True
                elif ch == quote:
                    in_str = False
                continue
            if ch in '"\'':
                in_str = True
                quote = ch
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    out.append((i, j + 1))
                    break
    return out


def to_json_object(src):
    """Convert a JS object literal (bare keys, double-quoted strings) to JSON."""
    out = []
    i = 0
    n = len(src)
    in_str = False
    quote = ''
    esc = False
    last_significant = ''
    while i < n:
        ch = src[i]
        if in_str:
            out.append(ch)
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == quote:
                in_str = False
            i += 1
            continue
        if ch in '"\'':
            if ch == "'":
                out.append('"')
            else:
                out.append(ch)
            in_str = True
            quote = ch
            last_significant = ch
            i += 1
            continue
        # bare identifier used as a key?
        if ch.isalpha() or ch in '_$':
            j = i
            while j < n and (src[j].isalnum() or src[j] in '_$'):
                j += 1
            word = src[i:j]
            k = j
            while k < n and src[k] in ' \t\r\n':
                k += 1
            prev = last_significant
            if k < n and src[k] == ':' and prev in '{,':
                out.append('"' + word + '"')
            elif word in ('true', 'false', 'null'):
                out.append(word)
            else:
                # a bare token we cannot represent — give it a quoted string so
                # the JSON stays parseable and the problem is visible downstream
                out.append(json.dumps(word))
            last_significant = word[-1]
            i = j
            continue
        if ch == "'":
            last_significant = ch
        elif not ch.isspace():
            last_significant = ch
        out.append(ch)
        i += 1
    return ''.join(out)


def main():
    text = io.open(SRC, 'r', encoding='utf-8').read()
    spans = find_records(text)
    records = []
    failures = []

    for start, end in spans:
        literal = text[start:end]
        try:
            obj = json.loads(to_json_object(literal))
        except Exception as e:
            failures.append((start, str(e)[:120]))
            continue
        records.append(obj)

    # de-duplicate by orgid, keeping the last occurrence
    by_orgid = {}
    for r in records:
        by_orgid[r.get('orgid')] = r
    records = [by_orgid[k] for k in sorted(by_orgid)]

    out = []
    for r in records:
        out.append({
            'orgId': r.get('orgid'),
            'id': r.get('id'),
            'name': r.get('name'),
            'rarity': r.get('rearity'),
            'burstStage': 'B' + str(r.get('burstclass', '')).translate(
                str.maketrans('ⅠⅡⅢ', '123')),
            'burstClassRaw': r.get('burstclass'),
            'element': r.get('elemental'),
            'weapon': r.get('weapon'),
            'classType': r.get('class'),
            'company': r.get('manufacturer'),
            'implementation': r.get('implementation'),
            'costume': r.get('costume'),
            'spriteNo': r.get('spriteNo'),
            'generate': r.get('generate'),
            'skill1Name': r.get('skill1Name'),
            'skill2Name': r.get('skill2Name'),
            'burstName': r.get('burstName'),
            'skill1Type': r.get('skill1Ct'),
            'skill2Type': r.get('skill2Ct'),
            'burstType': r.get('burstCt'),
            'skill1': [i.get('note') for i in (r.get('skill1Infos') or [])],
            'skill2': [i.get('note') for i in (r.get('skill2Infos') or [])],
            'burst': [i.get('note') for i in (r.get('burstInfos') or [])],
        })

    dst_dir = os.path.join(APP, 'data')
    os.makedirs(dst_dir, exist_ok=True)
    with io.open(os.path.join(dst_dir, 'game_master.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    with io.open(os.path.join(APP, 'js', 'game_master.js'), 'w', encoding='utf-8') as f:
        f.write('/* generated by tools/parse_chara_bundle.py — do not edit */\n')
        f.write('window.GAME_MASTER = ' +
                json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')

    print('records found: %d   unique orgid: %d   parse failures: %d'
          % (len(spans), len(out), len(failures)))
    for f in failures[:5]:
        print('  fail at', f)
    print('wrote data/game_master.json and js/game_master.js')


if __name__ == '__main__':
    main()
