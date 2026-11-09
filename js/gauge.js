/* NIKKE burst-gauge engine — frame-accurate shot schedule and gauge accumulation.
 * Derived from an open-source PvP burst-speed engine; names kept for traceability. */
window.Gauge = (function () {
'use strict';

/* ------------------------------------------------------------------ *
 * Constants lifted from app.min.js (names preserved)
 * ------------------------------------------------------------------ */
const Kt = 0;                 // reference target position (0) used in hit math
const St = 1e-6;              // charge threshold epsilon
const Eg = 32;                // frames between burst stages (zy)
const Cg = { cn: 24, global: 26 }; // burst delay after gauge is full
const Ah = 1.0466;            // quantum relic cube burst-gen multiplier
const vi = 10;                // max Red Hood charge-speed stacks
const Es = 3.81;              // Red Hood % per stack
const Cs = 13.01;             // Emilia second-shot charge speed
const Eb = 10;                // Laplace:UH % per hit
const bh = 0.06;              // Anis: Star supplement factor
const Ti = [{ frame: 96, shots: 12 }, { frame: 126, shots: 9 }]; // MG warm-up
const Rc = 128, ld = 2;       // MG steady state
// charge-speed lookup used by the game for a 60F charge, 0..25 %
const Ts = new Map([[0, 60], [1, 60], [2, 58], [3, 58], [4, 58], [5, 56], [6, 56], [7, 56],
  [8, 54], [9, 54], [10, 54], [11, 52], [12, 52], [13, 52], [14, 52], [15, 50], [16, 50],
  [17, 50], [18, 48], [19, 48], [20, 48], [21, 46], [22, 46], [23, 46], [24, 46], [25, 44]]);

/* ------------------------------------------------------------------ *
 * Core frame math
 * ------------------------------------------------------------------ */

// Charge frames after charge-speed. This is the heart of the whole engine.
function Jt(frames, chargeSpeedPercent = 0) {
  if (!frames) return frames;
  const a = Math.round(Number(chargeSpeedPercent) || 0);
  if (a === 0) return frames;   /* 負の値はチャージが遅くなる（そのまま計算する） */
  if (frames === 60 && a <= 25 && Ts.has(a)) return Ts.get(a);
  // 100%を超えると間隔が負になるので、そこは下限で止める
  const pct = Math.min(a, 100);
  return Math.max(2, Math.floor(frames / 2 * (1 - pct / 100)) * 2);
}

// charge frames + the non-charge part of the cycle (turn / release)
function la(frames, extra, chargeSpeedPercent = 0) {
  return Jt(frames, chargeSpeedPercent) + (Number(extra) || 0);
}

/* ------------------------------------------------------------------ *
 * Character predicates (ids are the game's ids)
 * ------------------------------------------------------------------ */
const P = {
  isRedHood: c => c.id === 111 || c.name === '小红帽' || c.slug === '小红帽',
  isAnisStar: c => c.id === 2 || c.enName === 'Anis: Star',
  isRaven: c => c.id === 59 || c.enName === 'Raven',
  isA2: c => c.id === 32,
  isLaplaceUH: c => Number.parseInt(String(c.id), 10) === 213 ||
    String(c.enName || '').includes('Laplace Ultimate'),
  isVestiTU: c => c.id === 87,
  isCinderella: c => c.id === 169,
  isLiberalio: c => c.id === 26,
  isRapiRH: c => c.id === 181,
  isSnowWhiteHA: c => c.id === 3,
  isPascal: c => c.enName === 'Pascal',
  isHarran: c => c.id === 57,
  isScarletBS: c => c.id === 56,
  isRosanna: c => c.id === 170,
  isEmilia: c => c.id === 11,
  isNoah: c => c.id === 12,
  isNoise: c => c.id === 49,
  isPiercing: c => !!c.hasPenetration,
};

const STAGES = Object.freeze(['B1', 'B2', 'B3']);

function br(c) { // available burst stages
  if (P.isRedHood(c)) return [...STAGES];
  return String(c.burstStage || '').split('/').map(s => s.trim()).filter(s => STAGES.includes(s));
}
function zo(stage) {
  const i = STAGES.indexOf(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

/* ------------------------------------------------------------------ *
 * Burst gauge value of a single hit
 * ------------------------------------------------------------------ */
function El(c) { return !!c.hasExtraDamage && c.extraDamageTargetMode === 'body'; }
// "extra damage" -> the gauge counts the hit twice (body-mode extra damage excludes it)
function dn(c) { return El(c) ? false : (!!c.hasExtraDamage || !!c.hasExtraChargeEffect); }

function gS(c) { // RL explosion hit count (with the x2 hit weighting)
  const r = Number.isFinite(c.rlExplosionRange) ? c.rlExplosionRange : 1;
  const a = Math.max(0, Kt - r);
  return (Math.min(4, Kt + r) - a + 1) * 2;
}
function ao(c) { // "number of hit positions" for the display formula
  if (P.isCinderella(c)) return 1;
  if (c.widePierceTargetCount === 3 && c.hasPenetration) return 6;
  if (c.weapon === 'RL') return gS(c);
  if (c.weapon === 'SG') return 10;
  return 1;
}
function Cl(c) { // extra body hits (body-target extra damage only)
  if (!El(c)) return 0;
  if (c.weapon === 'RL') {
    const r = Number.isFinite(c.rlExplosionRange) ? c.rlExplosionRange : 1;
    return Math.min(4, Kt + r) - Math.max(0, Kt - r) + 1;
  }
  return 1;
}
function ia(c) { // per-bullet burst gen
  const bg = (Number(c.burstGen) || 0) * (c.quantumRelicCubeEnabled ? Ah : 1);
  return (c.weapon === 'SG' ? bg / 10 : bg) + (c.superstarChargeSupplementValue || 0);
}
// gauge of one shot when we do not model individual enemy targets
function Zn(c) {
  return ia(c) * (ao(c) + Cl(c)) * (dn(c) ? 2 : 1) + (c.flatBurstBonus || 0);
}

/* ------------------------------------------------------------------ *
 * Firing schedule  (Or in app.min.js)
 * ------------------------------------------------------------------ */
function qc(pos, side, arenaMode) { // projectile flight adjustment by position
  if (arenaMode === 'c') return pos <= 2 ? 0 : 2;
  if (side === 'defense') return pos <= 1 ? 0 : pos <= 3 ? 2 : 4;
  return pos <= 1 ? 0 : 2;
}
function zc(c) {
  if (Number.isFinite(c.projectileFlightBaseFrames)) return c.projectileFlightBaseFrames;
  return (c.timing && c.timing.projectileFlightFramesByPosition && c.timing.projectileFlightFramesByPosition.P1) || 16;
}
function jo(c, pos, side, arenaMode) { // projectile flight frames
  const mode = arenaMode || 'normal';
  if ((c.timing && c.timing.projectileFlightFramesByPosition) || Number.isFinite(c.projectileFlightBaseFrames)) {
    return Math.max(0, zc(c) - qc(pos, side, mode));
  }
  if (Number.isFinite(c.projectileFlightFrames)) return c.projectileFlightFrames;
  return Math.max(0, zc(c) - qc(pos, side, mode));
}
function Bd(c) { // attack release frames
  const n = Number(c.attackReleaseFrames != null ? c.attackReleaseFrames : (c.timing && c.timing.attackReleaseFrames));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}
function canApplyChargeSpeed(c) { // Vi(): only RL/SR, not Pascal / Snow White:HA
  return (c.weapon === 'RL' || c.weapon === 'SR') && !P.isPascal(c) && !P.isSnowWhiteHA(c);
}

function buildSchedule(c, pos, side, arenaMode) {
  const n = canApplyChargeSpeed(c) ? (Number(c.chargeSpeedPercent) || 0) : 0;
  const r = Bd(c);
  const t = c.timing || {};

  if (c.weapon === 'MG') return { firstFrame: Ti[0].frame, interval: ld, reloadInterval: null, chargeFrames: 0, baseChargeFrames: 0, baseIntervalFrames: 0, projectileFlightFrames: 0, attackReleaseFrames: r };

  if (t.firstFrame !== null && t.firstFrame !== undefined && t.intervalFrames !== null && t.intervalFrames !== undefined) {
    const l = t.chargeFrames != null ? t.chargeFrames : 0;
    const d = Jt(l, n);
    const f = t.turnFrames != null ? l + r + t.turnFrames : t.intervalFrames;
    const p = Math.max(0, f - l);
    const h = la(l, p, n);

    const hasFlight = c.weapon === 'RL' &&
      (P.isLaplaceUH(c) || t.projectileFlightFramesByPosition ||
        Number.isFinite(c.projectileFlightFrames) || Number.isFinite(c.projectileFlightBaseFrames));

    if (hasFlight) {
      const b = jo(c, pos, side, arenaMode);
      const first = c.firstFrameOverride != null ? c.firstFrameOverride : d + r + b;
      if (P.isVestiTU(c)) {
        // guided burst: one charge then kn = 0/22/44/66 frames of follow-up shots
        return { firstFrame: first, interval: d + r + 66, reloadInterval: null, chargeFrames: d, baseChargeFrames: l, baseIntervalFrames: f, projectileFlightFrames: b, attackReleaseFrames: r };
      }
      return {
        firstFrame: first,
        interval: c.attackIntervalFrames || h,
        reloadInterval: P.isCinderella(c) ? first : null,
        chargeFrames: d,
        baseChargeFrames: l,
        baseIntervalFrames: f,
        projectileFlightFrames: b,
        attackReleaseFrames: r,
      };
    }
    if (c.weapon === 'SR' || c.weapon === 'RL') {
      if (c.weapon === 'SR' && P.isLiberalio(c)) {
        const ai = Number(c.attackIntervalFrames);
        const gap = Number.isFinite(ai) ? Math.max(0, ai - l + r) : Math.max(0, f - l);
        return { firstFrame: c.firstFrameOverride != null ? c.firstFrameOverride : d + r, interval: la(l, gap, n), chargeFrames: d, baseChargeFrames: l, baseIntervalFrames: l + gap, attackReleaseFrames: r };
      }
      return {
        firstFrame: c.firstFrameOverride != null ? c.firstFrameOverride : d + r,
        interval: c.attackIntervalFrames || h,
        chargeFrames: d,
        baseChargeFrames: l,
        baseIntervalFrames: f,
        attackReleaseFrames: r,
      };
    }
    return { firstFrame: t.firstFrame, interval: t.intervalFrames, chargeFrames: d, baseChargeFrames: l, baseIntervalFrames: f, attackReleaseFrames: r };
  }

  // no per-character timing -> weapon defaults
  const o = typeof c.stats.chargeSeconds === 'number' ? Math.round(c.stats.chargeSeconds * 60) : null;
  const s = Jt(o != null ? o : 60, n);
  if (c.weapon === 'SMG') return { firstFrame: 0, interval: 4, chargeFrames: 0 };
  if (c.weapon === 'AR') return { firstFrame: 0, interval: 6, chargeFrames: 0 };
  if (c.weapon === 'SG') return { firstFrame: 0, interval: 42, chargeFrames: 0 };
  if (c.weapon === 'SR') {
    const turn = c.turnFrames != null ? c.turnFrames : 16;
    const base = o != null ? o : 60;
    const gap = turn + r;
    return { firstFrame: c.firstFrameOverride != null ? c.firstFrameOverride : Jt(base, n) + r, interval: la(base, gap, n), chargeFrames: s, baseChargeFrames: base, baseIntervalFrames: base + gap, attackReleaseFrames: r };
  }
  if (c.weapon === 'RL') {
    const b = jo(c, pos, side, arenaMode);
    const turn = c.turnFrames != null ? c.turnFrames : 16;
    const base = o != null ? o : 60;
    return { firstFrame: c.firstFrameOverride != null ? c.firstFrameOverride : Jt(base, n) + r + b, interval: c.attackIntervalFrames || la(base, turn + r, n), chargeFrames: s, baseChargeFrames: base, baseIntervalFrames: base + turn + r, projectileFlightFrames: b, attackReleaseFrames: r };
  }
  throw new Error('unknown weapon: ' + c.weapon);
}

/* ------------------------------------------------------------------ *
 * Hit model for one shot (ib in app.min.js), attack side default
 * ------------------------------------------------------------------ */
function targetPosition(c, side) {
  const rule = c.targetRule ? c.targetRule[side === 'defense' ? 'defense' : 'attack'] : null;
  return (rule === '↖' || rule === '↘') ? 4 : Kt;
}
function fS(c, pos, targetPos, cinderellaPos) { return targetPos === cinderellaPos ? 3 : 2; }

const Ho = [true, false, false, false, true, true];
const _c = [false, false, false, false, true, true];
function pS(e = 1) { // Cinderella's every-6th-shot double-hit pattern
  const t = Math.max(1, Math.floor(Number(e) || 1));
  if (t <= Ho.length) return Ho[t - 1];
  const a = (t - Ho.length - 1) % _c.length;
  return _c[a];
}
function bl(pos, count, seq) { return [[pos, count * (pS(seq) ? 2 : 1)]]; }

function shotTargets(c, hitsParam, pos, hitCounter, cindPos) {
  const t = hitsParam;
  const s = c.weapon === 'SG' ? t * 10 : t;
  const l = Math.max(0, Math.min(4, targetPosition(c, sideGlobal)));
  if (P.isCinderella(c)) {
    // fixed single-target hit, doubled every 5th/6th attack (pS)
    const p = bl(l, t, hitCounter);
    return { targetHits: p, bodyHits: p };
  }
  if (c.weapon === 'RL') {
    const range = Number.isFinite(c.rlExplosionRange) ? c.rlExplosionRange : 1;
    const from = Math.max(0, l - range), to = Math.min(4, l + range);
    const hits = [];
    for (let x = from; x <= to; x++) hits.push([x, t * fS(c, x, l, cindPos)]);
    return { targetHits: hits, bodyHits: hits.map(([x]) => [x, t]) };
  }
  if (c.widePierceTargetCount === 3 && c.hasPenetration) {
    const start = Math.min(Math.max(0, l - 1), 2);
    const hits = Array.from({ length: 3 }, (_, k) => [start + k, t * 2]);
    return { targetHits: hits, bodyHits: hits.map(([x]) => [x, t]) };
  }
  // penetration
  const pierce = P.isHarran(c) && hitCounter <= 1 ? 0 : (c.hasPenetration ? 1 : 0);
  if (pierce > 0) return { targetHits: [[l, t * (1 + pierce)]], bodyHits: [[l, t]] };
  return { targetHits: [[l, s]], bodyHits: [[l, s]] };
}
let sideGlobal = 'attack';

function shotCharge(c, targets, hitsParam) {
  const r = targets.targetHits.reduce((n, [, v]) => n + (Number(v) || 0), 0);
  const o = El(c) ? targets.bodyHits.reduce((n, [, v]) => n + (Number(v) || 0), 0) : 0;
  const mult = dn(c) ? 2 : 1;
  return ia(c) * (r + o) * mult + (c.flatBurstBonus || 0) * hitsParam;
}

/* ------------------------------------------------------------------ *
 * Simulation (Ut in app.min.js, stripped of PvP interference:
 * dodges / stuns / taunts / sacrifice / universal slots)
 * ------------------------------------------------------------------ */
function simulate(team, opts = {}) {
  const side = opts.side || 'attack';
  sideGlobal = side;
  const region = opts.region || 'cn';
  const speedArr = opts.speeds || [];
  const cubeArr = opts.cubes || [];

  // Anis: Star charges the whole team (dS)
  const anisStar = team.find(c => c && P.isAnisStar(c));
  const superstarSupp = anisStar ? Math.round((Number(anisStar.burstGen) || 0) * bh * 1e10) / 1e10 : 0;

  const members = [];
  team.forEach((raw, pos) => {
    if (!raw) return;
    const c = Object.assign({}, raw, {
      chargeSpeedPercent: canApplyChargeSpeed(raw)
        ? (Number(speedArr[pos]) || Number(raw.chargeSpeedPercent) || 0)
        : 0,
      quantumRelicCubeEnabled: (cubeArr[pos] || 'none') === 'quantum',
      superstarChargeSupplementValue: superstarSupp,
      hasPenetration: P.isRedHood(raw) ? false : raw.hasPenetration,
    });
    const j = buildSchedule(c, pos, side, opts.arenaMode);
    members.push({
      character: c, positionIndex: pos,
      nextFrame: j.firstFrame,
      interval: j.interval,
      reloadInterval: j.reloadInterval != null ? j.reloadInterval : j.interval,
      chargeFrames: j.chargeFrames,
      baseChargeFrames: j.baseChargeFrames != null ? j.baseChargeFrames : j.chargeFrames,
      baseIntervalFrames: j.baseIntervalFrames != null ? j.baseIntervalFrames : j.interval,
      projectileFlightFrames: j.projectileFlightFrames || 0,
      chargeValue: Zn(c),
      hits: 0, shotsInMagazine: 0, redHoodChargeSpeedStacks: 0, mgWarmupIndex: c.weapon === 'MG' ? 0 : null,
      totalCharge: 0, shots: [], hitFrames: [],
      // hb(): RL/SR never reload
      magazine: (c.weapon === 'RL' || c.weapon === 'SR') ? Infinity : (Math.floor(Number(c.stats.magazine) || 0) || 0),
      reloadFrames: Math.round((Number(c.stats.reloadSeconds) || 0) * 60),
      emiliaFired: false,
    });
  });

  const isRLorSR = c => c.weapon === 'RL' || c.weapon === 'SR';
  const cindPos = opts.cinderellaPosition != null ? opts.cinderellaPosition : null; // 5v5 default: none

  // --- shot cadence helpers (Tb / vb / Mb / nu) ---
  function baseNext(m, frame) {
    const c = m.character, a = 1;
    if (c.weapon === 'MG') {
      if (m.mgWarmupIndex < Ti.length - 1) { m.mgWarmupIndex += 1; return Ti[m.mgWarmupIndex].frame; }
      m.mgWarmupIndex += 1;
      return m.nextFrame < Rc ? Rc : m.nextFrame + ld;
    }
    if (P.isRedHood(c)) {
      m.redHoodChargeSpeedStacks = Math.min(vi, (Number(m.redHoodChargeSpeedStacks) || 0) + a);
      const cf = m.baseChargeFrames || m.chargeFrames || 0;
      const gap = Math.max(0, (m.baseIntervalFrames || m.interval) - cf);
      const s = (Number(c.chargeSpeedPercent) || 0) + m.redHoodChargeSpeedStacks * Es;
      return frame + la(cf, gap, s);
    }
    if (P.isLaplaceUH(c) && m.hits > 0) {
      const cf = m.baseChargeFrames || m.chargeFrames || 0;
      const gap = Math.max(0, (m.baseIntervalFrames || m.interval) - cf);
      const st = Math.min(5, Math.max(0, Math.trunc(m.hits)));
      return frame + la(cf, gap, (Number(c.chargeSpeedPercent) || 0) + st * Eb);
    }
    if (P.isEmilia(c) && m.hits > 0) {
      const cf = m.baseChargeFrames || m.chargeFrames || 0;
      const gap = Math.max(0, (m.baseIntervalFrames || m.interval) - cf);
      return frame + la(cf, gap, (Number(c.chargeSpeedPercent) || 0) + Cs);
    }
    return frame + m.interval;
  }
  function afterShot(m, frame, hits) {
    const c = m.character;
    const o = baseNext(m, frame);
    m.shotsInMagazine += hits;
    if (Number.isFinite(m.magazine) && m.magazine > 0 && m.reloadFrames > 0 && m.shotsInMagazine >= m.magazine) {
      m.shotsInMagazine %= m.magazine;
      const reloadEnd = frame + m.reloadFrames;
      // Mb(): RL/SR wait a full cycle after the reload, others fire at reload end
      m.nextFrame = isRLorSR(c) ? reloadEnd + (m.reloadInterval || m.chargeFrames || m.interval) : reloadEnd;
      return;
    }
    m.nextFrame = o;
  }

  let E = 0, I = 0, fullFrame = null, fullCharge = 0;
  let delayed = [];
  let guard = 0;

  while (E < 100 - St && I <= 10000) {
    if (++guard > 200000) throw new Error('simulation did not converge');
    // hitCountExtraEvents with a delay are queued as future gauge events
    const memberFrames = members.map(m => m.nextFrame);
    const delayedFrames = delayed.map(e => e.frame);
    const next = Math.min(...memberFrames, ...(delayedFrames.length ? delayedFrames : [Infinity]));
    if (!Number.isFinite(next)) break;
    I = next;

    // process queued delayed events at this frame
    const due = delayed.filter(e => e.frame === I);
    delayed = delayed.filter(e => e.frame !== I);
    for (const ev of due) {
      const m = members.find(x => x.character.id === ev.character.id);
      if (!m) continue;
      E += ev.chargeValue; m.totalCharge += ev.chargeValue;
      if (ev.repeatFrames > 0) delayed.push(Object.assign({}, ev, { frame: I + ev.repeatFrames }));
    }

    for (const m of members) {
      if (m.nextFrame !== I) continue;
      const x = m.character.weapon !== 'MG' ? 1 : (Ti[m.mgWarmupIndex] ? Ti[m.mgWarmupIndex].shots : 1);
      m.hits += x;
      m.hitFrames.push(x > 1 ? `${I}x${x}` : I);
      const nbSeq = P.isCinderella(m.character) ? m.shotsInMagazine + x : m.hits;
      const targets = shotTargets(m.character, x, m.positionIndex, nbSeq, cindPos);
      const charge = shotCharge(m.character, targets, x);
      E += charge; m.totalCharge += charge;
      m.shots.push({ frame: I, hits: x, charge, total: E });

      // Vesti: Tactical Upgrade — one charge, then 4 guided shots (kn = 0/22/44/66)
      if (P.isVestiTU(m.character)) {
        for (let k = 1; k < 4; k++) {
          delayed.push({ character: m.character, frame: I + 22 * k, chargeValue: charge, repeatFrames: 0 });
        }
      }

      // hit-count bonus charge (delayFrames 0 = now, >0 = queued)
      const extras = (m.character.hitCountExtraEvents || []).filter(a => {
        const hitN = Number.isFinite(Number(a.hit)) ? Math.trunc(Number(a.hit)) : 0;
        if (hitN > 0) return hitN === m.hits;
        const every = Number.isFinite(Number(a.every)) ? Math.trunc(Number(a.every)) : 0;
        return every > 1 && m.hits % every === 0;
      });
      for (const a of extras) {
        const segs = Number(a.segments) || 0;
        const val = ia(m.character) * segs * (dn(m.character) ? 2 : 1);
        if (Number(a.delayFrames) > 0) delayed.push({ character: m.character, frame: I + Number(a.delayFrames), chargeValue: val, repeatFrames: 0 });
        else { E += val; m.totalCharge += val; }
      }
      // delayedExtraHits (QA): separate follow-up attacks
      if (!P.isHarran(m.character) && !P.isRaven(m.character)) {
        for (const d of (m.character.delayedExtraHits || [])) {
          const val = ia(m.character) * (Number(d.segments) || 0) * (dn(m.character) ? 2 : 1);
          delayed.push({ character: m.character, frame: I + Number(d.delayFrames), chargeValue: val, repeatFrames: 0 });
        }
      }
      afterShot(m, I, x);
    }

    if (fullFrame === null && E >= 100 - St) { fullFrame = I; fullCharge = E; }
  }

  if (fullFrame === null) return { error: 'gauge did not fill within 10000F', members };

  const seq = burstSequence(team).map((s, k) => Object.assign({}, s, {
    frame: fullFrame + Cg[region === 'global' ? 'global' : 'cn'] + Math.max(0, k) * Eg,
  }));

  return {
    fullFrame,
    fullCharge,
    burstSequence: seq,
    burst1Frame: seq[0] ? seq[0].frame : null,
    burst2Frame: seq[1] ? seq[1].frame : null,
    burst3Frame: seq[2] ? seq[2].frame : null,
    totalCharge: E,
    members,
  };
}

/* ------------------------------------------------------------------ *
 * Per-unit firing driver
 *
 * `simulate` above runs a whole team to find the burst frame. The battle
 * engine needs the same cadence one shot at a time, so the cadence helpers
 * are lifted here and exposed. They mirror `simulate` exactly, including the
 * MG warm-up table, Red Hood's charge-speed stacks, Laplace and Emilia.
 * ------------------------------------------------------------------ */
function liftBaseNext(m, frame) {
  const c = m.character;
  if (c.weapon === 'MG') {
    if (m.mgWarmupIndex < Ti.length - 1) { m.mgWarmupIndex += 1; return Ti[m.mgWarmupIndex].frame; }
    m.mgWarmupIndex += 1;
    return m.nextFrame < Rc ? Rc : m.nextFrame + ld;
  }
  if (P.isRedHood(c)) {
    m.redHoodChargeSpeedStacks = Math.min(vi, (Number(m.redHoodChargeSpeedStacks) || 0) + 1);
    const cf = m.baseChargeFrames || m.chargeFrames || 0;
    const gap = Math.max(0, (m.baseIntervalFrames || m.interval) - cf);
    const s = (Number(c.chargeSpeedPercent) || 0) + m.redHoodChargeSpeedStacks * Es;
    return frame + la(cf, gap, s);
  }
  if (P.isLaplaceUH(c) && m.hits > 0) {
    const cf = m.baseChargeFrames || m.chargeFrames || 0;
    const gap = Math.max(0, (m.baseIntervalFrames || m.interval) - cf);
    const st = Math.min(5, Math.max(0, Math.trunc(m.hits)));
    return frame + la(cf, gap, (Number(c.chargeSpeedPercent) || 0) + st * Eb);
  }
  if (P.isEmilia(c) && m.hits > 0) {
    const cf = m.baseChargeFrames || m.chargeFrames || 0;
    const gap = Math.max(0, (m.baseIntervalFrames || m.interval) - cf);
    return frame + la(cf, gap, (Number(c.chargeSpeedPercent) || 0) + Cs);
  }
  /* ふつうの武器: チャージ速度は戦闘中に変わるので、その都度引き直す */
  const cf0 = m.baseChargeFrames || m.chargeFrames || 0;
  if (!cf0) return frame + m.interval;
  const gap0 = Math.max(0, (m.baseIntervalFrames || m.interval) - cf0);
  return frame + la(cf0, gap0, Number(c.chargeSpeedPercent) || 0);
}

function liftAfterShot(m, frame, hits) {
  const c = m.character;
  const o = liftBaseNext(m, frame);
  m.shotsInMagazine += hits;
  if (Number.isFinite(m.magazine) && m.magazine > 0 && m.reloadFrames > 0 && m.shotsInMagazine >= m.magazine) {
    m.shotsInMagazine %= m.magazine;
    const reloadEnd = frame + m.reloadFrames;
    m.nextFrame = (c.weapon === 'RL' || c.weapon === 'SR')
      ? reloadEnd + (m.reloadInterval || m.chargeFrames || m.interval)
      : reloadEnd;
    m.reloadingUntil = m.nextFrame;
    return true;
  }
  m.nextFrame = o;
  return false;
}

/** Create the firing state for one unit. `side` is 'attack' or 'defense'. */
function createFiring(char, pos, side, o) {
  o = o || {};
  sideGlobal = side;
  const c = Object.assign({}, char, {
    chargeSpeedPercent: canApplyChargeSpeed(char)
      ? (Number(o.chargeSpeedPercent) || Number(char.chargeSpeedPercent) || 0) : 0,
    quantumRelicCubeEnabled: o.quantumCube === true,
    superstarChargeSupplementValue: Number(o.superstarSupplement) || 0,
    hasPenetration: P.isRedHood(char) ? false : char.hasPenetration,
  });
  const j = buildSchedule(c, pos, side, o.arenaMode);
  return {
    character: c, positionIndex: pos, side,
    nextFrame: j.firstFrame, interval: j.interval,
    reloadInterval: j.reloadInterval != null ? j.reloadInterval : j.interval,
    chargeFrames: j.chargeFrames,
    baseChargeFrames: j.baseChargeFrames != null ? j.baseChargeFrames : j.chargeFrames,
    baseIntervalFrames: j.baseIntervalFrames != null ? j.baseIntervalFrames : j.interval,
    projectileFlightFrames: j.projectileFlightFrames || 0,
    chargeValue: Zn(c), hits: 0, shotsInMagazine: 0, redHoodChargeSpeedStacks: 0,
    baseChargeSpeed: c.chargeSpeedPercent,
    mgWarmupIndex: c.weapon === 'MG' ? 0 : null,
    totalCharge: 0, shots: 0, reloadingUntil: -1,
    magazine: (c.weapon === 'RL' || c.weapon === 'SR')
      ? Infinity : (Math.floor(Number(c.stats.magazine) || 0) || 0),
    reloadFrames: Math.round((Number(c.stats.reloadSeconds) || 0) * 60),
  };
}

/** Fire one shot at `frame`. Returns hit distribution and gauge charge. */
function fireFiring(m, frame) {
  sideGlobal = m.side;
  const c = m.character;
  const x = c.weapon !== 'MG' ? 1 : (Ti[m.mgWarmupIndex] ? Ti[m.mgWarmupIndex].shots : 1);
  m.hits += x;
  const nbSeq = P.isCinderella(c) ? m.shotsInMagazine + x : m.hits;
  const targets = shotTargets(c, x, m.positionIndex, nbSeq, null);
  const charge = shotCharge(c, targets, x);
  m.totalCharge += charge;
  m.shots += 1;
  const reloaded = liftAfterShot(m, frame, x);
  return { hits: x, targetHits: targets.targetHits, charge, reloaded };
}

/* ------------------------------------------------------------------ *
 * Burst chain (Oy / Uy in app.min.js)
 * ------------------------------------------------------------------ */
function burstSequence(team) {
  const list = team.map((c, i) => ({ character: c, positionIndex: i })).filter(x => x.character);
  const used = new Set();
  function rule(c, pos, requested) {
    let avail;
    if (P.isRedHood(c)) avail = [...STAGES];
    else if (P.isRapiRH(c)) avail = [list.some(m => m.positionIndex !== pos && br(m.character).includes('B1')) ? 'B3' : 'B1'];
    else avail = br(c);
    const s = requested && avail.includes(requested) ? requested : (avail[0] || null);
    if (!s) return { stage: null, nextStage: null };
    let nextStage = br(c)[1] || zo(s);
    if (P.isRedHood(c) || P.isRapiRH(c)) nextStage = zo(s);
    if (P.isAnisStar(c) && s === 'B1' && list.some(m => m.positionIndex > pos && br(m.character).includes('B1'))) nextStage = 'B1';
    return { stage: s, nextStage };
  }
  function search(stage, usedSet, depth) {
    if (!STAGES.includes(stage) || depth >= list.length) return [];
    const cand = list
      .filter(m => !usedSet.has(m.positionIndex))
      .map(m => Object.assign({}, m, { rule: rule(m.character, m.positionIndex, stage) }))
      .filter(m => m.rule.stage === stage)
      .sort((a, b) => (P.isRedHood(a.character) ? 1 : 0) - (P.isRedHood(b.character) ? 1 : 0) || a.positionIndex - b.positionIndex);
    let best = [];
    for (const m of cand) {
      const u = new Set(usedSet); u.add(m.positionIndex);
      const tail = search(m.rule.nextStage, u, depth + 1);
      const chain = [{ characterId: m.character.id, characterName: m.character.name, positionIndex: m.positionIndex, stage: m.rule.stage, nextStage: m.rule.nextStage }, ...tail];
      if (chain.length > best.length) best = chain;
    }
    return best;
  }
  return search('B1', used, 0).map((s, i) => Object.assign({}, s, { sequenceIndex: i + 1 }));
}


return { simulate, burstSequence, buildSchedule, Zn, ia, br, P,
         createFiring, fireFiring, targetPosition,
         RL_FRAMES: 74, BURST_DELAY_CN: 24, INTER_STAGE: 32, FPS: 60 };
})();
