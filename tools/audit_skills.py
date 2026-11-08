#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""スキル本文とパース結果を1行ずつ突き合わせる.

    python -I tools/audit_skills.py <bundle.txt> <skills.js> <report.txt>

原文の「・」行（効果行）が、パース後の effects に何かしら対応しているかを調べ、
対応していないものを一覧にする。どのキャラのどのスキルの何行が落ちているかが分かる。
"""
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compile_skills as CS  # noqa: E402


def main():
    if len(sys.argv) < 4:
        raise SystemExit('usage: audit_skills.py <bundle.txt> <skills.js> <report.txt>')
    bundle_path, js_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

    chars = CS.read_bundle(bundle_path)
    text = io.open(js_path, encoding='utf-8').read()
    db = json.loads(text[text.index('=') + 1:].strip().rstrip(';'))

    missing_effect = []   # 効果行なのに effect が1つも出ていない
    unparsed_effect = []  # op=unparsed
    unknown_trigger = []
    no_target = []
    totals = {'effect_lines': 0, 'covered': 0, 'missing': 0, 'unparsed': 0,
              'blocks': 0, 'unknown': 0, 'no_target': 0}

    for c in chars:
        orgid = c.get('orgid')
        name = c.get('name') or str(orgid)
        for form in (False, True):
            key = ('%d' % orgid) if not form else ('%d*' % orgid)
            skills = db.get(key)
            if not skills:
                continue
            for slot in ('skill1', 'skill2', 'burst'):
                ct = c.get(slot + 'Ct') or 'パッシブ'
                parsed = skills[slot]['blocks']
                # 原文の効果行を取り出す（パーサと同じ分割を使う）
                lines = []
                for note in (c.get(slot + 'Infos') or []):
                    for t, tr in CS.split_lines(note):
                        if tr and not form:
                            continue
                        if t.startswith('・'):
                            lines.append(t)
                totals['effect_lines'] += len(lines)

                # パース結果の raw を集める
                def squash(x):
                    return re.sub(r'[\d.,%％\s]', '', x)
                parsed_raw = squash(' '.join(
                    [b.get('raw', '') for b in parsed] +
                    [e.get('raw', '') for b in parsed for e in b['effects']]))
                effs = [e for b in parsed for e in b['effects']]
                totals['blocks'] += len(parsed)
                for b in parsed:
                    if b['trigger'].get('kind') == 'unknown':
                        totals['unknown'] += 1
                        unknown_trigger.append((name, form, slot, b.get('raw', '')))
                    if not b['target'].get('side'):
                        totals['no_target'] += 1
                        no_target.append((name, form, slot, b.get('raw', '')))

                body = ' '.join(lines)
                # 効果行の本文がどれだけ parsed_raw に残っているか
                lost = 0
                for ln in lines:
                    core = squash(ln.lstrip('・'))
                    core = core[:14]
                    if not core:
                        continue
                    # 原文の断片がどれかしらの raw に含まれていれば「届いている」
                    if core in parsed_raw:
                        totals['covered'] += 1
                    else:
                        lost += 1
                        totals['missing'] += 1
                        missing_effect.append((name, form, slot, ln))

                for e in effs:
                    if e.get('op') == 'unparsed':
                        totals['unparsed'] += 1
                        unparsed_effect.append((name, form, slot, e.get('raw', '')))

    lines = []
    lines.append('効果行 %d / 届いた %d / 落ちた %d (%.1f%%)' % (
        totals['effect_lines'], totals['covered'], totals['missing'],
        100.0 * totals['missing'] / max(1, totals['effect_lines'])))
    lines.append('blocks %d / trigger=unknown %d / target.side なし %d' % (
        totals['blocks'], totals['unknown'], totals['no_target']))
    lines.append('effects unparsed %d' % totals['unparsed'])
    lines.append('')

    def dump(title, rows, limit=60):
        lines.append('=== %s (%d) ===' % (title, len(rows)))
        seen = {}
        for r in rows:
            k = r[-1]
            seen[k] = seen.get(k, 0) + 1
        for k, v in sorted(seen.items(), key=lambda x: -x[1])[:limit]:
            lines.append('%4d  %s' % (v, k))
        lines.append('')

    dump('原文にあるのに効果として届いていない行', missing_effect)
    dump('未解釈の効果', unparsed_effect)
    dump('条件が分からないブロック', unknown_trigger)
    dump('対象が決まらないブロック', no_target)

    io.open(out_path, 'w', encoding='utf-8').write('\n'.join(lines))
    print('\n'.join(lines[:4]))


if __name__ == '__main__':
    main()
