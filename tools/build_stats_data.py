#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Bundle the stat tables into js/stat_data.js.

    python -I tools/build_stats_data.py <pvp_dir> <out.js>

Reads the reference PvP calculator's data files and emits one compact JS blob.
"""
import json
import os
import sys

MAX_LEVEL = 1400


def load(path):
    t = open(path, encoding='utf-8-sig').read()
    return json.loads(t)


def main():
    if len(sys.argv) < 3:
        raise SystemExit('usage: build_stats_data.py <pvp_dir> <out.js>')
    src, out_path = sys.argv[1], sys.argv[2]

    base = load(os.path.join(src, 'base-stat-data.json'))
    equip = load(os.path.join(src, 'equipment-stats.json'))
    relic = load(os.path.join(src, 'relic-stats.json'))
    cube = load(os.path.join(src, 'cube-data.json'))
    aff = load(os.path.join(src, 'affinity-data.json'))

    levels = base['levels']
    keep = [i for i, lv in enumerate(levels) if lv <= MAX_LEVEL]
    lv_out = [levels[i] for i in keep]

    ct = {}
    for cls, cols in base['classTypes'].items():
        entry = {}
        for col, arr in cols.items():
            if isinstance(arr, dict):
                entry[col] = {w: [arr[w][i] for i in keep] for w in arr}
            else:
                entry[col] = [arr[i] for i in keep]
        ct[cls] = entry

    out = {
        'levels': lv_out,
        'classes': ct,
        'equipment': {
            'slots': equip['slots'],
            'base': equip['base'],
            'multipliers': equip['enhancement']['multipliers'],
        },
        'relic': relic,
        'cube': {'levels': cube['levels'], 'arrays': cube['arrays']},
        'affinity': {
            'totalLevels': aff['totalLevels'],
            'affinities': aff['affinities'],
        },
    }

    js = 'window.STAT_DATA = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n'
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(js)
    print('levels %d..%d  bytes %d' % (lv_out[0], lv_out[-1], len(js)))


if __name__ == '__main__':
    main()
