/* NIKKE Champion Arena — battle simulation.
 *
 * Time: 1 frame = 1/60 s. The gauge engine (gauge.js) uses the same units and
 * treats one rocket-launcher cycle as 74 frames.
 *
 * Arena rules baked in:
 *   - no core hits and no effective-range bonus (PvP has neither)
 *   - defence is subtracted, never divided
 *   - damage groups are additive inside, multiplicative across
 *   - burst fires B1 -> B2 -> B3 with a 32-frame gap, then FULL BURST for 10 s
 */
window.Combat = (function () {
  'use strict';

  var FPS = 60;
  var RL_FRAMES = 74;
  var MAX_FRAMES = 60 * FPS;        // arena round limit, 60 s
  var FULL_BURST_FRAMES = 10 * FPS;
  var CRIT_RATE = 0.15;
  var CRIT_DAMAGE = 0.5;
  var BURST_GAP = 32;
  var GAUGE_DELAY = 24;

  var ELEMENT_BEATS = { '灼熱': '風圧', '風圧': '水冷', '水冷': '灼熱', '電撃': '鉄甲', '鉄甲': '電撃' };

  /* ---------------------------------------------------------------- random */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ----------------------------------------------------------------- units */
  function burstStagesOf(char) {
    var s = String(char.burstStage || '');
    return /B[123]/.test(s) ? (s.match(/B[123]/g) || []) : ['B1', 'B2', 'B3'];
  }

  function burstMultiplier(unit) {
    var b = unit.char.burst;
    if (!b) return 0;
    return (unit.treasure && b.multiplierUpgraded) ? b.multiplierUpgraded : b.multiplier;
  }

  function makeUnit(char, side, pos, opts) {
    var gear = (side === 'B' ? (opts.gearB || opts.gear) : opts.gear) || {};
    var atkScale = gear.atk == null ? 2.0 : gear.atk;
    var hpScale = gear.hp == null ? 1.5 : gear.hp;
    var defScale = gear.def == null ? 1.5 : gear.def;
    var base = char.baseStats || { attack: 90000, hp: 2000000, defense: 13000 };
    var passives = char.passiveBuffs || {};

    var unit = {
      char: char,
      id: char.id,
      name: char.name,
      side: side,
      pos: pos,
      weapon: char.weapon,
      element: char.element,
      treasure: !!char.treasure,
      stages: burstStagesOf(char),

      attack: (base.attack || 90000) * atkScale,
      hpMax: (base.hp || 2000000) * hpScale,
      defense: (base.defense || 13000) * defScale,
      hp: 0,
      alive: true,
      deathFrame: null,

      passiveAtkPct: Math.min(200, passives.atkPct || 0),
      passiveDefPct: Math.min(300, passives.defPct || 0),
      passiveTeamDamagePct: Math.min(100, passives.atkDmgPct || 0),

      timedAtkPct: 0, timedAtkUntil: -1,
      timedDamagePct: 0, timedDamageUntil: -1,
      timedDefPct: 0, timedDefUntil: -1,
      timedTakenReduction: 0, timedTakenReductionUntil: -1,
      takenUpPct: 0,

      invulnerableUntil: -1,
      stunnedUntil: -1,
      tauntingUntil: -1,
      lastHitBy: null,

      nextFrame: 0,
      interval: RL_FRAMES,
      shotsInMagazine: 0,
      magazine: Infinity,
      reloadFrames: 0,

      shots: 0,
      bursts: 0,
      damageDealt: 0,
      damageTaken: 0,
      healed: 0,

      hpSeries: [],
      damageSeries: []
    };
    unit.hp = unit.hpMax;
    unit.hpSeries = [[0, unit.hpMax]];
    unit.damageSeries = [[0, 0]];
    return unit;
  }

  /* ------------------------------------------------------------- schedules */
  function scheduleFor(unit) {
    var sched;
    try {
      sched = Gauge.buildSchedule(unit.char, unit.pos, 'attack');
    } catch (e) {
      sched = { firstFrame: 60, interval: RL_FRAMES };
    }
    unit.nextFrame = sched.firstFrame || 0;
    unit.interval = sched.interval || RL_FRAMES;
    unit.chargeFrames = sched.chargeFrames || 0;

    var stats = unit.char.stats || {};
    if (unit.weapon === 'RL' || unit.weapon === 'SR') {
      unit.magazine = Infinity;     // charge weapons never reload in this model
      unit.reloadFrames = 0;
    } else {
      unit.magazine = Math.max(1, Math.floor(Number(stats.magazine) || 1));
      unit.reloadFrames = Math.round((Number(stats.reloadSeconds) || 0) * FPS);
    }
    unit.shotsInMagazine = 0;
  }

  function advanceShot(unit, frame) {
    unit.shotsInMagazine += 1;
    if (isFinite(unit.magazine) && unit.shotsInMagazine >= unit.magazine && unit.reloadFrames > 0) {
      unit.shotsInMagazine = 0;
      var reloadEnd = frame + unit.reloadFrames;
      unit.nextFrame = (unit.weapon === 'RL' || unit.weapon === 'SR')
        ? reloadEnd + (unit.interval || unit.chargeFrames || 0)
        : reloadEnd;
      return;
    }
    unit.nextFrame = frame + unit.interval;
  }

  /* ---------------------------------------------------------------- damage */
  function activeAt(untilField, valueField, unit, frame) {
    return unit[untilField] >= frame ? unit[valueField] : 0;
  }

  /* One damage instance.
   *   ignoreDefence : 防御力無視ダメージ — no defence subtraction
   *   bonusPct      : extra additive ダメージ▲ (e.g. Trina's 根張り)
   */
  function dealDamage(attacker, target, multiplierPct, ctx) {
    ctx = ctx || {};
    var frame = ctx.frame;
    if (!target || !target.alive) return 0;
    if (target.invulnerableUntil >= frame) return 0;

    var atkBuff = attacker.passiveAtkPct +
      activeAt('timedAtkUntil', 'timedAtkPct', attacker, frame);
    var attack = attacker.attack * (1 + atkBuff / 100);

    var defBuff = target.passiveDefPct +
      activeAt('timedDefUntil', 'timedDefPct', target, frame);
    var defence = target.defense * (1 + defBuff / 100);

    var base = ctx.ignoreDefence ? attack : Math.max(1, attack - defence);

    var bonus = 1;
    if (ctx.fullBurst) bonus += 0.5;
    if (ctx.rng && ctx.rng() < CRIT_RATE) {
      bonus += CRIT_DAMAGE + ((attacker.char.passiveBuffs || {}).critDmgPct || 0) / 100;
    }

    var elemental = ELEMENT_BEATS[attacker.element] === target.element ? 1.1 : 1.0;

    var damageUp = 1 + (attacker.passiveTeamDamagePct +
      activeAt('timedDamageUntil', 'timedDamagePct', attacker, frame) +
      (ctx.bonusPct || 0)) / 100;

    var reduction = activeAt('timedTakenReductionUntil', 'timedTakenReduction', target, frame);
    var taken = Math.max(0.15, 1 + (target.takenUpPct || 0) / 100 - reduction / 100);

    var raw = base * (multiplierPct / 100) * bonus * elemental * damageUp * taken;
    var dealt = Math.max(0, raw);

    target.hp = Math.max(0, target.hp - dealt);
    target.damageTaken += dealt;
    attacker.damageDealt += dealt;
    if (dealt > 0) target.lastHitBy = attacker;
    return dealt;
  }

  /* -------------------------------------------------------------- targeting */
  function aliveOf(team) {
    return team.filter(function (u) { return u.alive; });
  }

  function pickTarget(attacker, enemies, frame) {
    var alive = aliveOf(enemies);
    if (!alive.length) return null;

    var taunting = alive.filter(function (u) { return u.tauntingUntil >= frame; });
    if (taunting.length) {
      taunting.sort(function (a, b) { return a.pos - b.pos; });
      return taunting[0];
    }
    // leftmost by default; snipers and shotguns open on the right
    var rightFirst = attacker.weapon === 'SR' || attacker.weapon === 'SG';
    var sorted = alive.slice().sort(function (a, b) {
      return rightFirst ? b.pos - a.pos : a.pos - b.pos;
    });
    return sorted[0];
  }

  function splashTargets(enemies, primary, count) {
    var alive = aliveOf(enemies).slice().sort(function (a, b) { return a.pos - b.pos; });
    var index = alive.indexOf(primary);
    var out = [];
    for (var d = 1; d <= count; d++) {
      if (alive[index - d]) out.push(alive[index - d]);
      if (alive[index + d]) out.push(alive[index + d]);
    }
    return out;
  }

  /* ----------------------------------------------------------------- burst */
  function resolveChain(team) {
    var sequence = Gauge.burstSequence(team.map(function (u) { return u.char; }));
    return sequence.map(function (step) {
      return {
        pos: step.positionIndex,
        stage: step.stage,
        name: step.characterName,
        unit: team[step.positionIndex]
      };
    });
  }

  function runBurst(unit, enemies, homeTeam, frame, ctx) {
    var profile = unit.char.burst;
    var multiplier = burstMultiplier(unit);
    var scope = (profile && profile.scope) || 'single';
    var damageType = (profile && profile.damageType) || '通常';
    var hits = [];

    if (multiplier > 0) {
      var targets;
      if (scope === 'all') {
        targets = aliveOf(enemies);
      } else if (scope === 'n') {
        var count = (profile && profile.targetCount) || 1;
        targets = aliveOf(enemies).slice().sort(function (a, b) { return a.pos - b.pos; })
          .slice(0, count);
      } else {
        var one = pickTarget(unit, enemies, frame);
        targets = one ? [one] : [];
      }
      targets.forEach(function (target) {
        var dealt = dealDamage(unit, target, multiplier, {
          frame: frame,
          ignoreDefence: damageType === '防御力無視',
          bonusPct: ctx.burstDamageBonusPct,
          rng: ctx.rng
        });
        hits.push({ target: target.name, damage: dealt });
      });
    }

    applyBurstEffects(unit, homeTeam, enemies, frame, ctx);

    // a burst's own buffs last 10 s
    var own = unit.char.burstBuffs || {};
    if (own.atkPct) unit.timedAtkPct = Math.min(300, own.atkPct);
    if (own.atkDmgPct) unit.timedDamagePct = Math.min(300, own.atkDmgPct);
    if (own.atkPct || own.atkDmgPct) {
      unit.timedAtkUntil = frame + 10 * FPS;
      unit.timedDamageUntil = frame + 10 * FPS;
    }

    unit.bursts += 1;
    return {
      frame: frame, multiplier: multiplier, scope: scope, damageType: damageType,
      hits: hits,
      total: hits.reduce(function (a, h) { return a + h.damage; }, 0)
    };
  }

  function applyBurstEffects(unit, homeTeam, enemies, frame, ctx) {
    var effects = unit.char.burstEffects || [];

    function targetsFor(target) {
      if (target === 'team') return homeTeam;
      if (target === 'enemyAll' || target === 'enemy' || target === 'enemySome') return aliveOf(enemies);
      return [unit];
    }

    effects.forEach(function (effect) {
      var until = frame + (effect.duration || 10) * FPS;
      targetsFor(effect.target).forEach(function (target) {
        if (!target) return;
        switch (effect.kind) {
          case 'takenRed':
            if (effect.value >= activeAt('timedTakenReductionUntil', 'timedTakenReduction', target, frame)) {
              target.timedTakenReduction = effect.value;
              target.timedTakenReductionUntil = until;
            }
            ctx.mark(target, 'takenRed', frame, until);
            break;
          case 'invuln':
            if (effect.target === 'self' ? target === unit : effect.target === 'team') {
              target.invulnerableUntil = Math.max(target.invulnerableUntil, until);
              ctx.mark(target, 'invuln', frame, until);
            }
            break;
          case 'taunt':
            target.tauntingUntil = Math.max(target.tauntingUntil, until);
            ctx.mark(target, 'taunt', frame, until);
            break;
          case 'defUp':
            target.timedDefPct = Math.max(activeAt('timedDefUntil', 'timedDefPct', target, frame), effect.value);
            target.timedDefUntil = until;
            break;
          case 'atkUp':
            target.timedAtkPct = Math.max(activeAt('timedAtkUntil', 'timedAtkPct', target, frame), effect.value);
            target.timedAtkUntil = until;
            break;
          case 'dmgUp':
            target.timedDamagePct = Math.max(activeAt('timedDamageUntil', 'timedDamagePct', target, frame), effect.value);
            target.timedDamageUntil = until;
            break;
          case 'takenUp':
            target.takenUpPct = Math.max(target.takenUpPct || 0, Math.min(60, effect.value));
            break;
          case 'heal':
            var before = target.hp;
            target.hp = Math.min(target.hpMax, target.hp + target.hpMax * effect.value / 100);
            target.healed += target.hp - before;
            break;
        }
      });
    });

    if (((unit.char.burst && unit.char.burst.effects) || []).indexOf('気絶') >= 0) {
      aliveOf(enemies).forEach(function (target) {
        var until = frame + 3 * FPS;
        if (until > target.stunnedUntil) {
          target.stunnedUntil = until;
          ctx.mark(target, 'stun', frame, until);
        }
      });
    }
  }

  /* ------------------------------------------------------------------- run */
  function run(teamA, teamB, opts) {
    opts = opts || {};
    var rng = mulberry32(opts.seed || 12345);

    var A = [], B = [];
    for (var i = 0; i < 5; i++) {
      if (teamA[i]) A.push(makeUnit(teamA[i], 'A', i, opts));
      if (teamB[i]) B.push(makeUnit(teamB[i], 'B', i, opts));
    }
    if (!A.length || !B.length) return { error: '両チームに1機以上必要です' };

    A.concat(B).forEach(scheduleFor);
    if (opts.jitter !== false) {
      A.concat(B).forEach(function (u) { u.nextFrame += Math.floor(rng() * 3); });
    }

    var state = {
      A: { gauge: 0, rate: gaugeRate(A), chain: null, chainIndex: 0, fullBurstUntil: -1, nextStageFrame: 0 },
      B: { gauge: 0, rate: gaugeRate(B), chain: null, chainIndex: 0, fullBurstUntil: -1, nextStageFrame: 0 },
      burstDamageBonusPct: Number(opts.burstDamageBonusPct) || 0,
      rng: rng
    };

    var events = [];
    var burstEvents = [];
    var statuses = [];
    state.mark = function (unit, kind, from, to) {
      statuses.push({ side: unit.side, pos: unit.pos, kind: kind, from: from, to: to });
    };
    state.A.mark = state.mark;
    state.B.mark = state.mark;

    var teamOf = { A: A, B: B };
    var frame = 0;
    var winner = null;

    while (frame <= MAX_FRAMES) {
      // ---- gauge
      ['A', 'B'].forEach(function (side) {
        var st = state[side];
        if (st.chain && st.chainIndex < st.chain.length) return;
        var team = teamOf[side];
        var alive = aliveOf(team).length;
        if (!alive) return;
        st.gauge += st.rate * (alive / team.length);
        if (st.gauge >= 100) {
          st.gauge -= 100;
          st.chain = resolveChain(team);
          st.chainIndex = 0;
          st.nextStageFrame = frame + GAUGE_DELAY;
        }
      });

      // ---- burst stages
      ['A', 'B'].forEach(function (side) {
        var st = state[side];
        if (!st.chain) return;
        var enemies = side === 'A' ? B : A;
        while (st.chainIndex < st.chain.length &&
               frame >= st.nextStageFrame + st.chainIndex * BURST_GAP) {
          var step = st.chain[st.chainIndex++];
          if (!step.unit || !step.unit.alive) continue;
          var result = runBurst(step.unit, enemies, teamOf[side], frame, state);
          result.side = side;
          result.stage = step.stage;
          result.name = step.unit.name;
          burstEvents.push(result);
          events.push({ frame: frame, kind: 'burst', side: side,
                        unit: step.unit.name, pos: step.unit.pos, stage: step.stage });
          if (step.stage === 'B3') {
            st.fullBurstUntil = frame + FULL_BURST_FRAMES;
            state.mark(step.unit, 'fb', frame, st.fullBurstUntil);
          }
        }
        if (st.chainIndex >= st.chain.length) st.chain = null;
      });

      // ---- normal attacks
      var shooters = A.concat(B).filter(function (u) {
        return u.alive && u.nextFrame === frame;
      });
      shooters.forEach(function (unit) {
        if (unit.stunnedUntil >= frame) { advanceShot(unit, frame); return; }
        var enemies = unit.side === 'A' ? B : A;
        var st = state[unit.side];
        var target = pickTarget(unit, enemies, frame);
        if (!target) return;
        var weaponMultiplier = (unit.char.stats && unit.char.stats.weaponDamage) || 100;
        var ctx = { frame: frame, fullBurst: frame <= st.fullBurstUntil, rng: rng };
        dealDamage(unit, target, weaponMultiplier, ctx);
        if (unit.weapon === 'RL') {
          splashTargets(enemies, target, 1).forEach(function (extra) {
            dealDamage(unit, extra, weaponMultiplier * 0.4, ctx);
          });
        }
        unit.shots += 1;
        recordSeries(A, frame);
        recordSeries(B, frame);
        advanceShot(unit, frame);
      });

      // ---- deaths
      A.concat(B).forEach(function (unit) {
        if (unit.alive && unit.hp <= 0) {
          unit.alive = false;
          unit.deathFrame = frame;
          var killer = unit.lastHitBy;
          events.push({
            frame: frame, kind: 'death', side: unit.side, unit: unit.name, pos: unit.pos,
            killer: killer ? killer.name : null,
            killerSide: killer ? killer.side : null,
            killerPos: killer ? killer.pos : null
          });
        }
      });

      if (!aliveOf(A).length || !aliveOf(B).length) {
        if (!aliveOf(A).length && !aliveOf(B).length) winner = 'draw';
        else winner = aliveOf(A).length ? 'A' : 'B';
        break;
      }
      frame += 1;
    }

    recordSeries(A, frame);
    recordSeries(B, frame);

    if (!winner) {
      var ratioA = remainingHpRatio(A), ratioB = remainingHpRatio(B);
      winner = Math.abs(ratioA - ratioB) < 0.05 ? 'draw' : (ratioA > ratioB ? 'A' : 'B');
      events.push({ frame: frame, kind: 'timeout' });
    }

    return {
      winner: winner,
      frames: frame,
      units: A.concat(B),
      teams: { A: A, B: B },
      events: events,
      bursts: burstEvents,
      statuses: statuses,
      hpRatio: { A: remainingHpRatio(A), B: remainingHpRatio(B) },
      survivors: { A: aliveOf(A).length, B: aliveOf(B).length }
    };
  }

  function gaugeRate(team) {
    try {
      var result = Gauge.simulate(team.map(function (u) { return u.char; }),
        { side: 'attack', region: 'cn' });
      if (result && result.fullFrame) return 100 / result.fullFrame;
    } catch (e) { /* fall through to a sane default */ }
    return 100 / 220;
  }

  function recordSeries(team, frame) {
    team.forEach(function (unit) {
      var lastHp = unit.hpSeries[unit.hpSeries.length - 1];
      if (!lastHp || lastHp[0] !== frame) unit.hpSeries.push([frame, unit.hp]);
      else lastHp[1] = unit.hp;
      var lastDamage = unit.damageSeries[unit.damageSeries.length - 1];
      if (!lastDamage || lastDamage[0] !== frame) unit.damageSeries.push([frame, unit.damageDealt]);
      else lastDamage[1] = unit.damageDealt;
    });
  }

  function remainingHpRatio(team) {
    var total = 0, current = 0;
    team.forEach(function (u) { total += u.hpMax; current += u.hp; });
    return total ? current / total : 0;
  }

  /* Many seeded trials -> a win rate. One run is one sample, and the outcome of
   * a single deterministic run is not an answer to "does this composition win". */
  function runMany(teamA, teamB, opts, trials) {
    opts = opts || {};
    trials = Math.max(1, Math.min(500, trials || 100));
    var winsA = 0, winsB = 0, draws = 0;
    var runs = [], frames = [];

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
    var sample = runs[0], bestDistance = Infinity;
    runs.forEach(function (r) {
      var d = Math.abs(r.frames - median) + (r.winner === 'A' ? 0 : 60);
      if (d < bestDistance) { bestDistance = d; sample = r; }
    });

    return {
      trials: trials, winsA: winsA, winsB: winsB, draws: draws,
      winRate: (winsA + draws * 0.5) / trials,
      medianFrames: median,
      sample: sample
    };
  }

  return {
    run: run,
    runMany: runMany,
    RL_FRAMES: RL_FRAMES,
    MAX_FRAMES: MAX_FRAMES,
    ELEMENT_BEATS: ELEMENT_BEATS
  };
})();
