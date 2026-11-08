/* アリーナ戦闘シミュレーション.
 *
 * 60fps。1フレーム = 1/60 秒。
 *
 * ダメージ（アリーナ仕様）
 *   基礎 = 最終攻撃力 − 最終防御力        （防御力無視は減算しない）
 *        × 倍率
 *        × ボーナス倍率 (1 + 会心 + フルバースト)   ← ここは加算
 *        × 有利コード
 *        × チャージ倍率
 *        × 与ダメージ群
 *        × 被ダメージ群
 *   グループ内は加算、グループ間は乗算。
 *   アリーナにコアヒットと適正距離は無い。
 */
window.Engine = (function () {
  'use strict';

  var FPS = 60;
  var CRIT_RATE = 0.15;
  var CRIT_DMG = 0.5;
  var FB_BONUS = 0.5;
  var ELEM_BONUS = 0.10;
  var FB_FRAMES = 10 * FPS;
  var BURST_DELAY = 26;   /* ゲージMAX -> B1 は約0.433秒 (26F) */
  var BURST_GAP = 32;
  var DEFAULT_MAX_FRAMES = 180 * FPS;

  /* 属性は3すくみではなく5すくみ:
   *   灼熱 → 風圧 → 鉄甲 → 電撃 → 水冷 → 灼熱
   * 有利なときだけ +10%。不利でも軽減はされない。 */
  var ELEMENT_BEATS = { '灼熱': '風圧', '風圧': '鉄甲', '鉄甲': '電撃', '電撃': '水冷', '水冷': '灼熱' };

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function ctSeconds(ct) {
    if (!ct) return 0;
    var s = String(ct);
    if (s.indexOf('パッシブ') >= 0) return 0;
    var m = s.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  function stagesOf(char) {
    var s = String(char.burstStage || '');
    if (/B123/.test(s)) return ['B1', 'B2', 'B3'];
    var out = s.match(/B[123]/g);
    return out && out.length ? out : ['B1', 'B2', 'B3'];
  }

  /* ------------------------------------------------------------ buff/stat */
  function sumStat(u, stat) {
    var total = 0, now = u.now;
    for (var i = 0; i < u.buffs.length; i++) {
      var b = u.buffs[i];
      if (b.stat !== stat) continue;
      if (b.until < now) continue;
      total += (b.dir === 'down' ? -b.value : b.value) * (b.stacks || 1);
    }
    return total;
  }

  function sumFlat(u, stat) {
    var total = 0, now = u.now;
    for (var i = 0; i < u.buffs.length; i++) {
      var b = u.buffs[i];
      if (b.stat !== stat) continue;
      if (b.until < now) continue;
      total += (b.dir === 'down' ? -b.value : b.value);
    }
    return total;
  }

  function buff(u, key, stat, value, dir, until, opts) {
    opts = opts || {};
    var found = null;
    for (var i = 0; i < u.buffs.length; i++) {
      if (u.buffs[i].key === key && u.buffs[i].stat === stat) { found = u.buffs[i]; break; }
    }
    if (found) {
      found.value = Math.max(found.value, value);
      found.until = Math.max(found.until, until);
      found.dir = dir;
      found.refreshed = u.now;
      var cap = opts.maxStacks || 1;
      if (cap > 1) found.stacks = Math.min(cap, (found.stacks || 1) + 1);
      return found;
    }
    var b = {
      key: key, stat: stat, value: value, dir: dir, until: until,
      stacks: 1, maxStacks: opts.maxStacks || 1,
      aura: !!opts.aura, refreshed: u.now, label: opts.label
    };
    u.buffs.push(b);
    return b;
  }

  function purgeBuffs(u) {
    var now = u.now;
    var keep = [];
    for (var i = 0; i < u.buffs.length; i++) {
      var b = u.buffs[i];
      if (b.until < now) continue;
      if (b.aura && b.refreshed !== now) continue;
      keep.push(b);
    }
    u.buffs = keep;
  }

  function atkEff(u) {
    return u.atk * (1 + sumStat(u, 'atkPct') / 100) + sumFlat(u, 'atkFlat');
  }

  function defEff(u) {
    return u.def * (1 + sumStat(u, 'defPct') / 100);
  }

  function recalcHpMax(u) {
    var pct = sumStat(u, 'maxHpPct');
    var next = Math.round((u.hpMaxBase + sumFlat(u, 'hpFlat')) * (1 + pct / 100));
    if (next === u.hpMax) return;
    var delta = next - u.hpMax;
    u.hpMax = next;
    if (delta > 0) u.hp = Math.min(u.hpMax, u.hp + delta);
    else u.hp = Math.min(u.hp, u.hpMax);
    if (u.hp <= 0) u.hp = 1;
  }

  /* --------------------------------------------------------------- units */
  function makeUnit(char, side, pos, o) {
    var cfg = (o.units && o.units[side + '|' + pos]) || {};
    var st = Stats.compute(char, cfg.stats);
    var mul = (o.cpMul && o.cpMul[side]) || 1;
    var u = {
      char: char,
      id: char.id,
      name: char.name,
      side: side, pos: pos,
      fireSide: side === 'A' ? 'attack' : 'defense',
      weapon: char.weapon,
      element: char.element,
      stages: stagesOf(char),
      atk: Math.round(st.atk * mul),
      def: Math.round(st.def * mul),
      hpMaxBase: Math.round(st.hp * mul),
      hpMax: Math.round(st.hp * mul),
      hp: Math.round(st.hp * mul),
      skillScale: cfg.skillScale || null,
      shield: 0,
      /* 遮蔽物は「射撃していないあいだ身を隠す板」で、実質もう一本のHPバー。
       * 単体攻撃はまず遮蔽物が受け、バーストの範囲攻撃は貫通する。
       * レベル400の実数値は公開されていないため、基礎HPに対する比率で持つ。 */
      coverHp: Math.round(st.hp * (window.COVER_HP_RATIO == null ? 1.0 : window.COVER_HP_RATIO)),
      coverMax: Math.round(st.hp * (window.COVER_HP_RATIO == null ? 1.0 : window.COVER_HP_RATIO)),
      alive: true,
      deathFrame: -1,
      now: 0,
      buffs: [],
      counters: { attackHits: 0, attackShots: 0, pelletHits: 0, hitsTaken: 0, fullCharge: 0 },
      invulnUntil: -1,
      tauntUntil: -1,
      stunUntil: -1,
      shareGroup: null,
      lifestealPct: 0,
      indomitableUntil: -1,
      reviveAtHpPct: 0,
      revived: false,
      burstReadyAt: 0,
      burstStageUsed: null,
      damageDealt: 0,
      damageTaken: 0,
      healed: 0,
      bursts: 0,
      shots: 0,
      hpSeries: [],
      critRateBonus: 0,
      treasure: !!char.treasure,
      skillKey: String(char.orgId) + (char.treasure ? '*' : ''),
      skills: null,
      skillState: [],
      cfg: cfg
    };
    u.firing = Gauge.createFiring(char, pos, u.fireSide, {
      chargeSpeedPercent: cfg.chargeSpeed,
      quantumCube: cfg.quantumCube,
      superstarSupplement: o.superstarSupplement || 0
    });
    // 調和の魔方の固有効果（レベルで3段階）
    if (window.CubeUtil && cfg.cube) {
      var cu = window.CubeUtil;
      var cstat = cu.byId(cfg.cube.id);
      var cval = cu.valueAt(cfg.cube.id, cfg.cube.level);
      if (cstat && cstat.stat && cval) {
        u.buffs.push({
          key: 'cube', stat: cstat.stat, value: Math.abs(cval),
          dir: cval < 0 ? 'down' : 'up', until: Infinity, stacks: 1,
          maxStacks: 1, aura: false, refreshed: 0, label: 'cube'
        });
      }
      var elv = cu.elementAt(cfg.cube.level);
      if (elv) {
        u.buffs.push({
          key: 'cube-element', stat: 'elementDmgPct', value: elv,
          dir: 'up', until: Infinity, stacks: 1, maxStacks: 1,
          aura: false, refreshed: 0, label: 'cube-element'
        });
      }
    }

    /* スノーホワイト：ヘビーアームズ（id 3）.— チャージ中にロックオンと
     * オートファイア装填を貯め、フルチャージ時にまとめて撃ち込む。 */
    if (char.id === 3) {
      u.swha = { locks: [], rounds: 0, maxLocks: 5, maxRounds: 5,
                 fullActive: 0, tick: 0 };
    }

    u.skills = (window.SKILL_DB && window.SKILL_DB[u.skillKey]) || null;
    if (u.skills) {
      ['skill1', 'skill2', 'burst'].forEach(function (slot) {
        var sk = u.skills[slot];
        u.skillState.push({
          slot: slot,
          ct: ctSeconds(sk.ct),
          nextPeriodic: 0,
          blocks: sk.blocks.map(function (b) {
            return { block: b, count: 0, fired: 0, active: false };
          })
        });
      });
    }
    u.hpSeries = [[0, u.hp, u.coverHp]];
    return u;
  }

  /* ------------------------------------------------------------- targeting */
  function alive(team) { return team.filter(function (u) { return u.alive; }); }

  /* 現在のアリーナの狙い方:
   *   SR は攻守どちらでも P5、それ以外（SG を含む）は P1。
   * 2023年ごろの資料には「防衛側のSGはP5」とあるが、現在は統一されている。 */
  function prefersRight(u) {
    return u.weapon === 'SR';
  }

  function pickTarget(u, enemies, frame) {
    var live = alive(enemies);
    if (!live.length) return null;
    var taunting = live.filter(function (t) { return t.tauntUntil >= frame; });
    if (taunting.length) {
      taunting.sort(function (a, b) { return a.pos - b.pos; });
      return taunting[0];
    }
    var right = prefersRight(u);
    live.sort(function (a, b) { return right ? b.pos - a.pos : a.pos - b.pos; });
    return live[0];
  }

  function slotsInRange(enemies, primaryPos, range) {
    var out = [];
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!e.alive) continue;
      if (Math.abs(e.pos - primaryPos) <= range) out.push(e);
    }
    return out;
  }

  /* --------------------------------------------------------------- damage */
  function applyDamage(target, amount, source, frame, ctx) {
    if (!target.alive || amount <= 0) return 0;
    if (target.invulnUntil >= frame) return 0;

    // damage sharing
    if (!ctx.noShare && target.shareGroup && target.shareGroup.length > 1) {
      var group = target.shareGroup.filter(function (x) { return x.alive; });
      if (group.length > 1) {
        var each = amount / group.length;
        var total = 0;
        for (var g = 0; g < group.length; g++) total += applyDamage(group[g], each, source, frame, { noShare: true });
        return total;
      }
    }

    var remaining = amount;

    // 遮蔽物: 範囲バーストは貫通し、単体攻撃はまず遮蔽物が受ける
    var absorbedByCover = 0;
    if (!ctx.piercesCover && target.coverHp > 0) {
      var eaten = Math.min(target.coverHp, remaining);
      target.coverHp -= eaten;
      remaining -= eaten;
      absorbedByCover = eaten;
      target.coverDamage = (target.coverDamage || 0) + eaten;
      if (source) source.damageDealt += eaten;
      if (remaining <= 0) return eaten;
    }

    if (target.shield > 0) {
      var absorbed = Math.min(target.shield, remaining);
      target.shield -= absorbed;
      remaining -= absorbed;
    }
    if (remaining <= 0) return 0;

    if (target.indomitableUntil >= frame && target.hp - remaining <= 0) {
      remaining = Math.max(0, target.hp - 1);
    }

    target.hp -= remaining;
    target.damageTaken += remaining;
    if (absorbedByCover) target.damageTaken += 0;
    if (source) { source.damageDealt += remaining; target.lastHitBy = source; }

    if (source && source.lifestealPct > 0) {
      heal(source, source.lifestealPct / 100 * remaining, frame);
    }
    return remaining;
  }

  function dealDamage(attacker, target, frame, opts) {
    opts = opts || {};
    if (!target || !target.alive) return 0;
    if (target.invulnUntil >= frame) return 0;

    var atk = atkEff(attacker);
    var def = defEff(target);
    var base = opts.ignoreDef ? atk : Math.max(1, atk - def);

    var critChance = CRIT_RATE + sumStat(attacker, 'critRate') / 100;
    var crit = opts.rng() < critChance;

    var bonus = 1;
    if (crit) bonus += CRIT_DMG + sumStat(attacker, 'critDmgPct') / 100;
    if (attacker.side === 'A' ? opts.teamA.fullBurst : opts.teamB.fullBurst) bonus += FB_BONUS;

    var advantage = ELEMENT_BEATS[attacker.element] === target.element;
    var element = 1 + (advantage ? ELEM_BONUS : 0) + (advantage ? sumStat(attacker, 'elementDmgPct') / 100 : 0);

    /* チャージ倍率 = 1 + (武器のチャージ倍率 - 1) × (1 + チャダメ倍率バフ) + チャダメバフ
     * 倍率バフは「武器の基礎チャージ分」にだけ掛かり、加算バフには掛からない。 */
    var charge = 1;
    if (opts.chargeMult) {
      var baseBonus = opts.chargeMult - 1;
      charge = 1 + baseBonus * (1 + sumStat(attacker, 'chargeDmgMultPct') / 100) +
        sumStat(attacker, 'chargeDmgPct') / 100;
    }

    var up = sumStat(attacker, 'atkDmgPct');
    if (opts.isBurst) up += sumStat(attacker, 'burstDmgPct');
    if (opts.isSustained) up += sumStat(attacker, 'sustainedDmgPct');
    if (opts.isPierce) up += sumStat(attacker, 'pierceDmgPct');
    if (opts.ignoreDef) up += sumStat(attacker, 'ignoreDefDmgPct');
    if (opts.isDistributed) up += sumStat(attacker, 'distributedDmgPct');

    var taken = 1 + sumStat(target, 'takenDmgPct') / 100;
    if (taken < 0.05) taken = 0.05;

    var dmg = base * (opts.multiplierPct / 100) * bonus * element * charge * (1 + up / 100) * taken;
    dmg *= opts.scale == null ? 1 : opts.scale;
    return applyDamage(target, dmg, attacker, frame,
      Object.assign({ piercesCover: !!opts.isBurst || !!opts.ignoreDef }, opts));
  }

  function heal(u, amount, frame) {
    if (!u.alive || amount <= 0) return 0;
    var given = amount * (1 + sumStat(u, 'recoveryTakenPct') / 100);
    var before = u.hp;
    u.hp = Math.min(u.hpMax, u.hp + given);
    u.healed += u.hp - before;
    return u.hp - before;
  }

  /* --------------------------------------------------------------- skills */
  function pickBy(list, pick) {
    if (!list.length) return [];
    var sorted = list.slice();
    switch (pick) {
      case 'highestAtk': sorted.sort(function (a, b) { return atkEff(b) - atkEff(a); }); break;
      case 'lowestAtk': sorted.sort(function (a, b) { return atkEff(a) - atkEff(b); }); break;
      case 'lowestHpPct': sorted.sort(function (a, b) { return (a.hp / a.hpMax) - (b.hp / b.hpMax); }); break;
      case 'lowestHp': sorted.sort(function (a, b) { return a.hp - b.hp; }); break;
      case 'highestHp': sorted.sort(function (a, b) { return b.hp - a.hp; }); break;
      case 'highestMaxHp': sorted.sort(function (a, b) { return b.hpMax - a.hpMax; }); break;
      case 'highestDef': sorted.sort(function (a, b) { return defEff(b) - defEff(a); }); break;
      case 'lowestDef': sorted.sort(function (a, b) { return defEff(a) - defEff(b); }); break;
      default: sorted.sort(function (a, b) { return a.pos - b.pos; });
    }
    return sorted;
  }

  function resolveTargets(u, spec, team, enemies, rng, frame) {
    var pool;
    if (spec.side === 'self') return [u];
    if (spec.sel === 'range') {
      // 「攻撃範囲内」= 武器の爆風が届く範囲。全体ではない。
      var rp = pickTarget(u, enemies, frame);
      if (!rp) return [];
      var rr = (u.char.rlExplosionRange == null ? 1 : u.char.rlExplosionRange);
      return slotsInRange(enemies, rp.pos, rr);
    }
    if (spec.sel === 'primary') {
      // 「対象に」= そのとき通常攻撃で狙っている相手
      var pt = pickTarget(u, enemies, frame);
      return pt ? [pt] : [];
    }
    if (spec.side === 'enemy') pool = alive(enemies);
    else pool = alive(team);

    if (spec.excludeSelf) pool = pool.filter(function (x) { return x !== u; });
    if (spec.weapon) pool = pool.filter(function (x) { return x.weapon === spec.weapon; });
    if (spec.element) pool = pool.filter(function (x) { return x.element === spec.element; });
    if (spec.classType) pool = pool.filter(function (x) { return x.char.classType === spec.classType; });
    if (!pool.length) return [];

    if (spec.sel === 'random') {
      var n = spec.count || 1;
      var shuffled = pool.slice();
      for (var i = shuffled.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
      }
      return shuffled.slice(0, n);
    }
    if (spec.count && spec.count < pool.length) {
      return pickBy(pool, spec.pick).slice(0, spec.count);
    }
    if (spec.pick && spec.count === 1) {
      return pickBy(pool, spec.pick).slice(0, 1);
    }
    return pickBy(pool, null);
  }

  function applyEffect(u, effect, targets, team, enemies, frame, ctx) {
    var keyBase = ctx.key + ':' + effect.op + ':' + effect.stat;
    var sf = ctx.scaleFactor == null ? 1 : ctx.scaleFactor;
    effect = Object.assign({}, effect);
    if (sf !== 1 && effect.value != null && effect.op !== 'gaugeCharge') {
      effect.value = effect.value * sf;
    }
    var dur = effect.duration;
    var until = dur == null ? Infinity : frame + dur * FPS;
    if (effect.op === 'stat' && dur === null) until = Infinity;

    switch (effect.op) {
      case 'stat': {
        if (!effect.stat) return;
        var stat = effect.stat;
        if (stat === 'bulletCharge' || stat === 'pelletPct') return;
        for (var i = 0; i < targets.length; i++) {
          var t = targets[i];
          var value = effect.value;
          if (effect.basis === 'caster' && (stat === 'atkPct' || stat === 'defPct' || stat === 'maxHpPct')) {
            // a percentage of the caster's stat, granted to the target as a FLAT value
            var flatKey = stat === 'atkPct' ? 'atkFlat' : stat === 'defPct' ? 'defFlat' : 'hpFlat';
            var basis = stat === 'atkPct' ? atkEff(u)
              : stat === 'defPct' ? defEff(u)
              : u.hpMaxBase;
            buff(t, keyBase + ':' + t.pos, flatKey, basis * value / 100, effect.dir, until, {});
            continue;
          }
          if (effect.dir === 'down' && (stat === 'atkPct' || stat === 'defPct' || stat === 'maxHpPct')) {
            buff(t, keyBase + ':' + t.pos, stat, value, 'down', until, {});
            continue;
          }
          buff(t, keyBase + ':' + t.pos, stat, value, effect.dir || 'up', until,
            { maxStacks: effect.stacks || 1 });
        }
        return;
      }
      case 'flatStat': {
        var amount;
        if (effect.basis === 'casterAtk') amount = atkEff(u) * effect.value / 100;
        else if (effect.basis === 'casterMaxHp') amount = u.hpMaxBase * effect.value / 100;
        else if (effect.basis === 'casterDef') amount = defEff(u) * effect.value / 100;
        else amount = effect.value;
        var fkey = effect.stat === 'atk' ? 'atkFlat' : effect.stat === 'def' ? 'defFlat' : 'hpFlat';
        for (var fj = 0; fj < targets.length; fj++) {
          buff(targets[fj], keyBase + ':' + targets[fj].pos, fkey, amount, effect.dir || 'up', until, {});
        }
        return;
      }
      case 'damage': {
        var ignoreDef = effect.type === 'ignoreDef';
        for (var d = 0; d < targets.length; d++) {
          dealDamage(u, targets[d], frame, {
            multiplierPct: effect.value,
            ignoreDef: ignoreDef,
            isBurst: effect.type === 'burst',
            isSustained: effect.type === 'sustained',
            isPierce: effect.type === 'pierce',
            isDistributed: effect.type === 'distributed',
            rng: ctx.rng,
            scale: ctx.scale,
            teamA: ctx.teamA, teamB: ctx.teamB
          });
        }
        return;
      }
      case 'heal': {
        var amount;
        if (effect.basis === 'casterMaxHp') amount = u.hpMax * effect.value / 100;
        else amount = u.hpMax * effect.value / 100;
        for (var h = 0; h < targets.length; h++) heal(targets[h], amount, frame);
        return;
      }
      case 'shield': {
        for (var s = 0; s < targets.length; s++) {
          var sv = u.hpMax * effect.value / 100;
          targets[s].shield = Math.max(targets[s].shield, sv);
        }
        return;
      }
      case 'taunt': u.tauntUntil = Math.max(u.tauntUntil, until); return;
      case 'invuln': for (var v = 0; v < targets.length; v++) targets[v].invulnUntil = Math.max(targets[v].invulnUntil, until); return;
      case 'stun': for (var st = 0; st < targets.length; st++) targets[st].stunUntil = Math.max(targets[st].stunUntil, until); return;
      case 'shareDamage': {
        var group = [u].concat(targets).filter(function (x, idx, arr) { return arr.indexOf(x) === idx; });
        group.forEach(function (g) { g.shareGroup = group; });
        return;
      }
      case 'lifesteal': u.lifestealPct = Math.max(u.lifestealPct, effect.value); return;
      case 'indomitable': u.indomitableUntil = Math.max(u.indomitableUntil, until === Infinity ? frame + 7 * FPS : until); return;
      case 'revive': u.reviveAtHpPct = Math.max(u.reviveAtHpPct, effect.value); return;
      case 'gaugeCharge': ctx.gaugeCharge(u.side, effect.value); return;
      case 'burstCd': u.burstReadyAt = Math.max(0, u.burstReadyAt - effect.value * FPS); return;
      case 'hpDrain': u.hp = Math.max(1, u.hp - u.hpMax * effect.value / 100); return;
      case 'debuffClear': for (var dc = 0; dc < targets.length; dc++) targets[dc].buffs = targets[dc].buffs.filter(function (b) { return b.value >= 0 && b.dir !== 'down'; }); return;
      default: return;
    }
  }

  function fireSkillBlock(u, sk, state, blockState, team, enemies, frame, ctx) {
    var b = blockState.block;
    var targets = resolveTargets(u, b.target, team, enemies, ctx.rng, frame);
    if (!targets.length && b.target.side !== 'self') return;
    for (var i = 0; i < b.effects.length; i++) {
      applyEffect(u, b.effects[i], targets, team, enemies, frame,
        Object.assign({
          key: u.side + u.pos + ':' + sk.slot + ':' + state.blocks.indexOf(blockState),
          scaleFactor: (u.skillScale && u.skillScale[sk.slot]) || 1
        }, ctx));
    }
    blockState.fired += 1;
  }

  function skillConditionsMet(u, b, frame) {
    var conds = b.trigger.conditions || [];
    for (var i = 0; i < conds.length; i++) {
      var c = conds[i];
      if (c.kind === 'selfHpAbove' && (u.hp / u.hpMax) * 100 < c.pct) return false;
      if (c.kind === 'selfHpBelow' && (u.hp / u.hpMax) * 100 > c.pct) return false;
    }
    return true;
  }

  function runAlwaysSkills(u, team, enemies, frame, ctx) {
    for (var s = 0; s < u.skillState.length; s++) {
      var sk = u.skillState[s];
      var skill = u.skills[sk.slot];
      for (var b = 0; b < sk.blocks.length; b++) {
        var bs = sk.blocks[b];
        var trig = bs.block.trigger || {};
        if (trig.kind !== 'always' && trig.kind !== 'battleStart') continue;
        if (!skillConditionsMet(u, bs.block, frame)) continue;
        if (trig.kind === 'battleStart' && frame > 0) continue;
        // 常時パッシブはダメージを与えない（与えるものは別のトリガーを持つ）
        if (!bs.block.effects.some(function (ef) { return ef.op !== 'damage'; })) continue;
        fireSkillBlock(u, skill, sk, bs, team, enemies, frame, ctx);
      }
    }
  }

  function runPeriodicSkills(u, team, enemies, frame, ctx) {
    for (var s = 0; s < u.skillState.length; s++) {
      var sk = u.skillState[s];
      if (sk.slot === 'burst') continue;
      var skill = u.skills[sk.slot];
      for (var b = 0; b < sk.blocks.length; b++) {
        var bs = sk.blocks[b];
        var trig = bs.block.trigger || {};
        if (trig.kind !== 'periodic') continue;
        var every = (trig.seconds || sk.ct || 20) * FPS;
        if (frame < sk.nextPeriodic) continue;
        sk.nextPeriodic = frame + every;
        if (!skillConditionsMet(u, bs.block, frame)) continue;
        fireSkillBlock(u, skill, sk, bs, team, enemies, frame, ctx);
      }
    }
  }

  function runEventSkills(u, team, enemies, frame, ctx, kind) {
    for (var s = 0; s < u.skillState.length; s++) {
      var sk = u.skillState[s];
      if (sk.slot === 'burst') continue;
      var skill = u.skills[sk.slot];
      for (var b = 0; b < sk.blocks.length; b++) {
        var bs = sk.blocks[b];
        var trig = bs.block.trigger || {};
        if (trig.kind !== kind) continue;
        if (trig.chance != null && ctx.rng() * 100 > trig.chance) continue;
        if (!skillConditionsMet(u, bs.block, frame)) continue;
        fireSkillBlock(u, skill, sk, bs, team, enemies, frame, ctx);
      }
    }
  }

  function runCounterSkills(u, team, enemies, frame, ctx, on) {
    for (var s = 0; s < u.skillState.length; s++) {
      var sk = u.skillState[s];
      if (sk.slot === 'burst') continue;
      var skill = u.skills[sk.slot];
      for (var b = 0; b < sk.blocks.length; b++) {
        var bs = sk.blocks[b];
        var trig = bs.block.trigger || {};
        if (trig.kind !== 'counter' || trig.on !== on) continue;
        var n = trig.n || 1;
        if (u.counters[on] % n !== 0) continue;
        if (!skillConditionsMet(u, bs.block, frame)) continue;
        fireSkillBlock(u, skill, sk, bs, team, enemies, frame, ctx);
      }
    }
  }

  /* Fire every block (in any of the three skills) whose trigger is `kind`. */
  function runTriggered(u, team, enemies, frame, ctx, kind) {
    for (var s = 0; s < u.skillState.length; s++) {
      var sk = u.skillState[s];
      var skill = u.skills[sk.slot];
      for (var b = 0; b < sk.blocks.length; b++) {
        var bs = sk.blocks[b];
        var trig = bs.block.trigger || {};
        if (trig.kind !== kind) continue;
        if (!skillConditionsMet(u, bs.block, frame)) continue;
        fireSkillBlock(u, skill, sk, bs, team, enemies, frame, ctx);
      }
    }
  }

  /* ---------------------------------------------------------------- combat */
  function fireBurst(u, team, enemies, frame, ctx) {
    u.bursts += 1;
    var _spb = (window.SPECIALS || {})[u.id];
    if (_spb && _spb.onBurst) _spb.onBurst(u, ctx.API, frame);

    if (u.swha) {
      u.swha.fullActive = 2;
      u.swha.maxLocks = 10;
      u.swha.maxRounds = 10;
      u.chargeFixed = Math.round(3.2 * FPS);   // セブンスドワーフ・フルアクティブ
      buff(u, 'swha-full', 'chargeDmgPct', 528, 'up', frame + 60 * FPS, {});
    }
    runTriggered(u, team, enemies, frame, ctx, 'burst');
    var ct = u.skillState[2] ? u.skillState[2].ct : 20;
    u.burstReadyAt = frame + (ct > 0 ? ct : 20) * FPS;
    if (u.team) u.team.lastBurst = { unit: u, frame: frame, stage: u.burstStageUsed };
  }

  function resolveChain(team, frame) {
    var masked = team.map(function (u) {
      return (u && u.alive && u.burstReadyAt <= frame) ? u.char : null;
    });
    var seq = null;
    try { seq = Gauge.burstSequence(masked); } catch (e) { seq = null; }
    if (!seq || !seq.length) return [];
    return seq.map(function (s) {
      return { unit: team[s.positionIndex], stage: s.stage };
    }).filter(function (x) { return x.unit && x.unit.alive && x.unit.burstReadyAt <= frame; });
  }

  function buildTeam(chars, side, opts) {
    var team = [];
    for (var i = 0; i < 5; i++) {
      if (chars[i]) team.push(makeUnit(chars[i], side, i, opts));
    }
    return team;
  }

  function run(teamA, teamB, opts) {
    opts = opts || {};
    var rng = mulberry32(opts.seed || 1);
    var maxFrames = opts.maxFrames || DEFAULT_MAX_FRAMES;
    var scale = opts.damageScale == null
      ? (window.DAMAGE_SCALE == null ? 1 : window.DAMAGE_SCALE)
      : opts.damageScale;

    var anisA = teamA.filter(function (c) { return c && c.enName === 'Anis: Star'; })[0];
    var anisB = teamB.filter(function (c) { return c && c.enName === 'Anis: Star'; })[0];

    var cpMul = { A: 1, B: 1 };
    if (opts.cpPenalty) {
      var cpA = opts.cpPenalty.A || 0, cpB = opts.cpPenalty.B || 0;
      var lo = Math.min(cpA, cpB), hi = Math.max(cpA, cpB);
      if (hi > 0 && lo > 0 && lo / hi < 0.846) {
        var penalty = Math.min(0.90, 0.20 + 0.70 * (1 - (lo / hi) / 0.846));
        cpMul[cpA <= cpB ? 'A' : 'B'] = 1 - penalty;
      }
    }

    var A = buildTeam(teamA, 'A', Object.assign({}, opts, {
      cpMul: cpMul,
      superstarSupplement: anisA ? Math.round((Number(anisA.burstGen) || 0) * 0.06 * 1e10) / 1e10 : 0
    }));
    var B = buildTeam(teamB, 'B', Object.assign({}, opts, {
      cpMul: cpMul,
      superstarSupplement: anisB ? Math.round((Number(anisB.burstGen) || 0) * 0.06 * 1e10) / 1e10 : 0
    }));
    if (!A.length || !B.length) return { error: '両チームに1機以上必要です' };

    A.forEach(function (u) { u.team = A; });
    B.forEach(function (u) { u.team = B; });

    var state = {
      A: { gauge: 0, chain: [], chainIndex: 0, fullBurstUntil: -1, fullBurst: false,
           chainFrame: 0, blocked: false, fullAt: -1, gaugeSeries: [[0, 0]] },
      B: { gauge: 0, chain: [], chainIndex: 0, fullBurstUntil: -1, fullBurst: false,
           chainFrame: 0, blocked: false, fullAt: -1, gaugeSeries: [[0, 0]] }
    };
    var events = [];
    var bursts = [];
    var frame = 0;

    /* 固有スキル用の窓口。js/specials/*.js はここだけを使って実装する。 */
    var API = {
      FPS: FPS,
      team: function (u) { return u.side === 'A' ? A : B; },
      enemies: function (u) { return u.side === 'A' ? B : A; },
      alive: alive,
      pickTarget: pickTarget,
      slotsInRange: slotsInRange,
      damage: function (u, t, fr, o) {
        return dealDamage(u, t, fr, Object.assign({
          rng: rng, scale: scale, teamA: state.A, teamB: state.B
        }, o));
      },
      buff: buff,
      heal: heal,
      sumStat: sumStat,
      atkEff: atkEff,
      gauge: function (side, v) { state[side].gauge += v; },
      event: function (obj) { events.push(obj); }
    };
    var SPECIALS = window.SPECIALS || {};
    function specialOf(u) { return SPECIALS[u.id] || null; }

    [A, B].forEach(function (team) {
      team.forEach(function (u) {
        var sp = specialOf(u);
        if (sp && sp.init) sp.init(u, API);
      });
    });

    var ctx = {
      rng: rng,
      API: API,
      scale: scale,
      teamA: state.A,
      teamB: state.B,
      gaugeCharge: function (side, value) { state[side].gauge += value; }
    };

    // battle start auras
    [A, B].forEach(function (team) {
      team.forEach(function (u) {
        u.now = 0;
        runAlwaysSkills(u, team, team === A ? B : A, 0, ctx);
      });
    });

    var winner = null;

    while (frame <= maxFrames) {
      state.A.fullBurst = frame <= state.A.fullBurstUntil;
      state.B.fullBurst = frame <= state.B.fullBurstUntil;

      [A, B].forEach(function (team) {
        team.forEach(function (u) { u.now = frame; });
      });

      // ---- burst chain scheduling
      ['A', 'B'].forEach(function (side) {
        var st = state[side];
        var team = side === 'A' ? A : B;
        if (st.blocked) {
          if (st.fullBurstUntil > 0 && frame > st.fullBurstUntil) {
            st.blocked = false;
            st.fullBurstUntil = -1;
            st.fullAt = -1;
          }
          return;
        }
        if (st.chain.length) return;
        if (st.gauge < 100) return;
        var chain = resolveChain(team, frame);
        if (!chain.length) {
          // gauge is full but no stage is available: it bleeds away
          st.gauge = Math.max(0, st.gauge - 0.35);
          return;
        }
        st.chain = chain;
        st.chainIndex = 0;
        st.gauge = 0;
        st.blocked = true;
      });

      // ---- burst stages due
      ['A', 'B'].forEach(function (side) {
        var st = state[side];
        var team = side === 'A' ? A : B;
        var enemies = side === 'A' ? B : A;
        if (!st.chain.length) return;
        var due = frame - (st.chainFrame || 0);
        if (!st.chainFrame) { st.chainFrame = frame + BURST_DELAY; }
        while (st.chainIndex < st.chain.length &&
               frame >= st.chainFrame + st.chainIndex * BURST_GAP) {
          var step = st.chain[st.chainIndex++];
          var bu = step.unit;
          if (!bu || !bu.alive) continue;
          bu.burstStageUsed = step.stage;
          fireBurst(bu, team, enemies, frame, ctx);
          bursts.push({ frame: frame, side: side, name: bu.name, pos: bu.pos, stage: step.stage });
          events.push({ frame: frame, kind: 'burst', side: side, unit: bu.name, pos: bu.pos, stage: step.stage });
          team.forEach(function (m) {
            if (m !== bu && m.alive) runTriggered(m, team, enemies, frame, ctx, 'allyBurst');
          });
          if (step.stage === 'B3') {
            st.fullBurstUntil = frame + FB_FRAMES;
            st.fullBurst = true;
            team.forEach(function (m) {
              runEventSkills(m, team, enemies, frame, ctx, 'fullBurst');
            });
          }
          team.forEach(function (m) {
            runEventSkills(m, team, enemies, frame, ctx, 'burstStage');
          });
        }
        if (st.chainIndex >= st.chain.length) {
          st.chain = [];
          st.chainIndex = 0;
          st.chainFrame = 0;
          // a chain that never reached B3 never opened Full Burst: refill at once
          if (st.fullBurstUntil < 0) st.blocked = false;
        }
      });

      // ---- periodic skills, reload completion, full-burst end
      [A, B].forEach(function (team) {
        var enemies = team === A ? B : A;
        var side = team === A ? 'A' : 'B';
        var st = state[side];
        if (st.wasFullBurst && !st.fullBurst) {
          team.forEach(function (u) {
            if (u.alive) runTriggered(u, team, enemies, frame, ctx, 'fullBurstEnd');
          });
        }
        st.wasFullBurst = st.fullBurst;
        team.forEach(function (u) {
          if (!u.alive) return;
          runPeriodicSkills(u, team, enemies, frame, ctx);
          if (u.firing.reloadingUntil === frame) {
            runTriggered(u, team, enemies, frame, ctx, 'reload');
          }
        });
      });

      // ---- 固有スキルの毎フレーム処理
      [A, B].forEach(function (team) {
        team.forEach(function (u) {
          if (!u.alive) return;
          u.now = frame;
          var sp = specialOf(u);
          if (sp && sp.tick) sp.tick(u, API, frame);
        });
      });

      // ---- スノーホワイト：ヘビーアームズのロックオン／装填
      [A, B].forEach(function (team) {
        var enemies = team === A ? B : A;
        team.forEach(function (u) {
          if (!u.alive || !u.swha) return;
          u.now = frame;
          var st = u.swha;
          // 射撃の合間（＝チャージ中）だけ貯まる。0.2秒 = 12フレームごと。
          if (u.firing.nextFrame - frame > 1) {
            st.tick += 1;
            if (st.tick % 12 === 0) {
              if (st.rounds < st.maxRounds) st.rounds += 1;
              if (st.locks.length < st.maxLocks) {
                var pool = alive(enemies).filter(function (e) {
                  return st.locks.indexOf(e) < 0;
                });
                if (pool.length) {
                  // 照準線に最も近い＝編成の左
                  pool.sort(function (a, b) { return a.pos - b.pos; });
                  var lock = pool[0];
                  st.locks.push(lock);
                  // ロックオン中の敵は受けるダメージ +4.2%（4秒）
                  buff(lock, 'swha-lock:' + u.pos + ':' + lock.pos, 'takenDmgPct',
                    4.2, 'up', frame + 4 * FPS, {});
                }
              }
              if (st.rounds > 0) {
                buff(u, 'swha-def', 'defPct', 42.24, 'up', frame + 2 * FPS, {});
              }
            }
          } else {
            st.tick = 0;
          }
        });
      });

      // ---- normal shots
      [A, B].forEach(function (team) {
        var enemies = team === A ? B : A;
        var side = team === A ? 'A' : 'B';
        team.forEach(function (u) {
          if (!u.alive || u.firing.nextFrame !== frame) return;
          if (u.stunUntil >= frame) { u.firing.nextFrame = frame + 1; return; }

          u.now = frame;
          u.magazineEff = Math.round(u.firing.magazine * (1 + sumStat(u, 'magazinePct') / 100) + sumStat(u, 'magazineFlat'));
          if (isFinite(u.firing.magazine) && u.magazineEff > 0) u.firing.magazine = u.magazineEff;

          var shot = Gauge.fireFiring(u.firing, frame);
          // チャージ時間固定（スノーホワイト：HA / リバーレリオ など）
          if (u.chargeFixed) u.firing.nextFrame = frame + u.chargeFixed;
          u.shots += 1;
          u.counters.attackShots += 1;
          u.counters.attackHits += shot.hits;
          if (!state[side].blocked) {
            state[side].gauge += shot.charge * (1 + sumStat(u, 'burstGaugePct') / 100);
            if (state[side].gauge > 100) state[side].gauge = 100;
          }

          var primary = pickTarget(u, enemies, frame);
          if (primary) {
            var weaponMult = (u.char.stats && u.char.stats.weaponDamage) || 10;
            var chargeMult = (u.weapon === 'RL' || u.weapon === 'SR')
              ? ((u.char.stats && u.char.stats.maxCharge) || 250) / 100 : null;

            if (u.weapon === 'RL') {
              var range = (u.char.rlExplosionRange == null ? 1 : u.char.rlExplosionRange);
              range += Math.round((range) * sumStat(u, 'explosionRangePct') / 100);
              var targets = slotsInRange(enemies, primary.pos, range);
              for (var t = 0; t < targets.length; t++) {
                dealDamage(u, targets[t], frame, {
                  multiplierPct: weaponMult, chargeMult: chargeMult, rng: rng,
                  scale: scale, teamA: state.A, teamB: state.B
                });
              }
            } else if (u.weapon === 'SG') {
              var pellets = 10;
              for (var p = 0; p < pellets; p++) {
                dealDamage(u, primary, frame, {
                  multiplierPct: weaponMult / 10, chargeMult: null, rng: rng,
                  scale: scale, teamA: state.A, teamB: state.B
                });
              }
            } else {
              dealDamage(u, primary, frame, {
                multiplierPct: weaponMult, chargeMult: chargeMult, rng: rng,
              scale: scale, teamA: state.A, teamB: state.B
              });
            }

            // hit counters on the target side
            primary.counters.hitsTaken += shot.hits;
          }

          var _sp = specialOf(u);
          if (_sp && _sp.onShot) _sp.onShot(u, API, frame, shot);

          // オートファイア: 装填数ぶん、ロックオン対象と全体に撃込む
          if (u.swha && u.swha.rounds > 0) {
            var st2 = u.swha;
            var r = st2.rounds;
            var locked = st2.locks.filter(function (e) { return e.alive; });
            for (var ri = 0; ri < r; ri++) {
              var tgt = locked.length ? locked[ri % locked.length] : null;
              if (tgt) {
                dealDamage(u, tgt, frame, {
                  multiplierPct: 105.59, chargeMult: null, rng: rng,
                  scale: scale, teamA: state.A, teamB: state.B,
                  bonusPct: st2.fullActive > 0 ? 158.4 : 0
                });
              }
              alive(enemies).forEach(function (e) {
                dealDamage(u, e, frame, {
                  multiplierPct: 41.9, chargeMult: null, rng: rng,
                  scale: scale, teamA: state.A, teamB: state.B
                });
              });
            }
            st2.rounds = 0;
            st2.locks = [];
            if (st2.fullActive > 0) {
              st2.fullActive -= 1;
              if (st2.fullActive <= 0) {
                st2.maxLocks = 5;
                st2.maxRounds = 5;
                u.chargeFixed = Math.round(1.2 * FPS);
              }
            }
          }

          if (shot.reloaded) runTriggered(u, team, enemies, frame, ctx, 'lastBullet');
          if (u.weapon === 'RL' || u.weapon === 'SR') {
            u.counters.fullCharge += 1;
            runEventSkills(u, team, enemies, frame, ctx, 'fullChargeShot');
          }
          runEventSkills(u, team, enemies, frame, ctx, 'attack');
          runCounterSkills(u, team, enemies, frame, ctx, 'attackShots');
          runCounterSkills(u, team, enemies, frame, ctx, 'attackHits');

          team.forEach(function (m) {
            if (m.alive) runCounterSkills(m, team, enemies, frame, ctx, 'hitsTaken');
          });
        });
      });

      // ---- hp max buffs, deaths
      [A, B].forEach(function (team) {
        team.forEach(function (u) {
          u.now = frame;
          if (!u.alive) return;
          recalcHpMax(u);
          purgeBuffs(u);
          if (u.hp <= 0) {
            if (u.reviveAtHpPct > 0 && !u.revived) {
              u.revived = true;
              u.hp = u.hpMax * u.reviveAtHpPct / 100;
            } else {
              u.alive = false;
              u.deathFrame = frame;
              var killer = u.lastHitBy;
              events.push({
                frame: frame, kind: 'death', side: u.side, unit: u.name, pos: u.pos,
                killer: killer ? killer.name : null,
                killerSide: killer ? killer.side : null,
                killerPos: killer ? killer.pos : null
              });
              var foes = u.side === 'A' ? B : A;
              foes.forEach(function (m) {
                if (m.alive) runTriggered(m, foes, u.side === 'A' ? A : B, frame, ctx, 'enemyDeath');
              });
            }
          }
        });
      });

      state.A.gaugeSeries.push([frame, state.A.gauge]);
      state.B.gaugeSeries.push([frame, state.B.gauge]);

      // タイムライン用の記録（値が動いたフレームだけ残す）
      [A, B].forEach(function (team) {
        team.forEach(function (u) {
          var last = u.hpSeries[u.hpSeries.length - 1];
          var hp = Math.max(0, u.hp);
          var cov = Math.max(0, u.coverHp);
          if (!last || last[1] !== hp || last[2] !== cov) {
            u.hpSeries.push([frame, hp, cov]);
          }
        });
      });

      var aliveA = alive(A).length, aliveB = alive(B).length;
      if (!aliveA || !aliveB) {
        winner = !aliveA && !aliveB ? 'draw' : (aliveA ? 'A' : 'B');
        break;
      }
      frame += 1;
    }

    if (!winner) {
      var ra = hpRatio(A), rb = hpRatio(B);
      winner = Math.abs(ra - rb) < 0.02 ? 'draw' : (ra > rb ? 'A' : 'B');
      events.push({ frame: frame, kind: 'timeout' });
    }

    [A, B].forEach(function (team) {
      team.forEach(function (u) {
        var last = u.hpSeries[u.hpSeries.length - 1];
        var hp = Math.max(0, u.hp);
        var cov = Math.max(0, u.coverHp);
        if (!last || last[0] !== frame || last[1] !== hp || last[2] !== cov) {
          u.hpSeries.push([frame, hp, cov]);
        }
      });
    });

    return {
      winner: winner,
      frames: frame,
      gauge: { A: state.A.gaugeSeries, B: state.B.gaugeSeries },
      teams: { A: A, B: B },
      events: events,
      bursts: bursts,
      hpRatio: { A: hpRatio(A), B: hpRatio(B) },
      survivors: { A: alive(A).length, B: alive(B).length }
    };
  }

  function hpRatio(team) {
    var total = 0, current = 0;
    team.forEach(function (u) { total += u.hpMax; current += Math.max(0, u.hp); });
    return total ? current / total : 0;
  }

  function runMany(teamA, teamB, opts, trials) {
    opts = opts || {};
    trials = Math.max(1, Math.min(1000, trials || 50));
    var winsA = 0, winsB = 0, draws = 0;
    var frames = [], runs = [];
    for (var i = 0; i < trials; i++) {
      var r = run(teamA, teamB, Object.assign({}, opts, { seed: 1000 + i * 7919 }));
      if (r.error) return r;
      runs.push(r);
      frames.push(r.frames);
      if (r.winner === 'A') winsA++;
      else if (r.winner === 'B') winsB++;
      else draws++;
    }
    var sorted = frames.slice().sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)];
    var sample = runs[0], best = Infinity;
    runs.forEach(function (r) {
      var d = Math.abs(r.frames - median) + (r.winner === 'A' ? 0 : 120);
      if (d < best) { best = d; sample = r; }
    });
    return {
      trials: trials, winsA: winsA, winsB: winsB, draws: draws,
      winRate: (winsA + draws * 0.5) / trials,
      medianFrames: median, sample: sample
    };
  }

  return {
    run: run,
    runMany: runMany,
    FPS: FPS,
    MAX_FRAMES: DEFAULT_MAX_FRAMES,
    ELEMENT_BEATS: ELEMENT_BEATS
  };
})();
