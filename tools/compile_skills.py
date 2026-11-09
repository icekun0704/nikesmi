#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Compile the game master skill text into structured effect data.

Reads the webpack bundle (text only, never executed) and emits js/skills.js.

    python -I tools/compile_skills.py <bundle.txt> <out.js>

The bundle is untrusted input: it is parsed as text and never evaluated.
"""
import json
import os
import re
import sys

# --------------------------------------------------------------------------
# bundle -> python objects
# --------------------------------------------------------------------------


def read_bundle(path):
    s = open(path, encoding='utf-8', errors='replace').read()
    start = s.find('e.exports=[')
    if start < 0:
        raise SystemExit('bundle array not found')
    start += len('e.exports=')
    depth = 0
    in_str = None
    esc = False
    end = None
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == in_str:
                in_str = None
            continue
        if ch in '"\'':
            in_str = ch
        elif ch in '[{':
            depth += 1
        elif ch in ']}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        raise SystemExit('unterminated array')
    return parse_js_literal(s[start:end])


def parse_js_literal(t):
    out = []
    i = 0
    n = len(t)

    def read_string(quote):
        nonlocal i
        i += 1
        buf = []
        while i < n:
            c = t[i]
            if c == '\\' and i + 1 < n:
                nxt = t[i + 1]
                if nxt == '"':
                    buf.append('\\"')
                elif nxt == "'":
                    buf.append("'")
                elif nxt == '\\':
                    buf.append('\\\\')
                elif nxt == 'n':
                    buf.append('\\n')
                elif nxt == 't':
                    buf.append('\\t')
                elif nxt == 'u':
                    buf.append(t[i:i + 6])
                    i += 6
                    continue
                else:
                    buf.append('\\\\' + nxt)
                i += 2
                continue
            if c == quote:
                i += 1
                break
            if c == '"':
                buf.append('\\"')
            elif c == '\n':
                buf.append('\\n')
            else:
                buf.append(c)
            i += 1
        return '"' + ''.join(buf) + '"'

    while i < n:
        ch = t[i]
        if ch in '"\'':
            out.append(read_string(ch))
            continue
        if ch.isalpha() or ch == '_' or ch == '$':
            j = i
            while j < n and (t[j].isalnum() or t[j] in '_$'):
                j += 1
            word = t[i:j]
            k = j
            while k < n and t[k] in ' \t\r\n':
                k += 1
            if k < n and t[k] == ':':
                out.append('"' + word + '"')
            else:
                out.append(word)
            i = j
            continue
        out.append(ch)
        i += 1
    return json.loads(''.join(out))


# --------------------------------------------------------------------------
# text helpers
# --------------------------------------------------------------------------

TREASURE_RE = re.compile(r"^<b><font class='sfTooltipSkillTreasure(\d)'>.*</font></b>$", re.S)


def strip_markup(x):
    x = re.sub(r'<br\s*/?>', '\n', x)
    x = re.sub(r'<[^>]+>', '', x)
    return x


def is_header_line(s):
    """Lines that start a new block rather than continue the previous effect."""
    if HEADER_PREFIX.match(s):
        return True
    if s.endswith('：') or s.endswith(':'):
        return True
    return (s.endswith('に') or s.endswith('、')) and '%' not in s and not re.search(
        r'(ダメージ|回復|維持|▲|▼|解除|無敵|挑発|気絶)', s)


def split_lines(note):
    """Return [(text, treasure_only)] for one note entry (dict or str).

    The game wraps one effect across several <br> segments; joining them back
    keeps lines like the Dorothy burst's 8900.83% text intact, which used to be
    dropped entirely.
    """
    raw = note.get('note', '') if isinstance(note, dict) else note
    m = TREASURE_RE.match(raw.strip())
    treasure_only = bool(m)
    text = strip_markup(raw)
    out = []
    for ln in text.split(chr(10)):
        line = ln.strip()
        if not line:
            continue
        if line.startswith('・'):
            out.append([line, treasure_only])
            continue
        if out and out[-1][0].startswith('・') and not is_header_line(line):
            out[-1][0] += line
        else:
            out.append([line, treasure_only])
    return [(t, tr) for t, tr in out]


HEADER_PREFIX = re.compile(r'^(?:効果\d+|追加効果\d*|\d+回目|\d+段階|第\d+)[：:]')
NUM = r'(\d+(?:\.\d+)?)'

# --------------------------------------------------------------------------
# effect parsing
# --------------------------------------------------------------------------

# stat name -> engine key
STATS = {
    '攻撃力': 'atkPct',
    '攻撃ダメージ': 'atkDmgPct',
    '防御力': 'defPct',
    '最大HP': 'maxHpPct',
    '最大HPのみ': 'maxHpPct',
    'クリティカル確率': 'critRate',
    '通常攻撃のクリティカル確率': 'critRate',
    'クリティカルダメージ': 'critDmgPct',
    '命中率': 'hitRate',
    '有利コードの攻撃ダメージ': 'elementDmgPct',
    '持続ダメージ': 'sustainedDmgPct',
    '貫通ダメージ': 'pierceDmgPct',
    '防御力無視ダメージ': 'ignoreDefDmgPct',
    'チャージダメージ': 'chargeDmgPct',
    'コアダメージ': 'coreDmgPct',
    'パーツダメージ': 'partDmgPct',
    '分配ダメージ': 'distributedDmgPct',
    '発射体爆発ダメージ': 'projectileDmgPct',
    '阻止部位の攻撃ダメージ': 'partDmgPct',
    'バリアに与えるダメージ': 'barrierDmgPct',
    '受けるダメージ': 'takenDmgPct',
    '受けるHP回復量': 'recoveryTakenPct',
    '与えるHP回復量': 'recoveryGivenPct',
    'リロード速度': 'reloadSpeedPct',
    'チャージ速度': 'chargeSpeedPct',
    '攻撃速度': 'atkSpeedPct',
    '最大装弾数': 'magazinePct',
    '爆発範囲': 'explosionRangePct',
    'バーストゲージのチャージ速度': 'burstGaugePct',
    'バーストゲージのチャージ': 'burstGaugePct',
    'ペレット数': 'pelletPct',
    '現在のHP': 'hpDrainPct',
}

# effect keyword line -> engine effect
KEYWORD_EFFECTS = [
    (r'^挑発(?:：|:)', 'taunt'),
    (r'^ヘイト[：:]', 'taunt'),
    (r'^無敵', 'invuln'),
    (r'^気絶', 'stun'),
    (r'^スタン', 'stun'),
    (r'^デバフ効果解除', 'debuffClear'),
    (r'^バフ効果解除', 'buffClear'),
    (r'^弾丸チャージ', 'bulletCharge'),
    (r'^装弾数無限', 'infiniteMagazine'),
    (r'^遮蔽物HP回復', 'coverHeal'),
    (r'^遮蔽物HP', 'coverRestore'),
    (r'^隠れ身', 'hide'),
    (r'^HP回復均等分配', 'shareRecovery'),
    (r'^受けるダメージ均等分配', 'shareDamage'),
    (r'^貫通特化', 'pierceSpecial'),
    (r'^リロード速度', 'reloadSpeedFix'),
]

DURATION_RE = re.compile(r'：(\d+(?:\.\d+)?)秒間維持')
DURATION_HOLD_RE = re.compile(r'：(\d+(?:\.\d+)?)発間維持')
INTERVAL_RE = re.compile(r'：(\d+(?:\.\d+)?)秒間隔')
STACK_RE = re.compile(r'：(\d+)スタック')
LIMIT_RE = re.compile(r'戦闘中(\d+)回発動')
PCT_RE = re.compile(NUM + r'\s*%\s*([▲▼])')
TREASURE_ARROW_RE = re.compile(NUM + r'%→' + NUM + r'%')


META_EOF = re.compile(
    r'段階別|下位効果|スタック適用|使用回数別|開始回数別|攻撃回数別|のみ適用'
    r'|^機能|^効果\d+：機能|^保存|^臨戦|再発動周期|^バニーモード|^ペルソナ|^ステージパート'
    r'|スタック量|スタックコピー|警戒対象指定|命中部位|が根腐れに変化|が.*に変化$'
)
META_TAIL = re.compile(r'(?:解除不可|解除)$')


def parse_effect(text, treasure):
    eff = _parse_effect(text, treasure)
    # 個別ルールはスタック数や持続時間を取りこぼすので、ここで補う
    if isinstance(eff, dict) and eff.get('op') not in ('unparsed', 'meta'):
        st = STACK_RE.search(text)
        if st and 'stacks' not in eff and 'maxStacks' not in eff:
            eff['stacks'] = int(st.group(1))
        if 'duration' not in eff:
            dur = DURATION_RE.search(text)
            if dur:
                eff['duration'] = float(dur.group(1))
            elif '：持続' in text or text.endswith('持続'):
                eff['duration'] = None
        if 'maxTriggers' not in eff:
            lim = LIMIT_RE.search(text)
            if lim:
                eff['maxTriggers'] = int(lim.group(1))
        return eff
        # 毎秒回復するものは、その回数ぶん刻む
        if eff.get('op') == 'heal' and 'ticks' not in eff:
            md = re.search(r'(' + NUM + r')秒間維持', text)
            mi = re.search(r'(' + NUM + r')秒間隔', text)
            if md and (mi or '毎秒' in text):
                iv = float(mi.group(1)) if mi else 1.0
                if iv > 0:
                    eff['interval'] = iv
                    eff['ticks'] = max(1, int(round(float(md.group(1)) / iv)))
    return eff


def _parse_effect(text, treasure):
    """One '・...' line -> dict or None."""
    line = text.lstrip('・').strip()
    line = line.replace('％', '%').replace('　', ' ')
    if not line:
        return None

    # ---- explicit non-combat / meta text ---------------------------------
    if re.match(r'^(開始回数別|使用回数別|スキル対象の説明部分|下部|上位)', line):
        return {'op': 'meta', 'raw': line}

    # ---- lifesteal -------------------------------------------------------
    m = re.search(r'攻撃ダメージの' + NUM + r'%を?回復', line)
    if m:
        out = {'op': 'lifesteal', 'value': float(m.group(1)), 'raw': line}
        dur = DURATION_RE.search(line)
        out['duration'] = float(dur.group(1)) if dur else None
        return out

    # ---- damage-based healing over time ----------------------------------
    m = re.search(r'ダメージの' + NUM + r'%を?回復', line)
    if m:
        out = {'op': 'lifesteal', 'value': float(m.group(1)), 'raw': line}
        dur = DURATION_RE.search(line)
        out['duration'] = float(dur.group(1)) if dur else None
        return out

    # ---- flat magazine ---------------------------------------------------
    m = re.search(r'最大装弾数(\d+)発▲', line)
    if m:
        out = {'op': 'stat', 'stat': 'magazineFlat', 'value': float(m.group(1)),
               'dir': 'up', 'raw': line}
        dur = DURATION_RE.search(line)
        out['duration'] = float(dur.group(1)) if dur else None
        return out

    # ---- revive / indomitability / deathless -----------------------------
    m = re.search(r'HP' + NUM + r'%で復活', line)
    if m:
        return {'op': 'revive', 'value': float(m.group(1)), 'raw': line}
    if line.startswith('不屈'):
        out = {'op': 'indomitable', 'raw': line}
        dur = DURATION_RE.search(line)
        out['duration'] = float(dur.group(1)) if dur else None
        return out
    if line.startswith('根性') and '使用回数' not in line:
        return {'op': 'guts', 'raw': line}

    # ---- burst gauge / burst cooldown ------------------------------------
    m = re.search(r'バーストゲージのチャージ' + NUM + r'%', line)
    if m:
        return {'op': 'gaugeCharge', 'value': float(m.group(1)), 'raw': line}
    m = re.search(r'バーストスキルクールタイム' + NUM + r'秒', line)
    if m:
        return {'op': 'burstCd', 'value': float(m.group(1)), 'raw': line}
    if line.startswith('バースト再突入'):
        return {'op': 'reentry', 'raw': line}
    m = re.search(r'フルバーストタイム' + NUM + r'秒▲', line)
    if m:
        return {'op': 'fullBurstExtend', 'value': float(m.group(1)), 'raw': line}

    # ---- misc combat flags ------------------------------------------------
    m = re.search(r'貫通範囲' + NUM + r'%', line)
    if m:
        return {'op': 'stat', 'stat': 'pierceRangePct', 'value': float(m.group(1)),
                'dir': 'up', 'raw': line}
    if '通常攻撃を防御力無視ダメージとして適用' in line:
        m = DURATION_RE.search(line)
        return {'op': 'normalIgnoreDef',
                'duration': float(m.group(1)) if m else None, 'raw': line}
    if line.startswith('移動不可'):
        return {'op': 'root', 'raw': line}
    if line.startswith('スキル対象'):
        return {'op': 'meta', 'raw': line}
    if line.startswith('デコイ'):
        return {'op': 'decoy', 'raw': line}
    if 'デコイ回復' in line or 'デコイ持続回復' in line:
        return {'op': 'decoyHeal', 'raw': line}
    if line.startswith('弾丸チャージ') or '弾丸チャージ' in line:
        mp = re.search(r'弾丸チャージ(' + NUM + r')%', line)
        mn = re.search(r'弾丸チャージ(\d+)発', line)
        out = {'op': 'bulletCharge', 'raw': line}
        if mp:
            out['value'] = float(mp.group(1))
        elif mn:
            out['value'] = float(mn.group(1))
            out['unit'] = 'rounds'
        return out
    if line.startswith('スタック可能バフ'):
        return {'op': 'stackBoost', 'raw': line}
    if line.startswith('チェーンバインド'):
        return {'op': 'meta', 'raw': line}
    if line.startswith('攻撃範囲の中心に強制移動'):
        return {'op': 'pull', 'raw': line}
    if '遮蔽物' in line:
        m = re.search(NUM + r'%', line)
        return {'op': 'coverStat', 'value': float(m.group(1)) if m else None, 'raw': line}
    if '使用武器変更' in line:
        return {'op': 'weaponChange', 'raw': line}
    if 'スキルN強制使用' in line or '強制使用' in line:
        return {'op': 'forceSkill', 'raw': line}

    # treasure upgrade arrow: "N%→M%" — pick the right side per form
    def pick(m):
        a, b = float(m.group(1)), float(m.group(2))
        return b if treasure else a

    # ---- damage instance ------------------------------------------------
    m = re.search(r'最終攻撃力の' + NUM + r'%(?:→' + NUM + r'%)?の(.*?)ダメージ', line)
    if m:
        base = float(m.group(2)) if treasure and m.group(2) else float(m.group(1))
        tail = m.group(3) or ''
        return add_dot_fields({
            'op': 'damage',
            'value': base,
            'type': classify_damage_type(tail),
            'raw': line,
        }, line)

    m = re.search(r'最終攻撃力' + NUM + r'%(?:→' + NUM + r'%)?の(.*?)ダメージ', line)
    if m:
        base = float(m.group(2)) if treasure and m.group(2) else float(m.group(1))
        return add_dot_fields({'op': 'damage', 'value': base,
                'type': classify_damage_type(m.group(3) or ''), 'raw': line}, line)

    # ---- recovery --------------------------------------------------------
    m = re.search(r'最終最大HPの' + NUM + r'%(?:→' + NUM + r'%)?(?:を|の)?(?:回復|持続回復)', line)
    if m:
        base = float(m.group(2)) if treasure and m.group(2) else float(m.group(1))
        out = {'op': 'heal', 'value': base, 'raw': line}
        iv = INTERVAL_RE.search(line)
        if iv:
            out['interval'] = float(iv.group(1))
        dur = DURATION_RE.search(line)
        if dur:
            out['duration'] = float(dur.group(1))
        return out

    m = re.search(r'最終最大HPの' + NUM + r'%(?:→' + NUM + r'%)?のバリア', line)
    if m:
        base = float(m.group(2)) if treasure and m.group(2) else float(m.group(1))
        out = {'op': 'shield', 'value': base, 'raw': line}
        dur = DURATION_RE.search(line)
        if dur:
            out['duration'] = float(dur.group(1))
        return out

    m = re.search(r'最終最大HPの' + NUM + r'%分の攻撃力', line)
    if m:
        out = {'op': 'flatStat', 'stat': 'atk', 'basis': 'casterMaxHp',
               'value': float(m.group(1)), 'dir': 'up', 'raw': line}
        dur = DURATION_RE.search(line)
        if dur:
            out['duration'] = float(dur.group(1))
        return out

    m = re.search(r'スキル発動者の攻撃力' + NUM + r'%分の攻撃力', line)
    if m:
        out = {'op': 'flatStat', 'stat': 'atk', 'basis': 'casterAtk',
               'value': float(m.group(1)), 'dir': 'up', 'raw': line}
        dur = DURATION_RE.search(line)
        if dur:
            out['duration'] = float(dur.group(1))
        return out

    # ---- Trina-style conditional burst-damage buff -----------------------
    m = re.search(r'スキル対象の説明部分が『(.+?)』で終わるバーストスキルダメージ' + NUM + r'%▲', line)
    if m:
        out = {'op': 'stat', 'stat': 'burstDmgPct', 'value': float(m.group(2)),
               'dir': 'up', 'basis': 'self', 'onlyIfBurstTargets': m.group(1), 'raw': line}
        dur = DURATION_RE.search(line)
        out['duration'] = float(dur.group(1)) if dur else None
        return out

    # ---- generic "STAT N%▲/▼ : duration" --------------------------------
    # strip a leading label like "効果2：" / "3回目：" / "ラクカジャ："
    body = line
    label = None
    lm = re.match(r'^([^：:]{1,14})[：:](.+)$', body)
    if lm and '%' in lm.group(2):
        label = lm.group(1)
        body = lm.group(2)

    # handle "スキル発動者基準で攻撃力"
    basis = 'self'
    if body.startswith('スキル発動者基準で'):
        basis = 'caster'
        body = body[len('スキル発動者基準で'):]
    if body.startswith('スキル発動者の'):
        basis = 'caster'
        body = body[len('スキル発動者の'):]

    pm = PCT_RE.search(body)
    if pm:
        value = float(pm.group(1))
        # treasure arrow inside
        arrow = TREASURE_ARROW_RE.search(body)
        if arrow:
            value = float(arrow.group(2)) if treasure else float(arrow.group(1))
        direction = 'up' if pm.group(2) == '▲' else 'down'
        name = body[:pm.start()].strip()
        name = re.sub(r'^[^　-鿿ぁ-ヿ]*[：:]', '', name).strip()
        key = None
        for k, v in STATS.items():
            if name == k:
                key = v
                break
        if key is None:
            for k, v in sorted(STATS.items(), key=lambda kv: -len(kv[0])):
                if k in name:
                    key = v
                    break
        if key is None and basis == 'caster' and ('攻撃力' in name):
            key = 'atkPct'
        if key is None and basis == 'caster' and ('防御力' in name):
            key = 'defPct'
        if key is None and basis == 'caster' and ('最大HP' in name):
            key = 'maxHpPct'
        out = {'op': 'stat', 'stat': key, 'value': value, 'dir': direction,
               'basis': basis, 'raw': line}
        dur = DURATION_RE.search(line)
        if dur:
            out['duration'] = float(dur.group(1))
        hold = DURATION_HOLD_RE.search(line)
        if hold:
            out['shots'] = float(hold.group(1))
        st = STACK_RE.search(line)
        if st:
            out['stacks'] = int(st.group(1))
        lim = LIMIT_RE.search(line)
        if lim:
            out['maxTriggers'] = int(lim.group(1))
        if '：持続' in line or line.endswith('持続'):
            out['duration'] = None
        if label:
            out['label'] = label
        if key is None:
            out['op'] = 'unparsed'
            out['key_missing'] = name
        return out

    # ---- heal over time ---------------------------------------------------
    m = re.search(r'最終最大HPの' + NUM + r'%[：:]持続回復', line)
    if m:
        out = {'op': 'heal', 'value': float(m.group(1)), 'raw': line}
        iv = INTERVAL_RE.search(line)
        out['interval'] = float(iv.group(1)) if iv else 1
        dur = DURATION_RE.search(line)
        out['duration'] = float(dur.group(1)) if dur else None
        return out

    # ---- more character-specific but mechanically simple lines -----------
    m = re.search(r'火カゲージ' + NUM + r'チャージ', line)
    if m:
        return {'op': 'gaugeCharge', 'value': float(m.group(1)), 'raw': line}
    m = re.search(r'現在のHP' + NUM + r'%▼', line)
    if m:
        return {'op': 'hpDrain', 'value': float(m.group(1)), 'raw': line}
    m = re.search(r'フルバーストタイム' + NUM + r'秒▼', line)
    if m:
        return {'op': 'fullBurstReduce', 'value': float(m.group(1)), 'raw': line}
    m = re.search(r'ペレット数(\d+)個▲', line)
    if m:
        return {'op': 'stat', 'stat': 'pelletFlat', 'dir': 'up',
                'value': float(m.group(1)), 'raw': line}
    m = re.search(r'最終攻撃力の?' + NUM + r'%(?:→' + NUM + r'%)?\s*(?:の)?\s*(追加|バーストスキル)?ダメージ', line)
    if m:
        base = float(m.group(2)) if treasure and m.group(2) else float(m.group(1))
        return add_dot_fields({'op': 'damage', 'value': base,
                'type': classify_damage_type((m.group(3) or '') + line), 'raw': line}, line)
    m = re.search(r'チャージダメージ' + NUM + r'%倍率▲', line)
    if m:
        out = {'op': 'stat', 'stat': 'chargeDmgMultPct', 'value': float(m.group(1)),
               'dir': 'up', 'raw': line}
        dur = DURATION_RE.search(line)
        out['duration'] = float(dur.group(1)) if dur else None
        return out
    m = re.search(r'通常攻撃を防御力無視ダメージに変更', line)
    if m:
        out = {'op': 'normalIgnoreDef', 'raw': line}
        dur = DURATION_RE.search(line)
        out['duration'] = float(dur.group(1)) if dur else None
        return out
    m = re.search(r'デバフ効果免疫(\d+)回', line)
    if m:
        return {'op': 'debuffImmune', 'value': float(m.group(1)), 'raw': line}
    m = re.search(r'スキル発動者の最終最大HPの?' + NUM + r'%(?:→' + NUM + r'%)?の?.*?バリア', line)
    if m:
        base = float(m.group(2)) if treasure and m.group(2) else float(m.group(1))
        out = {'op': 'shield', 'value': base, 'raw': line}
        dur = DURATION_RE.search(line)
        out['duration'] = float(dur.group(1)) if dur else None
        return out
    m = re.search(r'スキル発動者の最大HPの' + NUM + r'%を回復', line)
    if m:
        return {'op': 'heal', 'value': float(m.group(1)), 'basis': 'casterMaxHp', 'raw': line}
    m = re.search(r'スキル発動者の防御力の' + NUM + r'%防御力▲', line)
    if m:
        return {'op': 'flatStat', 'stat': 'def', 'basis': 'casterDef',
                'value': float(m.group(1)), 'dir': 'up', 'raw': line}
    if '適正最大射程距離' in line:
        return {'op': 'meta', 'raw': line}
    if '残弾数' in line:
        return {'op': 'meta', 'raw': line}
    if '用作' in line or '解除条件' in line:
        return {'op': 'meta', 'raw': line}

    # ---- keyword effects --------------------------------------------------
    for pat, op in KEYWORD_EFFECTS:
        if re.match(pat, line):
            out = {'op': op, 'raw': line}
            dur = DURATION_RE.search(line)
            if dur:
                out['duration'] = float(dur.group(1))
            hold = DURATION_HOLD_RE.search(line)
            if hold:
                out['shots'] = float(hold.group(1))
            nm = re.search(NUM + r'%', line)
            if nm:
                out['value'] = float(nm.group(1))
            cnt = re.search(r'(\d+)個', line)
            if cnt:
                out['count'] = int(cnt.group(1))
            return out

    # ---- generic damage without 最終攻撃力 --------------------------------
    m = re.search(NUM + r'%(?:→' + NUM + r'%)?のダメージ', line)
    if m:
        base = float(m.group(2)) if treasure and m.group(2) else float(m.group(1))
        eff = {'op': 'damage', 'value': base, 'type': classify_damage_type(line), 'raw': line}
        # 持続ダメージは「1秒間隔：10秒間維持」ぶんだけ刻む
        if eff['type'] == 'sustained':
            mi = re.search(r'(' + NUM + r')秒間隔', line)
            md = re.search(r'(' + NUM + r')秒間維持', line)
            if mi and md:
                eff['interval'] = float(mi.group(1))
                eff['ticks'] = max(1, int(round(float(md.group(1)) / float(mi.group(1)))))
            elif md:
                eff['interval'] = 1.0
                eff['ticks'] = max(1, int(round(float(md.group(1)))))
        return eff

    if META_EOF.search(line) or META_TAIL.search(line):
        return {'op': 'meta', 'raw': line}
    return {'op': 'unparsed', 'raw': line}



def add_dot_fields(eff, line):
    """持続ダメージに、刻み間隔と回数を足す。"""
    if eff.get('type') != 'sustained' or eff.get('ticks'):
        return eff
    mi = re.search(r'(' + NUM + r')秒間隔', line)
    md = re.search(r'(' + NUM + r')秒間維持', line)
    if mi and md:
        eff['interval'] = float(mi.group(1))
        eff['ticks'] = max(1, int(round(float(md.group(1)) / float(mi.group(1)))))
    elif md:
        eff['interval'] = 1.0
        eff['ticks'] = max(1, int(round(float(md.group(1)))))
    return eff


def classify_damage_type(tail):
    if '防御力無視' in tail:
        return 'ignoreDef'
    if 'バーストスキル' in tail:
        return 'burst'
    if '持続' in tail:
        return 'sustained'
    if '貫通' in tail:
        return 'pierce'
    if '分配' in tail:
        return 'distributed'
    if '追加' in tail:
        return 'extra'
    return 'normal'


# --------------------------------------------------------------------------
# block header parsing  (trigger + target)
# --------------------------------------------------------------------------

def parse_target(header):
    """Extract target descriptor from a header line."""
    h = header

    # conditions come before the final '、' that introduces the target
    trig_text = ''
    target_text = h
    if '、' in h:
        idx = h.rfind('、')
        trig_text = h[:idx]
        target_text = h[idx + 1:]

    side = None
    sel = 'all'
    pick = None
    count = None
    exclude_self = False

    t = target_text
    if '敵' in t:
        side = 'enemy'
    if '味方' in t:
        side = 'ally'
    if '自分' in t and '味方' not in t and '敵' not in t:
        side = 'self'

    if '自分を除く' in t:
        exclude_self = True
    if 'ランダム' in t:
        sel = 'random'
    m = re.search(r'(\d+)機', t)
    if m:
        count = int(m.group(1))
        sel = 'pick' if sel == 'all' else sel
    if '攻撃力が最も高い' in t or '攻撃力の最も高い' in t:
        pick = 'highestAtk'
    if '攻撃力が最も低い' in t:
        pick = 'lowestAtk'
    if '残りのHPの割合が最も低い' in t or 'HPの割合が最も低い' in t:
        pick = 'lowestHpPct'
    if '残りのHPが最も低い' in t or 'HPの値が最も低い' in t:
        pick = 'lowestHp'
    if 'HPが最も高い' in t:
        pick = 'highestHp'
    if '最大HPが最も高い' in t:
        pick = 'highestMaxHp'
    if '防御力が最も高い' in t:
        pick = 'highestDef'
    if '防御力が最も低い' in t:
        pick = 'lowestDef'
    if side == 'ally' and '自分を除く' in t:
        exclude_self = True
    if '全ての敵を挑発' in t or '敵全体を挑発' in t:
        side = 'enemy'

    wt = re.search(r'(サブマシンガン|アサルトライフル|ショットガン|マシンガン|スナイパーライフル|ロケットランチャー)を所持する', t)
    weapon = None
    if wt:
        weapon = {
            'サブマシンガン': 'SMG', 'アサルトライフル': 'AR', 'ショットガン': 'SG',
            'マシンガン': 'MG', 'スナイパーライフル': 'SR', 'ロケットランチャー': 'RL',
        }[wt.group(1)]

    el = None
    em = re.search(r'(灼熱|水冷|風圧|電撃|鉄甲)コードの', t)
    if em:
        el = em.group(1)

    cls = None
    cm = re.search(r'(火力型|防御型|支援型)の', t)
    if cm:
        cls = cm.group(1)

    if '攻撃範囲内' in t:
        sel = 'range'

    if side is None and '対象' in t:
        side = 'enemy'
        sel = 'primary'

    return {
        'side': side,
        'sel': sel,
        'pick': pick,
        'count': count,
        'excludeSelf': exclude_self,
        'weapon': weapon,
        'element': el,
        'classType': cls,
    }, trig_text


BURST_ROMAN = {'Ⅰ': 1, 'Ⅱ': 2, 'Ⅲ': 3, '1': 1, '2': 2, '3': 3,
               'I': 1, 'II': 2, 'III': 3}


def burst_stage_trigger(text):
    """Return (stage, ally) when the header is scoped to a burst stage."""
    m = re.match(r'^(自分が|自分に|味方が|味方に)?バースト\s*([ⅠⅡⅢ123])\s*'
                 r'(?:で使用時|を使用した時|使用時|で使用した時)', text)
    if not m:
        return None
    stage = BURST_ROMAN.get(m.group(2))
    if stage is None:
        return None
    ally = bool(m.group(1)) and m.group(1).startswith('味方')
    return (stage, ally)


def parse_trigger(text, slot, ct):
    trig = _parse_trigger(text, slot, ct)
    # 個別ルールが先に当たると確率が落ちるので、ここで必ず拾う
    m = re.search(r'(' + NUM + r')%の確率で', text or '')
    if m and 'chance' not in trig:
        trig['chance'] = float(m.group(1))
    return trig


def _parse_trigger(text, slot, ct):
    """Header text -> trigger descriptor."""
    t = text.strip()
    if not t:
        if slot == 'burst':
            return {'kind': 'burst'}
        if ct and ct != 'パッシブ':
            mct = re.search(NUM, ct)
            if mct:
                return {'kind': 'periodic', 'seconds': float(mct.group(1))}
        return {'kind': 'always'}

    # strip leading "N回目：" "効果N：" etc
    t = re.sub(r'^(?:\d+回目|\d+回|効果\d+|第\d+)(?:[：:])', '', t).strip()

    # "バーストⅡで使用時" / "自分がバーストⅡを使用した時" -> その段階で発動
    stage = burst_stage_trigger(t)
    if stage is not None:
        trig = {'kind': 'burstStage', 'stage': stage[0]}
        if stage[1]:
            trig['ally'] = True
        return trig

    if slot == 'burst':
        return {'kind': 'burst'}

    # "3回:" / "2段階:" style prefixes that select the Nth activation
    m = re.match(r'^(\d+)回[：:]\s*(.*)$', t)
    if m:
        inner = parse_trigger(m.group(2), slot, ct)
        inner['nth'] = int(m.group(1))
        return inner

    rules = [
        (r'^フルバーストタイム(?:が)?発動(?:した)?時', {'kind': 'fullBurst'}),
        (r'^フルバーストタイム(?:が)?終了した時', {'kind': 'fullBurstEnd'}),
        (r'^フルバーストタイムを終了した時', {'kind': 'fullBurstEnd'}),
        (r'^バーストスキルを使用した時', {'kind': 'burst'}),
        (r'^バーストスキル使用時', {'kind': 'burst'}),
        (r'^味方がバーストスキルを使用した時', {'kind': 'allyBurst'}),
        (r'^敵を倒した時', {'kind': 'enemyDeath'}),
        (r'^最後の弾丸で攻撃した時', {'kind': 'lastBullet'}),
        (r'^最大弾数のリロードが完了した時', {'kind': 'reload'}),
        (r'^フルチャージした時', {'kind': 'fullChargeShot'}),
        (r'^フルチャージではない通常攻撃を' + NUM + r'回行った時', None, 'attackShots'),
        (r'^フルバーストタイム(?:発動)?中、' + NUM + r'秒ごとに', None, 'periodic'),
        (r'^自分が狙撃モードでなければコアが活性化している', {'kind': 'never'}),
        (r'^フルバーストタイム中のみ、' + NUM + r'秒ごとに', None, 'periodic'),
        (r'^フルチャージ攻撃(?:が)?命中した時', {'kind': 'fullChargeShot'}),
        (r'^フルチャージ攻撃で' + NUM + r'回攻撃した時', None, 'fullChargeN'),
        (r'^フルチャージ攻撃が' + NUM + r'回命中した時', None, 'fullChargeN'),
        (r'^最後の弾丸(?:が)?命中した時', {'kind': 'lastBullet'}),
        (r'^最後の弾丸を発射した時', {'kind': 'lastBullet'}),
        (r'^フルバーストタイム中に通常攻撃した時', {'kind': 'attack', 'duringFullBurst': True}),
        (r'^通常攻撃が命中した時', {'kind': 'attack'}),
        (r'^通常攻撃をした時', {'kind': 'attack'}),
        (r'^通常攻撃時', {'kind': 'attack'}),
        (r'^' + NUM + r'回射撃した時', None, 'attackShots'),
        (r'^' + NUM + r'回攻撃した時', None, 'attackShots'),
        (r'^ペレットごとのクリティカル攻撃が' + NUM + r'回命中した時', None, 'critHits'),
        (r'^通常攻撃が' + NUM + r'回クリティカル命中した時', None, 'critHits'),
        (r'^味方が消費した弾の合計が' + NUM + r'発ごとに', None, 'ammoConsumed'),
        (r'^フルチャージ状態を\d+秒以上維持して' + NUM + r'回攻撃した時', None, 'fullChargeN'),
        (r'^フルチャージ攻撃が適正射程距離内の対象に命中した時', {'kind': 'fullChargeShot'}),
        (r'^最後の弾丸.*フルチャージ攻撃が命中した時', {'kind': 'lastBullet'}),
        (r'^ターゲットが出現', {'kind': 'never'}),
        (r'^デコイが存在する時' + NUM + r'秒ごとに', None, 'periodic'),
        (r'^デコイが存在する時', {'kind': 'never'}),
        (r'^コアに' + NUM + r'回命中した時', {'kind': 'never'}),
        (r'^対象のパーツに命中した時', {'kind': 'never'}),
        (r'^自分を含む味方の誰かがパーツを破壊した時', {'kind': 'never'}),
        (r'^バースト(\d)段階突入時', None, 'burstStage'),
        (r'^フルチャージして攻撃した時', {'kind': 'fullChargeShot'}),
        (r'^フルチャージで' + NUM + r'回攻撃した時', None, 'fullChargeN'),
        (r'^通常攻撃が' + NUM + r'回命中した時', None, 'attackHits'),
        (r'^通常攻撃で' + NUM + r'回攻撃した時', None, 'attackShots'),
        (r'^ペレットが' + NUM + r'回命中した時', None, 'pelletHits'),
        (r'^' + NUM + r'回攻撃を受けた時', None, 'hitsTaken'),
        (r'^撃たれた時', {'kind': 'hitTaken'}),
        (r'^攻撃した時', {'kind': 'attack'}),
        (r'^リロードした時', {'kind': 'reload'}),
        (r'^' + NUM + r'秒ごとに', None, 'periodic'),
        (r'^自分のHPが' + NUM + r'%以下', None, 'selfHpBelow'),
        (r'^自分のHPが' + NUM + r'%以上', None, 'selfHpAbove'),
        (r'^味方が倒れた時', {'kind': 'allyDeath'}),
        (r'^敵が倒れた時', {'kind': 'enemyDeath'}),
        (r'^自分が倒れた時', {'kind': 'selfDeath'}),
        (r'^戦闘不能に至る攻撃を受けると', {'kind': 'lethalHit'}),
        (r'^戦闘開始時', {'kind': 'battleStart'}),
        (r'^被弾した時', {'kind': 'hitTaken'}),
    ]
    for rule in rules:
        pat = rule[0]
        m = re.match(pat, t)
        if not m:
            continue
        if len(rule) >= 3:
            kind = rule[2]
            val = float(m.group(1)) if m.groups() else None
            if kind in ('attackHits', 'attackShots', 'pelletHits', 'hitsTaken',
                        'critHits', 'ammoConsumed'):
                return {'kind': 'counter', 'on': kind, 'n': val}
            if kind == 'periodic':
                return {'kind': 'periodic', 'seconds': val}
            if kind == 'selfHpBelow':
                return {'kind': 'selfHpBelow', 'pct': val}
            if kind == 'selfHpAbove':
                return {'kind': 'selfHpAbove', 'pct': val}
            if kind == 'burstStage':
                return {'kind': 'burstStage', 'stage': int(val)}
            if kind == 'fullChargeN':
                return {'kind': 'counter', 'on': 'fullCharge', 'n': val}
            return {'kind': kind}
        return dict(rule[1])

    m = re.search(r'(\d+)%の確率で', t)
    if m:
        base = parse_trigger(re.sub(r'\d+%の確率で', '', t), slot, ct)
        base['chance'] = float(m.group(1))
        return base

    # Unrecognised condition. Never fall back to "every frame": a block whose
    # trigger we do not understand must not fire at all.
    if re.search(r'(時|なら|場合|のみ|状態)', t):
        return {'kind': 'unknown', 'text': t}

    if ct and ct != 'パッシブ':
        mct = re.search(NUM, ct)
        if mct:
            return {'kind': 'periodic', 'seconds': float(mct.group(1))}
        return {'kind': 'always'}

    return {'kind': 'always'}


def parse_condition(text):
    t = text
    conds = []
    m = re.search(r'自分のHPが' + NUM + r'%以上', t)
    if m:
        conds.append({'kind': 'selfHpAbove', 'pct': float(m.group(1))})
    m = re.search(r'自分のHPが' + NUM + r'%以下', t)
    if m:
        conds.append({'kind': 'selfHpBelow', 'pct': float(m.group(1))})
    m = re.search(r'残りのHPの割合が最も低い味方(\d)機がHP' + NUM + r'%以下', t)
    if m:
        conds.append({'kind': 'allyLowestHpBelow', 'n': int(m.group(1)), 'pct': float(m.group(2))})
    return conds


# --------------------------------------------------------------------------
# skill -> blocks
# --------------------------------------------------------------------------

def parse_skill(infos, slot, ct, treasure):
    blocks = []
    header = []
    effects = []
    last_trigger = [None]

    def flush():
        if not header and not effects:
            return
        hdr = ''.join(header).strip()
        target, trig_text = parse_target(hdr) if hdr else (
            ({'side': 'self', 'sel': 'all', 'pick': None, 'count': None,
              'excludeSelf': False, 'weapon': None, 'element': None, 'classType': None}),
            '')
        trigger = parse_trigger((trig_text or hdr) if hdr else '', slot, ct)
        # 対象句の手前で切れた条件（「フルバーストタイム発動中、」など）は、
        # ヘッダ全体でもう一度試す。
        if hdr and trigger.get('kind') == 'always':
            alt = parse_trigger(hdr, slot, ct)
            if alt.get('kind') != 'always':
                trigger = alt
        # 「3回:」「6回:」のような発動回数の指定は、対象句より前に置かれる
        m0 = re.match(r'^(\d+)回[：:]', hdr)
        if m0 and trigger.get('kind') not in ('burst', 'periodic'):
            trigger['nth'] = int(m0.group(1))
        # 条件が「、」より前に無い書き方（例: 対象が気絶状態→…なら同一の敵に）を
        # 条件なし扱いにしてしまうと、開幕に大ダメージが飛ぶ。必ず条件付きにする。
        # 「自分のHPが◯%以上」は発動条件であって、トリガーではない。
        if trigger.get('kind') in ('selfHpAbove', 'selfHpBelow'):
            trigger = {'kind': 'always', 'conditions': [dict(trigger)]}
        if hdr and not trig_text and trigger.get('kind') in ('always', 'burst')                 and re.search(r'(なら|時|場合|のみ|状態)', hdr):
            # 「自分のHPが90%以上の時のみ味方全体に」のように、
            # 条件と対象が続けて書かれているものは常時発動＋条件として扱う。
            lead = re.match(r'^自分のHPが' + NUM + r'%[以上以下]', hdr)
            if lead:
                trigger = {'kind': 'always'}
            else:
                trigger = {'kind': 'unknown', 'text': hdr}

        # 「自分に」「味方全体に」だけの行は、直前の条件を引き継ぐ。
        # 例: 「フルバーストタイムが発動した時、敵全体に」→「自分に」
        if trigger.get('kind') == 'always' and last_trigger[0] is not None                 and hdr and re.fullmatch(r'[^、]{1,20}に', hdr)                 and not re.search(r'(時|なら|場合|のみ|状態)', hdr):
            nth = trigger.get('nth')
            trigger = dict(last_trigger[0])
            if nth:
                trigger['nth'] = nth
        elif trigger.get('kind') not in ('always', 'battleStart', 'unknown', 'periodic'):
            last_trigger[0] = dict(trigger)
        conds = parse_condition(hdr)
        if conds:
            trigger.setdefault('conditions', []).extend(conds)

        # 確率はヘッダ全体に書かれていることがある
        mc = re.search(r'(' + NUM + r')%の確率で', hdr or '')
        if mc and 'chance' not in trigger:
            trigger['chance'] = float(mc.group(1))

        # バーストスキルの効果は、バーストした時にだけ発動する。
        # 「常時」になっていると、バーストしていない間も効いてしまう。
        if slot == 'burst' and trigger.get('kind') == 'always':
            trigger['kind'] = 'burst'
        real = [e for e in effects if e and e.get('op') != 'meta']
        if not real:
            return
        # 常時発動のままダメージを持つブロックは、条件の読み落とし。
        # そのまま動かすと毎フレーム大ダメージになるので発動させない。
        if trigger.get('kind') == 'always' and any(e.get('op') == 'damage' for e in real):
            trigger = {'kind': 'unknown', 'text': hdr or '(damage)'}
        blocks.append({
            'trigger': trigger,
            'target': target,
            'effects': real,
            'raw': hdr,
        })

    for note in infos:
        for text, is_treasure in split_lines(note):
            if is_treasure and not treasure:
                # treasure-only line: skip for base form
                continue
            if text.startswith('・'):
                body = text.lstrip('・').strip()
                # a bulleted line that is really a target header
                if (body.endswith('に') or body.endswith('、')) and '%' not in body \
                        and not re.search(r'(ダメージ|回復|維持|▲|▼|解除|無敵|挑発|気絶)', body):
                    flush()
                    header = [body]
                    effects = []
                    continue
                effects.append(parse_effect(text, treasure))
                continue
            # header (or continuation)
            if effects or header:
                flush()
                header = []
                effects = []
            header.append(text)
    flush()
    return blocks


# --------------------------------------------------------------------------

def main():
    if len(sys.argv) < 3:
        raise SystemExit('usage: compile_skills.py <bundle.txt> <out.js>')
    bundle_path, out_path = sys.argv[1], sys.argv[2]
    chars = read_bundle(bundle_path)

    out = {}
    stats = {'blocks': 0, 'effects': 0, 'unparsed': 0, 'unparsed_samples': [], 'triggers': {}}

    for c in chars:
        orgid = c.get('orgid')
        ct = {
            'skill1': c.get('skill1Ct') or 'パッシブ',
            'skill2': c.get('skill2Ct') or 'パッシブ',
            'burst': c.get('burstCt') or 'パッシブ',
        }
        for form in (False, True):
            key = ('%d' % orgid) if not form else ('%d*' % orgid)
            skills = {}
            for slot in ('skill1', 'skill2', 'burst'):
                blocks = parse_skill(c.get(slot + 'Infos') or [], slot, ct[slot], form)
                skills[slot] = {'ct': ct[slot], 'blocks': blocks}
                for b in blocks:
                    stats['blocks'] += 1
                    stats['triggers'][b['trigger'].get('kind')] = stats['triggers'].get(b['trigger'].get('kind'), 0) + 1
                    for e in b['effects']:
                        stats['effects'] += 1
                        if e.get('op') == 'unparsed':
                            stats['unparsed'] += 1
                            if len(stats['unparsed_samples']) < 120:
                                stats['unparsed_samples'].append(e.get('raw'))
            out[key] = skills

    js = 'window.SKILL_DB = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n'
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(js)

    report = []
    report.append('characters %d  forms %d' % (len(chars), len(out)))
    report.append('blocks %d  effects %d  unparsed %d (%.1f%%)' % (
        stats['blocks'], stats['effects'], stats['unparsed'],
        100.0 * stats['unparsed'] / max(1, stats['effects'])))
    report.append('triggers: ' + json.dumps(stats['triggers'], ensure_ascii=False))
    report.append('')
    report.append('--- unparsed samples ---')
    report.extend(stats['unparsed_samples'])
    with open(out_path.rsplit('.', 1)[0] + '_report.txt', 'w', encoding='utf-8') as f:
        f.write('\n'.join(report))
    print('effects %d unparsed %d' % (stats['effects'], stats['unparsed']))


if __name__ == '__main__':
    main()
