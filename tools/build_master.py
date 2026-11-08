# -*- coding: utf-8 -*-
"""
Build js/data.js — the character dataset the app loads.

THE ROSTER COMES FROM THE GAME MASTER (キャラ+スキル.txt, parsed by
tools/parse_chara_bundle.py). That file is the single source of truth for
names, rarity, element, weapon, class, burst stage and skill text. Anything the
game does not ship — April-Fools gags, unreleased placeholders — is simply not
in it, so it cannot leak into the roster.

Timing, base stats, burst-gauge generation and portraits come from
work/pvp/characters_core.json. That file is joined to the master by name and,
where a spelling differs, by release order inside a
(weapon, element, class, burst) group — both tables are in release order, so the
k-th master row of a group takes the k-th unused core row of that group.

Output
  js/data.js   window.CHARACTERS = [ ... ]

Run: python -I tools/build_master.py
"""
import json, io, os, re, unicodedata, collections

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
ROOT = os.path.dirname(APP)

ELEMENT = {'Fire': '灼熱', 'Water': '水冷', 'Wind': '風圧', 'Iron': '鉄甲', 'Electronic': '電撃',
           '燃烧': '灼熱', '风压': '風圧', '水冷': '水冷', '电击': '電撃', '铁甲': '鉄甲', '铁质': '鉄甲'}
CLASS = {'Attacker': '火力型', 'Defender': '防御型', 'Supporter': '支援型',
         '火力': '火力型', '防御': '防御型', '辅助': '支援型'}
CLASS_KEY = {'火力型': '火力', '防御型': '防御', '支援型': '辅助'}
COMPANY = {'ELYSION': 'エリシオン', 'TETRA': 'テトラ', 'MISSILIS': 'ミシリス',
           'PILGRIM': 'ピルグリム', 'ABNORMAL': 'アブノーマル',
           'エリシオン': 'エリシオン', 'テトラ': 'テトラ', 'ミシリス': 'ミシリス',
           'ピルグリム': 'ピルグリム', 'アブノーマル': 'アブノーマル',
           '极乐净土': 'エリシオン', '泰特拉': 'テトラ', '米西利斯': 'ミシリス',
           '朝圣者': 'ピルグリム', '反常': 'アブノーマル'}


def load(*parts):
    with io.open(os.path.join(*parts), 'r', encoding='utf-8') as f:
        return json.load(f)


def norm(s):
    s = unicodedata.normalize('NFKC', s or '')
    return re.sub(r'[\s:：・_\-—/（）()]', '', s).lower()


# Master rows whose local row cannot be found by name or by release order.
# Pin them explicitly; adding a line here is cheaper than guessing wrong.
ID_OVERRIDE = {
    'アークレンジャー・ブラック': 222,   # 方舟黑色游侠 / Ark Black Ranger
    'ドレイク：グレイトヴィラン': 226,   # 德雷克：终极反派 / Drake: Ultimate Villain
}

# Spellings that differ between the master and the local id table.
NAME_ALIAS = {
    'エヌミラクルフェアリー': 'エヌ：ミラクルフェアリー',
    'ネオンビジョンアイ': 'ネオン：ビジョン・アイ',
    'エイダウォン': 'エイダ',
    'クレアレッドフィールド': 'クレア',
    'ジルバレンタイン': 'ジル',
    '鈴原サクラ': 'サクラ：サマーブルーム',
    'ベスティ': 'ベスティー',
    'マリ': '真希波',
    'レイ（仮称）': 'レイ',
}

master = load(APP, 'data', 'game_master.json')
core = load(ROOT, 'work', 'pvp', 'characters_core.json')['CHARACTERS']
base_raw = load(ROOT, 'work', 'pvp', 'base-stat-data.json')

try:
    prior = {c['id']: c['n'] for c in load(ROOT, 'work', 'calc_chars.json')['chars']}
except Exception:
    prior = {}

_lv = base_raw['levels']
_i400 = _lv.index(400)
BASE = {}
for k, v in base_raw['classTypes'].items():
    BASE[k] = {'atk': v['attack'][_i400], 'hp': v['hp'][_i400],
               'def': {w: arr[_i400] for w, arr in v['defense'].items()}}


# ------------------------------------------------------------ core indexing
def normalise_stage(stage):
    """Red Hood can burst at any step; the two sources spell that Λ / B123."""
    s = str(stage or '')
    return 'B123' if s in ('Λ', 'B123', 'B1/2/3') else s


def key_of(weapon, element, class_type, stage):
    return (weapon, ELEMENT.get(element, element),
            CLASS.get(class_type, class_type), normalise_stage(stage))


def master_key(m):
    return key_of(m['weapon'], m['element'], m['classType'], m['burstStage'])


def is_treasure_row(c):
    return '珍藏' in (c.get('name') or '') or (c.get('enName') or '').endswith('+')


core_base = [c for c in core if not is_treasure_row(c)]
core_treasure = [c for c in core if is_treasure_row(c)]

by_name = collections.defaultdict(list)
for c in core_base:
    nm = prior.get(c['id'])
    if nm:
        by_name[norm(nm)].append(c)

by_group = collections.defaultdict(list)
for c in core_base:
    by_group[key_of(c['weapon'], c.get('element'), c.get('classType'), c.get('burstStage'))].append(c)

used = set()


def similarity(a, b):
    A = {a[i:i + 2] for i in range(len(a) - 1)} or {a}
    B = {b[i:i + 2] for i in range(len(b) - 1)} or {b}
    return 2.0 * len(A & B) / (len(A) + len(B)) if A and B else 0.0


def resolve(m):
    """The characters_core row for a master record, or None."""
    key = norm(NAME_ALIAS.get(norm(m['name']), m['name']))
    candidates = [r for r in by_name.get(key, []) if r['id'] not in used]
    if candidates:
        for r in candidates:
            if key_of(r['weapon'], r.get('element'), r.get('classType'), r.get('burstStage')) == master_key(m):
                return r
        return candidates[0]

    group = [r for r in by_group.get(master_key(m), []) if r['id'] not in used]

    # fuzzy inside the same weapon / element / class / stage group
    best, score = None, 0.0
    for r in group:
        nm = norm(prior.get(r['id'], ''))
        sc = similarity(key, nm)
        if sc > score:
            best, score = r, sc
    if best and score >= 0.72:
        return best

    # release order inside the group: take the closest name, but never drop the
    # character just because the two tables spell it differently
    if group:
        pick, pick_score = group[0], -1.0
        for r in group:
            nm = norm(prior.get(r['id'], ''))
            sc = similarity(key, nm) if nm else 0.5
            if sc > pick_score:
                pick, pick_score = r, sc
        return pick

    # last resort: same weapon and burst stage, earliest unused. This only
    # decides timing numbers, never names, so a near miss is harmless.
    fallback = [r for r in core_base
                if r['id'] not in used
                and r['weapon'] == m['weapon']
                and normalise_stage(r.get('burstStage')) == normalise_stage(m['burstStage'])]
    return fallback[0] if fallback else None


# ------------------------------------------------------------- skill parsing
TAG = re.compile(r'<[^>]+>')
TREASURE_BLOCK = re.compile(
    r"<b>\s*<font class='sfTooltipSkillTreasure\d'>.*?</font>\s*</b>"
    r"|<font class='sfTooltipSkillTreasure\d'>.*?</font>", re.S)
DMG = re.compile(
    r'最終攻撃力の\s*([\d.]+)\s*%(?:\s*→\s*([\d.]+)\s*%)?'
    r'(?:\s*の\s*([^\s。、]{0,12}?))?\s*ダメージ')
KIND = [(re.compile(r'敵全体'), 'all'),
        (re.compile(r'攻撃力が最も高い敵1機'), 'single'),
        (re.compile(r'照準線に最も近い敵1機'), 'single'),
        (re.compile(r'敵(\d+)機'), 'n'),
        (re.compile(r'ランダムな敵(\d+)機'), 'n'),
        (re.compile(r'味方全体'), 'allyAll'),
        (re.compile(r'味方(\d+)機'), 'allyN'),
        (re.compile(r'^自分'), 'self')]
EFFECTS = [('無敵', r'無敵'), ('気絶', r'気絶'), ('挑発', r'挑発|陽動'),
           ('シールド', r'シールド|バリア'), ('回復', r'回復'), ('不屈', r'不屈|根性'),
           ('攻撃力バフ', r'攻撃力[\d.]+%▲'), ('攻撃ダメージバフ', r'(?<!コードの)攻撃ダメージ[\d.]+%▲'),
           ('バーストスキルダメージバフ', r'バーストスキルダメージ[\d.]+%▲'),
           ('防御力バフ', r'防御力[\d.]+%▲'), ('被ダメデバフ', r'(受けるダメージ|被ダメージ)[\d.]+%▲'),
           ('チャージ速度', r'チャージ速度'), ('バーストゲージ', r'バーストゲージ'),
           ('バフ解除', r'バフ.{0,4}解除'), ('デバフ解除', r'デバフ.{0,4}解除'),
           ('反射', r'反射'), ('武器変更', r'使用武器変更'), ('自傷', r'最大HPの[\d.]+%')]
BUFF_RX = {
    'atkPct': r'攻撃力([\d.]+)%▲',
    'atkDmgPct': r'攻撃ダメージ([\d.]+)%▲',
    'burstDmgPct': r'バーストスキルダメージ([\d.]+)%▲',
    'defPct': r'防御力([\d.]+)%▲',
    'takenPct': r'(?:受けるダメージ|被ダメージ)([\d.]+)%▲',
    'chargePct': r'チャージ速度([\d.]+)%▲',
    'critDmgPct': r'クリティカルダメージ([\d.]+)%▲',
    'healPct': r'(?:最大HPの)?([\d.]+)%(?:のダメージ)?を?回復',
}
DUR_RX = re.compile(r'：\s*(\d+(?:\.\d+)?)\s*秒間維持')
SCOPED = [('takenRed', r'受けるダメージ\s*([\d.]+)\s*%\s*▼'),
          ('takenUp', r'受けるダメージ\s*([\d.]+)\s*%\s*▲'),
          ('invuln', r'無敵(?:\s*：\s*(\d+(?:\.\d+)?)\s*秒)?'),
          ('taunt', r'挑発(?:\s*：\s*(\d+(?:\.\d+)?)\s*秒)?'),
          ('heal', r'([\d.]+)\s*%\s*回復'),
          ('atkUp', r'攻撃力\s*([\d.]+)\s*%\s*▲'),
          ('dmgUp', r'攻撃ダメージ\s*([\d.]+)\s*%\s*▲'),
          ('defUp', r'防御力\s*([\d.]+)\s*%\s*▲'),
          ('guts', r'不屈|根性')]


def lines_of(notes, keep_treasure):
    out = []
    for raw in notes or []:
        text = raw if keep_treasure else TREASURE_BLOCK.sub('', raw)
        for part in re.split(r'<br\s*/?>', text):
            t = TAG.sub('', part).replace('&nbsp;', ' ').replace('　', ' ').strip()
            if t:
                out.append(t)
    return out


def parse_skill(notes, keep_treasure):
    lines = lines_of(notes, keep_treasure)
    subject = None
    hits = []
    for line in lines:
        if line.endswith('に'):
            for rx, kind in KIND:
                mm = rx.search(line)
                if mm:
                    count = int(mm.group(1)) if mm.groups() and mm.group(1) else None
                    subject = (kind, count)
                    break
            continue
        for mm in DMG.finditer(line):
            values = [float(mm.group(1))]
            if mm.group(2):
                values.append(float(mm.group(2)))
            typ = (mm.group(3) or '').strip() or '通常'
            for want in ('防御力無視', '分配', '持続', '真'):
                if want in typ:
                    typ = want
                    break
            else:
                typ = '通常'
            hits.append({'values': values, 'type': typ,
                         'scope': subject[0] if subject else None,
                         'count': subject[1] if subject else None})
    scope, count = (hits[0]['scope'], hits[0]['count']) if hits else (None, None)
    if scope == 'n' and count == 1:
        scope = 'single'
    blob = '\n'.join(lines)
    effects = [name for name, rx in EFFECTS if re.search(rx, blob)]
    return {'hits': hits, 'scope': scope, 'count': count, 'effects': effects}


def summarise(notes, upgraded):
    base = parse_skill(notes, False)
    up = parse_skill(notes, True) if upgraded else None
    if not base['hits'] and not (up and up['hits']):
        return None
    hits = base['hits'] or up['hits']
    big = max(hits, key=lambda h: h['values'][0])
    big_up = max(((up or base)['hits']), key=lambda h: h['values'][0])
    return {
        'multiplier': round(big['values'][0], 2),
        'multiplierUpgraded': round(big_up['values'][-1], 2),
        'scope': big['scope'] or base['scope'],
        'targetCount': big['count'],
        'damageType': big['type'],
        'effects': base['effects'],
        'hasUpgrade': big_up['values'][-1] != big['values'][0],
    }


def buffs_of(notes, keep_treasure):
    blob = '\n'.join(lines_of(notes, keep_treasure))
    out = {}
    for name, rx in BUFF_RX.items():
        vals = [float(m.group(1)) for m in re.finditer(rx, blob)]
        if vals:
            out[name] = max(vals)
    return out


def scoped_effects(notes):
    lines = lines_of(notes, False)
    subject = 'self'
    out = []
    for line in lines:
        if line.endswith('に'):
            if '味方全体' in line:
                subject = 'team'
            elif '自分' in line:
                subject = 'self'
            elif '敵全体' in line:
                subject = 'enemyAll'
            elif re.search(r'敵\s*\d*\s*機', line):
                subject = 'enemy'
            continue
        m = DUR_RX.search(line)
        duration = float(m.group(1)) if m else None
        for kind, rx in SCOPED:
            m2 = re.search(rx, line)
            if not m2:
                continue
            if kind in ('invuln', 'taunt'):
                value = float(m2.group(1)) if m2.group(1) else (3.0 if kind == 'invuln' else 10.0)
            elif m2.groups():
                try:
                    value = float(m2.group(1))
                except (TypeError, ValueError):
                    value = 0.0
            else:
                value = 0.0
            out.append({'kind': kind, 'target': subject, 'value': value,
                        'duration': duration if duration is not None else 10.0})
            break
    return out


# ------------------------------------------------------------------- build
ENGINE_FLAGS = ('chargeSpeedPercent', 'rlExplosionRange', 'firstFrameOverride',
                'attackIntervalFrames', 'attackReleaseFrames',
                'projectileFlightBaseFrames', 'projectileFlightFrames',
                'turnFrames', 'hasPenetration', 'hasExtraDamage',
                'hasExtraChargeEffect', 'extraDamageTargetMode',
                'flatBurstBonus', 'widePierceTargetCount',
                'delayedExtraHits', 'hitCountExtraEvents', 'targetRule',
                'slug', 'projectileFlightBaseFrames')
STAT_KEYS = ('weaponDamage', 'magazine', 'reloadSeconds', 'chargeSeconds', 'maxCharge')


def make_record(m, c, treasure_form=False):
    cls = m['classType']
    base = BASE.get(CLASS_KEY.get(cls, '火力'), BASE['火力'])
    notes_burst, notes_s1, notes_s2 = m['burst'], m['skill1'], m['skill2']
    upgraded = 'sfTooltipSkillTreasure' in ' '.join(notes_burst + notes_s1 + notes_s2)
    rec = {
        'id': c['id'] if c else None,
        'orgId': m['orgId'],
        'nameCode': None,
        'name': m['name'] + ('（宝物）' if treasure_form else ''),
        'enName': (c.get('enName') if c else '') or '',
        'rarity': m['rarity'],
        'treasure': treasure_form,
        'weapon': m['weapon'],
        'classType': cls,
        'element': ELEMENT.get(m['element'], m['element']),
        'company': COMPANY.get(m['company'], m['company']),
        'burstStage': m['burstStage'],
        'burstGen': (c.get('burstGen') if c else 0) or 0,
        'portrait': None,
        'baseStats': {'attack': base['atk'], 'hp': base['hp'],
                      'defense': base['def'].get(m['weapon'], 0)},
        'timing': {k: v for k, v in ((c or {}).get('timing') or {}).items() if v is not None},
        'stats': {k: ((c or {}).get('stats') or {}).get(k) for k in STAT_KEYS
                  if ((c or {}).get('stats') or {}).get(k) is not None},
        'burst': summarise(notes_burst, upgraded),
        'skill1': summarise(notes_s1, upgraded),
        'skill2': summarise(notes_s2, upgraded),
        'passiveBuffs': buffs_of(notes_s1 + notes_s2, False),
        'burstBuffs': buffs_of(notes_burst, False),
        'burstEffects': scoped_effects(notes_burst),
        'hasSkillData': bool(notes_burst),
        'skillText': {'burst': notes_burst, 'skill1': notes_s1, 'skill2': notes_s2},
    }
    if c:
        for flag in ENGINE_FLAGS:
            if c.get(flag) is not None:
                rec[flag] = c[flag]
    return rec


# A favourite-item row is the same Nikke as its base row, one 珍藏 suffix away.
# Pairing them by the base row's local id is exact; pairing by Japanese name is
# not (ソルジャーO.W. and ミランダ look alike in the local name table).
twin_by_base = {}
for c in core_treasure:
    base_name = c['name'].replace(' 珍藏', '').replace('（宝）', '').strip()
    for b in core_base:
        if b['name'] == base_name:
            twin_by_base[b['id']] = c
            break


def find_treasure_twin(base):
    if not base:
        return None
    twin = twin_by_base.get(base['id'])
    if twin and twin['id'] not in used:
        return twin
    return None


# Pinned rows are reserved before anything else so the greedy pass cannot steal them.
pinned = {}
for name, core_id in ID_OVERRIDE.items():
    row = next((c for c in core_base if c['id'] == core_id), None)
    if row:
        pinned[norm(name)] = row
        used.add(row['id'])

out = []
missing = []

for m in master:
    c = pinned.get(norm(m['name'])) or resolve(m)
    if c:
        used.add(c['id'])
    else:
        missing.append(m['name'])
    out.append(make_record(m, c, False))

    twin = find_treasure_twin(c)
    if twin:
        used.add(twin['id'])
        out.append(make_record(m, twin, True))

# portraits
try:
    praw = io.open(os.path.join(APP, 'js', 'portraits.js'), encoding='utf-8').read()
    PORTRAITS = json.loads(praw.split('window.PORTRAITS = ', 1)[1].rstrip().rstrip(';'))
except Exception:
    PORTRAITS = {}
for r in out:
    r['portrait'] = PORTRAITS.get(str(r['id'])) if r['id'] else None

# name_code — the blablalink join key
try:
    code_by_name = {}
    for row in load(ROOT, 'キャラ.txt'):
        nm = (row.get('name_localkey') or {}).get('name')
        if nm:
            code_by_name.setdefault(norm(nm), row.get('name_code'))
    for r in out:
        r['nameCode'] = code_by_name.get(norm(r['name'].replace('（宝物）', '')))
except Exception:
    pass

dst = os.path.join(APP, 'js', 'data.js')
with io.open(dst, 'w', encoding='utf-8') as f:
    f.write('/* generated by tools/build_master.py — do not edit by hand */\n')
    f.write('window.CHARACTERS = ' +
            json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')

unused = [c['id'] for c in core if c['id'] not in used]
report = [
    'master rows: %d' % len(master),
    'treasure forms: %d' % sum(1 for r in out if r['treasure']),
    'characters emitted: %d' % len(out),
    'joined to timing data: %d' % sum(1 for r in out if r['id']),
    'with name_code: %d' % sum(1 for r in out if r['nameCode']),
    'with portrait: %d' % sum(1 for r in out if r['portrait']),
    'with burst damage: %d' % sum(1 for r in out if r['burst']),
    'core rows dropped: %d  %s' % (len(unused), unused),
    'master rows with no timing data: %d' % len(missing),
    'wrote %s (%.1f KB)' % (dst, os.path.getsize(dst) / 1024),
]
report += ['    no timing: ' + n for n in missing[:25]]
with io.open(os.path.join(HERE, '_master_report.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(report))
print('\n'.join(report[:10]))
