'use strict';
/*
 * Walkers core (proto-c)  --  headless engine for "evolving legged creatures".
 *
 *   physics    : 2-D rigid bodies (capsules), revolute joints solved with soft sequential impulses
 *                (Box2D "soft step" flavour: warm starting, accumulated impulses, relax pass),
 *                implicit spring-damper joint motors with hard torque + speed limits, hard joint limits,
 *                circle-vs-heightfield contact with speculative margin, Coulomb friction, zero restitution.
 *   controller : coupled central pattern generator. One phase oscillator per leg (mean-field Kuramoto coupling with
 *                evolved phase offsets) drives hip / knee / ankle set-points; small pitch feedback for balance.
 *   optimiser  : elitist genetic algorithm on a unit-cube genome (tournament selection, uniform / block crossover,
 *                per-child log-normal Gaussian mutation, 1/5-success-rule adaptive sigma, lineage hues).
 *
 * Conventions: SI units, y up, creatures walk toward +x, angles counter-clockwise positive.
 * Everything is deterministic: seeded PRNG, fixed internal time step, no clocks, no Math.random.
 */
const Walkers = (function () {
  const W = {};
  W.VERSION = '1';

  // =====================================================================================================================
  // 0. Constants
  // =====================================================================================================================
  const GRAV = 9.81;
  const DT = 1 / 60;                  // fixed internal (outer) time step (s): contact detection, controller, bookkeeping
  const MAX_DT = 0.25;                // longest dt accepted by one step() call (longer / non-finite values are clamped / ignored)
  const STEP_RATE = 60;               // = 1 / DT
  const NSUB = 4;                     // soft-step substeps per outer step
  const SUB_DT = DT / NSUB;           // constraint solver step (s)
  const SUB_RATE = 1 / SUB_DT;
  const TWO_PI = 6.283185307179586;
  const INV_TWO_PI = 1 / TWO_PI;
  const HALF_PI = 1.5707963267948966;

  const JOINT_HERTZ = 60, JOINT_ZETA = 2;            // stiffness of the positional (point) joint constraint
  const CONTACT_HERTZ = 30, CONTACT_ZETA = 10;       // contact softness (penetration recovery)
  const CONTACT_PUSH = 1.5;                          // max penetration recovery speed (m/s): cannot catapult bodies
  const CONTACT_SLOP = 0.004;                        // allowed penetration (m)
  const CONTACT_MARGIN = 0.04;                       // speculative contact distance (m)
  const LIN_DAMP = 0.06, ANG_DAMP = 0.2;             // tiny drag (1/s), keeps the world dissipative
  const MAX_W = 60;                                  // hard clamp of body angular speed (rad/s)
  const SETTLE_TIME = 1.5;                           // fitness ignores the first 1.5 s (spawn, ramp-in)
  const TGT_ALPHA = 1 - Math.exp(-DT / 0.03);   // low-pass on joint set-points (~5 Hz): rate limit
  const LIFT_H = 0.025;                  // a foot only counts as lifted when it clears the ground by this much (m)
  const LIFT_MIN = 0.10, LIFT_FLOOR = 0.5;  // stepping requirement (see Sim.score)
  const COMP_BL = 5;                   // forward progress (body lengths) at which the style terms apply in full
  const BIPED_STRICT = 0.3;       // a two-legged shuffle is allowed to be sloppier than a many-legged trot
  const PITCH_ZERO = 0.95;          // torso pitch (rad) at which forward progress stops counting (full credit 0.4 rad below)
  const STAND_BL = 0.75;              // progress (body lengths) that earns the full standing bonus
  const GND_MIN = 0.15;                // every leg must also carry the animal for this share of the time
  const END_TAU = 1.5, END_FLOOR = 0.25;      // end-of-run posture gate (see Sim.score)
  const TOUCH_ON = 0.006, TOUCH_OFF = 0.008;   // foot-contact flag hysteresis (m)
  const STAND_W = 1.5, STAND_PROG = 0.3;                   // fitness bonus (m-equivalents) for merely staying upright: gradient out of the belly-crawl basin
  const SLIP_W = 0.8, SLIP_DEAD = 0.2;   // penalty per metre of foot skid (m/s dead band)
  const CHATTER_ON = 4.5, CHATTER_SPAN = 2.5, CHATTER_MAX = 0.6;   // toggles / leg / s
  const PRIOR_POW = 1;                 // <1 pushes random genes towards the extremes (clumsier generation 1)
  const RAMP_TIME = 0.7;                             // controller ramp-in from the neutral pose
  const EFFORT_COST = 0.10;                          // weight of the mechanical-work penalty in the fitness

  const FOOT_MU = 1.25, BODY_MU = 0.45;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const wrapPi = (a) => a - TWO_PI * Math.round(a * INV_TWO_PI);

  // =====================================================================================================================
  // 1. PRNG (serialisable state)
  // =====================================================================================================================
  class RNG {
    constructor(seed) { this.s = RNG.mix(seed); }
    static mix(seed) {
      let x = (Math.floor(Number.isFinite(seed) ? seed : 0) | 0) >>> 0;
      x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
      x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
      return (x ^ (x >>> 16)) >>> 0;
    }
    next() {
      this.s = (this.s + 0x6D2B79F5) >>> 0;
      let t = this.s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    gauss() {
      let u = this.next(); if (u < 1e-12) u = 1e-12;
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * this.next());
    }
  }

  // =====================================================================================================================
  // 2. Species, terrains
  // =====================================================================================================================
  W.SPECIES = [
    { id: 'biped', name: 'İki Ayaklı', desc: 'Kuş gibi yatay gövdeli, iki bacaklı ve tabanlı; dengeyi kendisi bulmak zorunda.', legs: 2 },
    { id: 'quad', name: 'Dört Ayaklı', desc: 'Klasik dört bacaklı; tırıs, tırıs-koşu ya da rahat yürüyüş öğrenebilir.', legs: 4 },
    { id: 'hexa', name: 'Altı Ayaklı', desc: 'Böcek gibi altı bacaklı; üç ayaklı yürüyüş (tripod) doğal olarak ortaya çıkabilir.', legs: 6 },
    { id: 'octo', name: 'Sekiz Ayaklı', desc: 'Uzun gövdeli, sekiz bacaklı; bacaklar arasında dalga gibi yürüyüş öğrenir.', legs: 8 },
  ];
  W.TERRAINS = [
    { id: 'flat', name: 'Düz Zemin' },
    { id: 'hills', name: 'Tepeler' },
    { id: 'rough', name: 'Engebeli' },
    { id: 'steps', name: 'Basamaklar' },
  ];

  // Body plans. Lengths in m, masses in kg. `rows` = hip x position as a fraction of the half torso length.
  // kneeSign: +1 = knee flexes so that the shin swings forward (elbow points back, front legs of the quad),
  //           -1 = shin swings backwards (human / hind-leg knee).
  const SPECIES_DEFS = {
    biped: { legs: 2, rows: [0.06], kneeSign: [-1], sideOff: 0.025, torsoLen: 0.50, torsoR: 0.085, thigh: 0.31, shin: 0.33, thighR: 0.052, shinR: 0.040, footR: 0.032, footLen: 0.21, torsoMass: 4.8, thighMass: 1.25, shinMass: 0.75, footMass: 0.40, head: [1.0, 1.7, 0.75], tail: [0.85, -0.15] },
    quad: { legs: 4, rows: [0.80, -0.80], kneeSign: [1, -1], sideOff: 0.035, torsoLen: 0.60, torsoR: 0.090, thigh: 0.30, shin: 0.32, thighR: 0.050, shinR: 0.038, footR: 0.040, footLen: 0, torsoMass: 6.0, thighMass: 0.80, shinMass: 0.45, footMass: 0, head: [1.5, 0.7, 0.8], tail: [0.55, 0.35] },
    hexa: { legs: 6, rows: [0.84, 0, -0.84], kneeSign: [1, -1, -1], sideOff: 0.035, torsoLen: 0.86, torsoR: 0.080, thigh: 0.26, shin: 0.28, thighR: 0.043, shinR: 0.033, footR: 0.036, footLen: 0, torsoMass: 5.4, thighMass: 0.55, shinMass: 0.32, footMass: 0, head: [1.5, 0.5, 0.85], tail: [0.35, 0.15] },
    octo: { legs: 8, rows: [0.88, 0.30, -0.30, -0.88], kneeSign: [1, -1, -1, -1], sideOff: 0.030, torsoLen: 1.10, torsoR: 0.072, thigh: 0.24, shin: 0.26, thighR: 0.040, shinR: 0.030, footR: 0.033, footLen: 0, torsoMass: 5.4, thighMass: 0.46, shinMass: 0.27, footMass: 0, head: [1.5, 0.4, 0.9], tail: [0.3, 0.1] },
  };
  const speciesDef = (id) => SPECIES_DEFS[id] || SPECIES_DEFS.quad;
  const speciesId = (id) => (SPECIES_DEFS[id] ? id : 'quad');

  // ---- terrain -------------------------------------------------------------------------------------------------------
  // Piecewise-linear height table (dx = 5 cm) generated lazily in chunks, so heightAt/slopeAt are O(1) and the physics and
  // the public API see exactly the same surface. x in [-6, 2] is exactly 0 for every kind.
  const T_DX = 0.05, T_X0 = -10, T_CHUNK = 512, T_MAXCHUNK = 4000;

  function terrainFn(kind, seed) {
    const r = new RNG(seed * 7 + 12345);
    const ph = [r.next() * TWO_PI, r.next() * TWO_PI, r.next() * TWO_PI, r.next() * TWO_PI];
    const env = (x) => { const u = clamp((x - 2) / 7, 0, 1); return u * u * (3 - 2 * u); };
    if (kind === 'hills') {
      return (x) => env(x) * (0.19 * Math.sin(x * 0.85 + ph[0]) + 0.10 * Math.sin(x * 1.7 + ph[1]) + 0.05 * Math.sin(x * 0.37 + ph[2]));
    }
    if (kind === 'rough') {
      return (x) => env(x) * (0.030 * Math.sin(x * 5.3 + ph[0]) + 0.024 * Math.sin(x * 8.9 + ph[1]) + 0.05 * Math.sin(x * 1.9 + ph[2]) + 0.02 * Math.sin(x * 13.7 + ph[3]));
    }
    if (kind === 'steps') {
      // shallow stairs: 1.3 m treads, 25 cm ramps, alternating up/down so the world stays bounded
      return (x) => {
        if (x <= 2) return 0;
        const s = (x - 2) / 1.3, k = Math.floor(s), f = s - k;
        const ramp = clamp((f - 0.8) / 0.2, 0, 1);
        const level = (n) => 0.07 * ((n % 6) < 3 ? (n % 3) + 1 : 3 - (n % 3));
        let h = level(k) + (level(k + 1) - level(k)) * ramp * ramp * (3 - 2 * ramp);
        if (k === 0) { const u = clamp(f / 0.2, 0, 1); h *= u * u * (3 - 2 * u); }   // the first tread is reached by a ramp too, not a wall
        return h;
      };
    }
    return () => 0;
  }

  class Terrain {
    constructor(kind, seed) {
      this.kind = (kind === 'hills' || kind === 'rough' || kind === 'steps') ? kind : 'flat';
      this.seed = Number.isFinite(seed) ? seed : 1;
      this._fn = terrainFn(this.kind, this.seed);
      this._chunks = [];
      this._sl = 0;   // slope of the segment used by the last _probe()
    }
    _chunk(ci) {
      let c = this._chunks[ci];
      if (c === undefined) {
        c = new Float64Array(T_CHUNK + 1);
        const x0 = T_X0 + ci * T_CHUNK * T_DX;
        for (let i = 0; i <= T_CHUNK; i++) c[i] = this._fn(x0 + i * T_DX);
        this._chunks[ci] = c;
      }
      return c;
    }
    // returns height at x and stores the local slope in this._sl (hot path helper)
    _probe(x) {
      if (!(x > T_X0)) { this._sl = 0; return 0; }
      let f = (x - T_X0) / T_DX;
      const maxF = T_MAXCHUNK * T_CHUNK;
      if (f >= maxF) f = maxF - 1e-6;
      const ci = (f / T_CHUNK) | 0;
      const c = this._chunk(ci);
      const li = f - ci * T_CHUNK;
      const i = li | 0, t = li - i;
      const a = c[i], b = c[i + 1];
      this._sl = (b - a) / T_DX;
      return a + (b - a) * t;
    }
    heightAt(x) { return this._probe(x); }
    slopeAt(x) { this._probe(x); return this._sl; }
  }
  W.makeTerrain = function (kind, seed) { return new Terrain(kind, seed); };

  // =====================================================================================================================
  // 3. Genome
  // =====================================================================================================================
  // Genes live in the unit cube [0,1]; `decode` maps them to physical parameters. 'circ' genes wrap around (phases).
  // layout: GENES (global, fixed count) followed by LEG_GENES per leg. Body genes (8) are stored separately (genome.b).
  const GENES = [
    // name       lo     hi    kind
    ['freq', 0.5, 1.7, 'log'],       // 0  stride frequency (Hz)
    ['coupling', 0, 8, 'lin'],       // 1  Kuramoto coupling (rad/s): how firmly the leg oscillators lock to their offsets
    ['duty', 0.40, 0.85, 'lin'],     // 2  stance fraction of the cycle
    ['hipAmpF', 0, 0.70, 'lin'],     // 3  hip swing half-amplitude, front legs (rad)
    ['hipAmpR', 0, 0.70, 'lin'],     // 4  ... rear legs
    ['hipOffF', -0.35, 0.35, 'lin'], // 5  hip centre angle, front legs (rad, + = forward)
    ['hipOffR', -0.35, 0.35, 'lin'], // 6  ... rear legs
    ['kneeBase', 0.15, 0.90, 'lin'], // 7  resting knee flexion (rad)
    ['kneeAmpF', 0, 1.5, 'lin'],     // 8  extra knee flexion during swing (foot lift), front
    ['kneeAmpR', 0, 1.5, 'lin'],     // 9  ... rear
    ['kneePhase', -0.5, 0.5, 'lin'], // 10 timing of the foot lift inside the swing phase (0 = mid swing)
    ['kneeWidth', 0.15, 0.70, 'lin'],// 11 duration of the foot lift (cycle fraction)
    ['waveShape', 0, 0.8, 'lin'],    // 12 sinusoid -> linear hip sweep
    ['kneeStance', 0, 0.6, 'lin'],   // 13 knee flexion during mid stance (keeps body height constant)
    ['stiff', 0.5, 2.2, 'log'],      // 14 joint stiffness multiplier
    ['damp', 0.3, 1.5, 'lin'],       // 15 joint damping ratio
    ['effort', 0.5, 1.0, 'lin'],     // 16 torque limit fraction
    ['pitchKp', -1, 1, 'lin'],       // 17 balance: hip offset per rad of torso pitch
    ['pitchKd', -0.4, 0.4, 'lin'],   // 18 balance: hip offset per rad/s of pitch rate
    ['pitchRef', -0.25, 0.25, 'lin'],// 19 balance: preferred torso pitch (rad)
    ['ankleBase', -0.3, 0.3, 'lin'], // 20 biped: foot angle in stance (world, rad)
    ['ankleAmp', 0, 0.8, 'lin'],     // 21 biped: toe-up during swing
    ['reflex', 0, 1, 'lin'],         // 22 (spare gene, currently unused: neutral drift; kept so that saved genomes keep their layout)
  ];
  const NG = GENES.length;                                  // 23
  const GI = {}; GENES.forEach((g, i) => { GI[g[0]] = i; });
  const LEG_GENES = [
    ['psi', 0, 1, 'circ'],           // phase offset of the leg (cycles)
    ['ampScale', 0.4, 1.4, 'lin'],   // hip amplitude multiplier
    ['offDelta', -0.15, 0.15, 'lin'],// hip offset deviation (rad)
    ['kneeDelta', -0.15, 0.15, 'lin'],// knee lift timing deviation (cycles)
    ['dw', -0.12, 0.12, 'lin'],      // natural frequency deviation (fraction)
  ];
  const NL = LEG_GENES.length;                              // 5
  const NB = 8;                                             // body genes
  const genomeLength = (legs) => NG + NL * legs;
  const geneKind = (i) => (i < NG ? GENES[i][3] : LEG_GENES[(i - NG) % NL][3]);
  // relative mutation size per gene (phases move a bit more than amplitudes)
  const geneScale = (i) => (i < NG ? (i === 0 || i === 1 ? 1.0 : 1.0) : ((i - NG) % NL === 0 ? 1.4 : 1.0));

  function geneVal(i, u) {
    const g = i < NG ? GENES[i] : LEG_GENES[(i - NG) % NL];
    if (g[3] === 'log') return g[1] * Math.pow(g[2] / g[1], u);
    return g[1] + (g[2] - g[1]) * u;
  }

  W.randomGenome = function (species, seed, opts) {
    opts = opts || {};
    const sid = speciesId(species), legs = speciesDef(sid).legs;
    const r = new RNG(seed * 2654435 + 977);
    const n = genomeLength(legs);
    const g = new Array(n), b = new Array(NB);
    const hue = r.next() * 360;
    for (let i = 0; i < n; i++) { const u = r.next(); g[i] = PRIOR_POW === 1 ? u : 0.5 + (u < 0.5 ? -1 : 1) * 0.5 * Math.pow(Math.abs(2 * u - 1), PRIOR_POW); }
    for (let i = 0; i < NB; i++) b[i] = 0.5;
    if (opts.evolveBody) for (let i = 0; i < NB; i++) b[i] = clamp(0.5 + 0.22 * r.gauss(), 0, 1);
    if (opts.wild) {
      // extreme values: max amplitude / frequency / gains, random extreme phases
      for (let i = 0; i < n; i++) g[i] = r.next() < 0.5 ? 0 : 1;
      for (const k of ['freq', 'coupling', 'hipAmpF', 'hipAmpR', 'kneeAmpF', 'kneeAmpR', 'stiff', 'effort', 'ankleAmp']) g[GI[k]] = 1;
      g[GI.damp] = r.next() < 0.5 ? 0 : 1; g[GI.duty] = r.next();
      g[GI.pitchKp] = r.next() < 0.5 ? 0 : 1; g[GI.pitchKd] = r.next() < 0.5 ? 0 : 1;
      if (opts.evolveBody) for (let i = 0; i < NB; i++) b[i] = r.next() < 0.5 ? 0 : 1;
    }
    return { v: 1, species: sid, hue: Math.round(hue * 10) / 10, g, b };
  };

  // Makes any imported / saved / hand-made genome safe: arrays of finite numbers in [0,1] with the exact length of the species
  // (padded with the neutral 0.5, truncated when too long). Valid genomes come back with identical values.
  function sanitizeGenome(genome, sid) {
    const n = genomeLength(speciesDef(sid).legs);
    const src = genome && Array.isArray(genome.g) ? genome.g : [], sb = genome && Array.isArray(genome.b) ? genome.b : [];
    const g = new Array(n), b = new Array(NB);
    for (let i = 0; i < n; i++) { const v = src[i]; g[i] = typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : 0.5; }
    for (let i = 0; i < NB; i++) { const v = sb[i]; b[i] = typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : 0.5; }
    const hue = genome && typeof genome.hue === 'number' && Number.isFinite(genome.hue) ? genome.hue : 0;
    return { v: 1, species: sid, hue, g, b };
  }
  // true when the genome is well-formed for that species (right length, finite values in [0,1], matching species tag)
  W.validateGenome = function (genome, species) {
    const sid = speciesId(species || (genome && genome.species));
    if (!genome || typeof genome !== 'object' || !Array.isArray(genome.g) || genome.g.length !== genomeLength(speciesDef(sid).legs)) return false;
    if (genome.species !== undefined && genome.species !== sid) return false;
    const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
    if (!genome.g.every(ok)) return false;
    return genome.b === undefined || (Array.isArray(genome.b) && genome.b.length === NB && genome.b.every(ok));
  };

  // body-plan scale factors from the body genes (0.5 -> 1.0, exponential in between)
  function bodyScales(b, active) {
    const u = (i) => (active && b && Number.isFinite(b[i]) ? clamp(b[i], 0, 1) : 0.5);
    const e = (i, k) => Math.exp((u(i) - 0.5) * 2 * Math.log(k));
    return { torso: e(0, 1.25), girth: e(1, 1.25), thigh: e(2, 1.3), shin: e(3, 1.3), foot: e(4, 1.5), spacing: e(5, 1.15), tmass: e(6, 1.4), limb: e(7, 1.3) };
  }

  // =====================================================================================================================
  // 4. Body plan (static description of a creature: bodies, joints, contact circles, view topology)
  // =====================================================================================================================
  const planCache = {};
  let planCount = 0;

  function buildPlan(sid, bodyGenes, evolveBody) {
    // exact key (no rounding): the plan is a pure function of it, so the cache can never change a result
    const key = sid + (evolveBody ? ':' + (bodyGenes || []).join(',') : '');
    const hit = planCache[key];
    if (hit) return hit;
    const plan = makePlan(sid, bodyGenes, evolveBody);
    if (planCount >= 400) { for (const k in planCache) delete planCache[k]; planCount = 0; }
    planCache[key] = plan; planCount++;
    return plan;
  }

  function makePlan(sid, bodyGenes, evolveBody) {
    const def = speciesDef(sid), sc = bodyScales(bodyGenes, evolveBody);
    const nl = def.legs, nrows = def.rows.length, hasFoot = def.footLen > 0;
    const TL = def.torsoLen * sc.torso, R = def.torsoR * sc.girth;
    const lt = def.thigh * sc.thigh, ls = def.shin * sc.shin;
    const rt = def.thighR * sc.limb, rs = def.shinR * sc.limb, rf = def.footR * sc.foot;
    const fl = def.footLen * sc.foot;
    const bpl = hasFoot ? 3 : 2;                     // bodies per leg
    const nb = 1 + nl * bpl;
    const P = {
      species: sid, nl, nb, hasFoot, torsoLen: TL, torsoR: R, lt, ls, rf, fl,
      mass: new Float64Array(nb), inertia: new Float64Array(nb), kind: new Uint8Array(nb),
      x0: new Float64Array(nb), y0: new Float64Array(nb), a0: new Float64Array(nb),
      joints: [], contacts: [], nodes: [], links: [], feetNodes: [], legs: [], kneeSign: [],
    };
    const capInertia = (m, len, r) => m * (len + 2 * r) * (len + 2 * r) / 12;
    // torso
    P.mass[0] = def.torsoMass * sc.tmass; P.inertia[0] = capInertia(P.mass[0], TL, R) * 0.9; P.kind[0] = 0;
    const lmass = sc.limb * sc.limb;
    const hipJ = [], kneeJ = [], ankleJ = [];
    const flex0 = 0.34;                              // neutral knee flexion of the spawn pose
    const legInit = [];
    for (let i = 0; i < nl; i++) {
      const row = Math.min(nrows - 1, i >> 1), side = i & 1, ks = def.kneeSign[row];
      const half = TL / 2;
      const hx = clamp(def.rows[row] * half * sc.spacing, -half, half) + (side ? 1 : -1) * def.sideOff * (nl === 2 ? 0.6 : 1);
      const hy = -0.45 * R;
      const bT = 1 + i * bpl, bS = bT + 1, bF = bT + 2;
      P.mass[bT] = def.thighMass * lmass; P.inertia[bT] = capInertia(P.mass[bT], lt, rt); P.kind[bT] = 1;
      P.mass[bS] = def.shinMass * lmass; P.inertia[bS] = capInertia(P.mass[bS], ls, rs); P.kind[bS] = 2;
      if (hasFoot) { P.mass[bF] = def.footMass * lmass; P.inertia[bF] = capInertia(P.mass[bF], fl, rf); P.kind[bF] = 3; }
      P.kneeSign.push(ks);
      // hip joint: torso <-> thigh. angle 0 = thigh straight down, + = swings forward.
      hipJ.push({ A: 0, B: bT, la: [hx, hy], lb: [-lt / 2, 0], ref: -HALF_PI, lo: -0.85, hi: 0.85, type: 0, leg: i });
      // knee joint: thigh <-> shin. flexion f >= 0; angle = ks * f
      kneeJ.push({ A: bT, B: bS, la: [lt / 2, 0], lb: [-ls / 2, 0], ref: 0, lo: ks > 0 ? 0 : -2.3, hi: ks > 0 ? 2.3 : 0, type: 1, leg: i });
      if (hasFoot) ankleJ.push({ A: bS, B: bF, la: [ls / 2, 0], lb: [-fl / 6, 0], ref: HALF_PI, lo: -0.6, hi: 0.6, type: 2, leg: i });
      legInit.push({ hx, hy, bT, bS, bF, ks });
    }
    P.joints = hipJ.concat(kneeJ, ankleJ);
    // ---- spawn pose: legs neutral, torso level, lowest contact circle exactly on the ground --------------------------
    const cont = P.contacts;
    cont.push({ b: 0, lx: -TL / 2, ly: 0, r: R, mu: BODY_MU, foot: 0, leg: -1 });
    cont.push({ b: 0, lx: 0, ly: 0, r: R, mu: BODY_MU, foot: 0, leg: -1 });
    cont.push({ b: 0, lx: TL / 2, ly: 0, r: R, mu: BODY_MU, foot: 0, leg: -1 });
    // head and tail are solid too (a nose-dive must not sink them into the ground); same numbers as their view nodes below
    cont.push({ b: 0, lx: TL / 2 + def.head[0] * R, ly: def.head[1] * R, r: def.head[2] * R, mu: BODY_MU, foot: 0, leg: -1 });
    cont.push({ b: 0, lx: -TL / 2 - def.tail[0] * TL * (nl === 2 ? 0.8 : 0.35), ly: def.tail[1] * R * 0.6, r: R * 0.35, mu: BODY_MU, foot: 0, leg: -1 });
    P.x0[0] = 0; P.y0[0] = 0; P.a0[0] = 0;
    for (let i = 0; i < nl; i++) {
      const L = legInit[i], ks = L.ks;
      const a1 = -HALF_PI, a2 = a1 + ks * flex0;
      const hipX = L.hx, hipY = L.hy;
      P.a0[L.bT] = a1; P.x0[L.bT] = hipX + Math.cos(a1) * lt / 2; P.y0[L.bT] = hipY + Math.sin(a1) * lt / 2;
      const kx = hipX + Math.cos(a1) * lt, ky = hipY + Math.sin(a1) * lt;
      P.a0[L.bS] = a2; P.x0[L.bS] = kx + Math.cos(a2) * ls / 2; P.y0[L.bS] = ky + Math.sin(a2) * ls / 2;
      const ax = kx + Math.cos(a2) * ls, ay = ky + Math.sin(a2) * ls;   // ankle / sole end of the shin
      cont.push({ b: L.bT, lx: lt / 2, ly: 0, r: Math.max(rt, rs) * 0.95, mu: BODY_MU, foot: 0, leg: i });
      L.c0 = cont.length;
      if (hasFoot) {
        P.a0[L.bF] = 0; P.x0[L.bF] = ax + fl / 6; P.y0[L.bF] = ay;
        cont.push({ b: L.bF, lx: -fl / 2, ly: 0, r: rf, mu: FOOT_MU, foot: 1, leg: i });
        cont.push({ b: L.bF, lx: fl / 2, ly: 0, r: rf, mu: FOOT_MU, foot: 1, leg: i });
      } else {
        cont.push({ b: L.bS, lx: ls / 2, ly: 0, r: rf, mu: FOOT_MU, foot: 1, leg: i });
      }
      L.c1 = cont.length;
    }
    // shift so that the lowest circle bottom touches the ground (+1 mm)
    let lowest = 1e9;
    for (const c of cont) {
      const b = c.b, ca = Math.cos(P.a0[b]), sa = Math.sin(P.a0[b]);
      const wy = P.y0[b] + sa * c.lx + ca * c.ly;
      lowest = Math.min(lowest, wy - c.r);
    }
    const shift = 0.001 - lowest;
    for (let b = 0; b < nb; b++) P.y0[b] += shift;
    // ---- metrics --------------------------------------------------------------------------------------------------
    let M = 0; for (let b = 0; b < nb; b++) M += P.mass[b];
    P.totalMass = M;
    P.bodyLength = TL + 2 * R;
    P.legLength = lt + ls + rf;          // fully stretched hip-to-sole
    P.tauBase = M * GRAV * P.legLength;  // reference torque (N m): weight x leg length
    // ---- view topology ----------------------------------------------------------------------------------------------
    const nodes = P.nodes, links = P.links;
    const addNode = (b, lx, ly, r) => { nodes.push({ b, lx, ly, r }); return nodes.length - 1; };
    const n0 = addNode(0, -TL / 2, 0, R), n1 = addNode(0, TL / 2, 0, R);
    const nh = addNode(0, TL / 2 + def.head[0] * R, def.head[1] * R, def.head[2] * R);
    const nt = addNode(0, -TL / 2 - def.tail[0] * TL * (nl === 2 ? 0.8 : 0.35), def.tail[1] * R * 0.6, R * 0.35);
    links.push({ a: n0, b: n1, w: 2 * R, kind: 'torso', leg: -1, side: 0 });
    links.push({ a: n1, b: nh, w: 2 * def.head[2] * R, kind: 'head', leg: -1, side: 0 });
    links.push({ a: n0, b: nt, w: 0.7 * R, kind: 'other', leg: -1, side: 0 });
    for (let i = 0; i < nl; i++) {
      const L = legInit[i], side = i & 1;
      const nHip = addNode(0, L.hx, L.hy, rt * 0.85);
      const nKnee = addNode(L.bT, lt / 2, 0, rt);
      links.push({ a: nHip, b: nKnee, w: 2 * rt, kind: 'thigh', leg: i, side });
      if (hasFoot) {
        const nAnk = addNode(L.bS, ls / 2, 0, rs);
        const nHeel = addNode(L.bF, -fl / 2, 0, rf), nToe = addNode(L.bF, fl / 2, 0, rf);
        links.push({ a: nKnee, b: nAnk, w: 2 * rs, kind: 'shin', leg: i, side });
        links.push({ a: nHeel, b: nToe, w: 2 * rf, kind: 'foot', leg: i, side });
        P.feetNodes.push(nToe);
      } else {
        const nFoot = addNode(L.bS, ls / 2, 0, rf);
        links.push({ a: nKnee, b: nFoot, w: 2 * rs, kind: 'shin', leg: i, side });
        P.feetNodes.push(nFoot);
      }
    }
    P.legs = legInit;
    return P;
  }

  // =====================================================================================================================
  // 5. Controller decoding
  // =====================================================================================================================
  function decodeController(genome, plan) {
    const nl = plan.nl, def = speciesDef(plan.species);
    const g = genome && genome.g ? genome.g : [];
    const u = (i) => { const v = g[i]; return Number.isFinite(v) ? clamp(v, 0, 1) : 0.5; };
    const gv = (name) => geneVal(GI[name], u(GI[name]));
    const C = {
      w0: TWO_PI * gv('freq'), K: gv('coupling'), duty: gv('duty'), shape: gv('waveShape'),
      kneeBase: gv('kneeBase'), kneePhase: gv('kneePhase'), kneeWidth: gv('kneeWidth'), kneeStance: gv('kneeStance'),
      stiff: gv('stiff'), damp: gv('damp'), effort: gv('effort'),
      pKp: gv('pitchKp'), pKd: gv('pitchKd'), pRef: gv('pitchRef'),
      ankBase: gv('ankleBase'), ankAmp: gv('ankleAmp'), reflex: gv('reflex'),
      psi: new Float64Array(nl), hipAmp: new Float64Array(nl), hipOff: new Float64Array(nl), kneeAmp: new Float64Array(nl),
      kneePh: new Float64Array(nl), dw: new Float64Array(nl),
    };
    const nrows = def.rows.length;
    const aF = gv('hipAmpF'), aR = gv('hipAmpR'), oF = gv('hipOffF'), oR = gv('hipOffR'), kF = gv('kneeAmpF'), kR = gv('kneeAmpR');
    for (let i = 0; i < nl; i++) {
      const row = Math.min(nrows - 1, i >> 1);
      const t = nrows > 1 ? row / (nrows - 1) : 0;              // 0 = front row, 1 = rear row
      const b = NG + NL * i;
      C.psi[i] = u(b);
      C.hipAmp[i] = (aF + (aR - aF) * t) * geneVal(NG + 1, u(b + 1));
      C.hipOff[i] = oF + (oR - oF) * t + geneVal(NG + 2, u(b + 2));
      C.kneeAmp[i] = kF + (kR - kF) * t;
      C.kneePh[i] = geneVal(NG + 3, u(b + 3));
      C.dw[i] = geneVal(NG + 4, u(b + 4));
    }
    return C;
  }

  // =====================================================================================================================
  // 6. Simulation of one creature
  // =====================================================================================================================
  function softness(hertz, zeta, h) {
    const omega = TWO_PI * hertz, a1 = 2 * zeta + h * omega, a2 = h * omega * a1, a3 = 1 / (1 + a2);
    return { biasRate: omega / a1, massScale: a2 * a3, impulseScale: a3 };
  }
  const SOFT_JOINT = softness(JOINT_HERTZ, JOINT_ZETA, SUB_DT);
  const SOFT_CONTACT = softness(CONTACT_HERTZ, CONTACT_ZETA, SUB_DT);

  const JOINT_WMAX = [7.0, 9.0, 8.0];              // rad/s speed limit of the motor set-point (hip, knee, ankle)
  const JOINT_TAU = [0.50, 0.42, 0.22];            // torque limit / (M g legLength)
  const JOINT_K = [2.4, 2.0, 1.0];                 // stiffness / (M g legLength) [per rad]

  class Sim {
    constructor(plan, genome, terrain, evolveBody) {
      this.plan = plan; this.terr = terrain;
      const nb = plan.nb, nj = plan.joints.length, nc = plan.contacts.length, nl = plan.nl;
      this.nb = nb; this.nj = nj; this.nc = nc; this.nl = nl;
      this.P = decodeController(genome, plan);
      const F = (n) => new Float64Array(n);
      this.px = F(nb); this.py = F(nb); this.pa = F(nb); this.vx = F(nb); this.vy = F(nb); this.vw = F(nb);
      this.cs = F(nb); this.sn = F(nb); this.im = F(nb); this.ii = F(nb);
      for (let b = 0; b < nb; b++) {
        this.px[b] = plan.x0[b]; this.py[b] = plan.y0[b]; this.pa[b] = plan.a0[b];
        this.im[b] = 1 / plan.mass[b]; this.ii[b] = 1 / plan.inertia[b];
      }
      // joints
      const I = (n) => new Int32Array(n);
      this.jA = I(nj); this.jB = I(nj); this.jax = F(nj); this.jay = F(nj); this.jbx = F(nj); this.jby = F(nj);
      this.jref = F(nj); this.jlo = F(nj); this.jhi = F(nj); this.jtau = F(nj); this.jwmax = F(nj);
      this.jgam = F(nj); this.jbb = F(nj); this.jmeff = F(nj); this.jlimEff = F(nj); this.jtgt = F(nj); this.jth = F(nj);
      this.jaccX = F(nj); this.jaccY = F(nj); this.jaccM = F(nj); this.jaccLo = F(nj); this.jaccHi = F(nj);
      this.jrax = F(nj); this.jray = F(nj); this.jrbx = F(nj); this.jrby = F(nj);
      this.ji11 = F(nj); this.ji12 = F(nj); this.ji22 = F(nj); this.jcx = F(nj); this.jcy = F(nj);
      const C = this.P;
      for (let j = 0; j < nj; j++) {
        const J = plan.joints[j];
        this.jA[j] = J.A; this.jB[j] = J.B; this.jax[j] = J.la[0]; this.jay[j] = J.la[1]; this.jbx[j] = J.lb[0]; this.jby[j] = J.lb[1];
        this.jref[j] = J.ref; this.jlo[j] = J.lo; this.jhi[j] = J.hi;
        this.jtau[j] = JOINT_TAU[J.type] * plan.tauBase * C.effort;
        this.jwmax[j] = JOINT_WMAX[J.type];
        const K = this.ii[J.A] + this.im[J.A] * 0 + this.ii[J.B];       // 1 / effective joint inertia
        const kk = JOINT_K[J.type] * plan.tauBase * C.stiff;          // N m / rad
        const inertia = 1 / K;
        const cc = 2 * C.damp * Math.sqrt(kk * inertia);              // N m s / rad
        const gam = 1 / (SUB_DT * (cc + SUB_DT * kk));
        this.jgam[j] = gam; this.jbb[j] = kk / (cc + SUB_DT * kk); this.jmeff[j] = 1 / (K + gam); this.jlimEff[j] = inertia;
      }
      // contacts
      this.cB = I(nc); this.clx = F(nc); this.cly = F(nc); this.cR = F(nc); this.cMu = F(nc);
      this.cFoot = new Uint8Array(nc); this.cLeg = I(nc);
      this.cAct = new Uint8Array(nc); this.cTouch = new Uint8Array(nc);
      this.crx = F(nc); this.cry = F(nc); this.cnx = F(nc); this.cny = F(nc); this.cgx = F(nc); this.cgy = F(nc);
      this.caccN = F(nc); this.caccT = F(nc); this.cmN = F(nc); this.cmT = F(nc);
      for (let k = 0; k < nc; k++) {
        const c = plan.contacts[k];
        this.cB[k] = c.b; this.clx[k] = c.lx; this.cly[k] = c.ly; this.cR[k] = c.r; this.cMu[k] = c.mu;
        this.cFoot[k] = c.foot; this.cLeg[k] = c.leg;
      }
      // controller state
      this.th = F(nl); this.tcx = F(nl); this.tsx = F(nl);
      this.legTouch = new Uint8Array(nl);
      this.kneeSign = plan.kneeSign;
      this.hipJ0 = 0; this.kneeJ0 = nl; this.ankleJ0 = 2 * nl;
      // bookkeeping
      this.steps = 0; this.t = 0; this.alive = true;
      this.cx0 = this.comX();
      this.strict = nl <= 2 ? BIPED_STRICT : 1; this.legAir = new Float64Array(nl); this.legGnd = new Float64Array(nl); this.legLow = new Uint8Array(nl); this.upS = 1; this.stand = 0; this.slip = 0; this.toggles = 0; this.prevTouch = new Uint8Array(nl); this.reward = 0; this.work = 0; this.airT = 0; this.countT = 0; this.lastCx = this.cx0; this.lastScore = 0; this.frozenScore = 0;
      this.belly = false; this.airborne = false;
      this.initTargets();
    }

    comX() {
      let s = 0, m = 0; const pl = this.plan;
      for (let b = 0; b < this.nb; b++) { s += pl.mass[b] * this.px[b]; m += pl.mass[b]; }
      return s / m;
    }
    comY() {
      let s = 0, m = 0; const pl = this.plan;
      for (let b = 0; b < this.nb; b++) { s += pl.mass[b] * this.py[b]; m += pl.mass[b]; }
      return s / m;
    }

    // neutral pose targets (used before the controller is ramped in)
    initTargets() {
      const nl = this.nl;
      for (let i = 0; i < nl; i++) {
        this.jtgt[this.hipJ0 + i] = 0;
        this.jtgt[this.kneeJ0 + i] = this.kneeSign[i] * 0.34;
        if (this.plan.hasFoot) this.jtgt[this.ankleJ0 + i] = 0;
      }
    }

    // ---- controller: phase oscillators -> joint set-points ------------------------------------------------------------
    control() {
      const P = this.P, nl = this.nl, th = this.th, tcx = this.tcx, tsx = this.tsx, jtgt = this.jtgt;
      const ramp = this.t >= RAMP_TIME ? 1 : this.t / RAMP_TIME;
      const pitch = wrapPi(this.pa[0]), pitchRate = this.vw[0];
      const fb = clamp(ramp * (P.pKp * (pitch - P.pRef) + P.pKd * pitchRate), -0.5, 0.5);
      let C = 0, S = 0;
      for (let i = 0; i < nl; i++) { const c = Math.cos(th[i]), s = Math.sin(th[i]); tcx[i] = c; tsx[i] = s; C += c; S += s; }
      const kc = P.K / nl, duty = P.duty, ws = P.shape, hasFoot = this.plan.hasFoot;
      const swingLen = 1 - duty;
      const kw = P.kneeWidth;
      for (let i = 0; i < nl; i++) {
        // phase advance (Kuramoto mean-field coupling towards the evolved offsets)
        let dth = P.w0 * (1 + P.dw[i]) + kc * (tsx[i] * 0 + S * tcx[i] - C * tsx[i]);
        th[i] += dth * DT;
        const phi = th[i] * INV_TWO_PI + P.psi[i];
        const u = phi - Math.floor(phi);
        // warped phase: stance = first `duty` of the cycle (hip sweeps front -> back), swing = remainder
        const uw = u < duty ? 0.5 * u / duty : 0.5 + 0.5 * (u - duty) / swingLen;
        const tri = uw < 0.5 ? 1 - 4 * uw : 4 * uw - 3;
        const hw = (1 - ws) * Math.cos(TWO_PI * uw) + ws * tri;           // +1 = foot forward, -1 = foot back
        const hip = P.hipOff[i] + P.hipAmp[i] * hw + fb;
        // foot lift bump, centred in the swing phase (+ evolved timing shift)
        let x = u - (duty + swingLen * (0.5 + P.kneePhase) + P.kneePh[i]);
        x -= Math.round(x);
        const half = 0.5 * kw;
        const bump = x > -half && x < half ? 0.5 + 0.5 * Math.cos(Math.PI * x / half) : 0;
        let flex = P.kneeBase + P.kneeAmp[i] * bump + P.kneeStance * (1 - hw * hw) * (u < duty ? 1 : 0);
        flex = clamp(flex, 0, 2.2);
        const neutralHip = 0, neutralKnee = 0.34;
        const hipT = neutralHip + ramp * (hip - neutralHip);
        const flexT = neutralKnee + ramp * (flex - neutralKnee);
        jtgt[this.hipJ0 + i] += TGT_ALPHA * (clamp(hipT, -0.85, 0.85) - jtgt[this.hipJ0 + i]);
        jtgt[this.kneeJ0 + i] += TGT_ALPHA * (this.kneeSign[i] * flexT - jtgt[this.kneeJ0 + i]);
        if (hasFoot) {
          // ankle: hold the foot at an evolved world angle, toe-up during the swing lift
          const plan = this.plan, bS = plan.legs[i].bS;
          const footWorld = P.ankBase + P.ankAmp * bump;
          const ref = HALF_PI;
          let a = footWorld - this.pa[bS] - ref;
          a = wrapPi(a);
          jtgt[this.ankleJ0 + i] += TGT_ALPHA * (ramp * clamp(a, -0.6, 0.6) - jtgt[this.ankleJ0 + i]);
        }
      }
    }

    freeze() { this.alive = false; this.frozenScore = (this.lastScore > 0 ? this.lastScore * 0.1 : this.lastScore) - 1; }

    // ---- one fixed physics step (60 Hz outer step, NSUB soft-step substeps) -------------------------------------------
    // Box2D-v3 "soft step" flavour: contacts are detected once per outer step (speculative margin), then NSUB substeps of
    //   integrate velocities -> prepare joints (fresh anchors / error) -> warm start -> solve (soft, biased)
    //   -> integrate positions -> relax (solve again without bias, removes the velocity added by the positional bias).
    step() {
      if (!this.alive) return;
      const h = SUB_DT;
      const nb = this.nb, nj = this.nj;
      const px = this.px, py = this.py, pa = this.pa, vx = this.vx, vy = this.vy, vw = this.vw, cs = this.cs, sn = this.sn;
      const jA = this.jA, jB = this.jB, jaccM = this.jaccM;

      this.control();
      for (let b = 0; b < nb; b++) { cs[b] = Math.cos(pa[b]); sn[b] = Math.sin(pa[b]); }
      this.collide();

      const ld = 1 / (1 + h * LIN_DAMP), ad = 1 / (1 + h * ANG_DAMP);
      let work = 0;
      for (let s = 0; s < NSUB; s++) {
        for (let b = 0; b < nb; b++) { vx[b] *= ld; vy[b] = (vy[b] - GRAV * h) * ld; vw[b] *= ad; }
        this.prepareJoints();
        this.warmStartContacts();
        this.solveJoints(true);
        this.solveContacts(true);
        for (let b = 0; b < nb; b++) {
          let w = vw[b]; if (w > MAX_W) w = vw[b] = MAX_W; else if (w < -MAX_W) w = vw[b] = -MAX_W;
          px[b] += vx[b] * h; py[b] += vy[b] * h;
          const d = w * h, t = 0.5 * d, k = 1 / (1 + t * t);      // exact rotation by 2*atan(d/2) ~ d
          const c = cs[b], sg = sn[b], c2 = (1 - t * t) * k, s2 = 2 * t * k;
          pa[b] += d; cs[b] = c * c2 - sg * s2; sn[b] = sg * c2 + c * s2;
        }
        this.solveJoints(false);
        this.solveContacts(false);
        // motor work (effort): |torque * joint speed| integrated
        for (let j = 0; j < nj; j++) work += Math.abs(jaccM[j] * (vw[jB[j]] - vw[jA[j]]));
      }
      if (this.t >= SETTLE_TIME) this.work += work;

      this.steps++; this.t = this.steps * DT;

      // ---- safety: freeze exploded / non-finite creatures ---------------------------------------------------------------
      let bad = !(Math.abs(px[0]) < 1e4 && Math.abs(py[0]) < 1e4);
      if (!bad) for (let b = 0; b < nb; b++) { const v2 = vx[b] * vx[b] + vy[b] * vy[b]; if (!(v2 < 1e4) || !(Math.abs(px[b]) < 1e4) || !(Math.abs(py[b]) < 1e4)) { bad = true; break; } }
      if (bad) { this.freeze(); return; }
      this.finishContacts();
      this.account();
    }

    // contact detection: circles vs heightfield. Stores the ground foot point + normal so that the separation can be
    // updated cheaply inside the substeps.
    collide() {
      const nc = this.nc, terr = this.terr;
      const px = this.px, py = this.py, vx = this.vx, vy = this.vy, vw = this.vw, cs = this.cs, sn = this.sn, im = this.im, ii = this.ii;
      const cB = this.cB, clx = this.clx, cly = this.cly, cR = this.cR, cAct = this.cAct;
      const crx = this.crx, cry = this.cry, cnx = this.cnx, cny = this.cny, cgx = this.cgx, cgy = this.cgy, caccN = this.caccN, caccT = this.caccT;
      const cmN = this.cmN, cmT = this.cmT;
      for (let k = 0; k < nc; k++) {
        const b = cB[k];
        const rx = cs[b] * clx[k] - sn[b] * cly[k], ry = sn[b] * clx[k] + cs[b] * cly[k];
        const wx = px[b] + rx, wy = py[b] + ry;
        const gy = terr._probe(wx), sl = terr._sl;
        const ny = 1 / Math.sqrt(1 + sl * sl), nx = -sl * ny;
        const sep = (wy - gy) * ny - cR[k];
        // speculative margin grows with the approach speed of the circle
        const vn = (vx[b] - vw[b] * ry) * nx + (vy[b] + vw[b] * rx) * ny;
        if (sep < CONTACT_MARGIN - (vn < 0 ? vn * DT : 0)) {
          if (!cAct[k]) { cAct[k] = 1; caccN[k] = 0; caccT[k] = 0; }
          cnx[k] = nx; cny[k] = ny;
          cgx[k] = wx - (sep + cR[k]) * nx; cgy[k] = wy - (sep + cR[k]) * ny;   // foot point of the perpendicular on the ground
          const rcx = rx - cR[k] * nx, rcy = ry - cR[k] * ny;                  // lever arm to the point facing the ground
          crx[k] = rcx; cry[k] = rcy;
          const rn = rcx * ny - rcy * nx, rt = -rcx * nx - rcy * ny;
          cmN[k] = 1 / (im[b] + ii[b] * rn * rn);
          cmT[k] = 1 / (im[b] + ii[b] * rt * rt);
        } else cAct[k] = 0;
      }
    }

    // after the substeps: which legs / body parts touch the ground right now (uses the final separation)
    finishContacts() {
      const nc = this.nc, px = this.px, py = this.py, cs = this.cs, sn = this.sn;
      const cB = this.cB, clx = this.clx, cly = this.cly, cR = this.cR, cAct = this.cAct, cnx = this.cnx, cny = this.cny, cgx = this.cgx, cgy = this.cgy;
      const cTouch = this.cTouch, legTouch = this.legTouch, legLow = this.legLow;
      legTouch.fill(0); legLow.fill(0);
      let belly = false;
      for (let k = 0; k < nc; k++) {
        if (cAct[k]) {
          const b = cB[k];
          const wx = px[b] + cs[b] * clx[k] - sn[b] * cly[k], wy = py[b] + sn[b] * clx[k] + cs[b] * cly[k];
          const sep = (wx - cgx[k]) * cnx[k] + (wy - cgy[k]) * cny[k] - cR[k];
          if (sep < TOUCH_ON) cTouch[k] = 1; else if (sep > TOUCH_OFF) cTouch[k] = 0;
          if (this.cFoot[k] && sep < LIFT_H) legLow[this.cLeg[k]] = 1;   // foot still skimming the ground
        } else cTouch[k] = 0;
        if (cTouch[k]) {
          if (this.cFoot[k]) {
            legTouch[this.cLeg[k]] = 1;
            // foot skid: tangential speed of a foot that is flagged as touching (loaded or not: a foot that rides the ground
            // without lifting is skating just as much as one that slides under load)
            const b = cB[k], vt = Math.abs((this.vx[b] - this.vw[b] * this.cry[k]) * cny[k] - (this.vy[b] + this.vw[b] * this.crx[k]) * cnx[k]);
            if (vt > SLIP_DEAD && this.t >= SETTLE_TIME) this.slip += (vt - SLIP_DEAD) * DT;
          } else belly = true;
        }
      }
      this.belly = belly;
    }

    // joints: fresh anchors / effective mass / positional error for the current substep, then warm start
    prepareJoints() {
      const nj = this.nj, px = this.px, py = this.py, pa = this.pa, vx = this.vx, vy = this.vy, vw = this.vw, cs = this.cs, sn = this.sn, im = this.im, ii = this.ii;
      const jA = this.jA, jB = this.jB, jax = this.jax, jay = this.jay, jbx = this.jbx, jby = this.jby, jref = this.jref;
      const jrax = this.jrax, jray = this.jray, jrbx = this.jrbx, jrby = this.jrby, ji11 = this.ji11, ji12 = this.ji12, ji22 = this.ji22;
      const jcx = this.jcx, jcy = this.jcy, jth = this.jth, jaccX = this.jaccX, jaccY = this.jaccY, jaccM = this.jaccM, jaccLo = this.jaccLo, jaccHi = this.jaccHi;
      for (let j = 0; j < nj; j++) {
        const A = jA[j], B = jB[j];
        const rax = cs[A] * jax[j] - sn[A] * jay[j], ray = sn[A] * jax[j] + cs[A] * jay[j];
        const rbx = cs[B] * jbx[j] - sn[B] * jby[j], rby = sn[B] * jbx[j] + cs[B] * jby[j];
        jrax[j] = rax; jray[j] = ray; jrbx[j] = rbx; jrby[j] = rby;
        const mA = im[A], mB = im[B], iA = ii[A], iB = ii[B];
        const k11 = mA + mB + ray * ray * iA + rby * rby * iB;
        const k12 = -ray * rax * iA - rby * rbx * iB;
        const k22 = mA + mB + rax * rax * iA + rbx * rbx * iB;
        let det = k11 * k22 - k12 * k12; det = det !== 0 ? 1 / det : 0;
        ji11[j] = k22 * det; ji12[j] = -k12 * det; ji22[j] = k11 * det;
        jcx[j] = px[B] + rbx - px[A] - rax; jcy[j] = py[B] + rby - py[A] - ray;
        jth[j] = pa[B] - pa[A] - jref[j];
        const ix = jaccX[j], iy = jaccY[j], iw = jaccM[j] + jaccLo[j] - jaccHi[j];
        vx[A] -= mA * ix; vy[A] -= mA * iy; vw[A] -= iA * (rax * iy - ray * ix + iw);
        vx[B] += mB * ix; vy[B] += mB * iy; vw[B] += iB * (rbx * iy - rby * ix + iw);
      }
    }

    warmStartContacts() {
      const nc = this.nc, vx = this.vx, vy = this.vy, vw = this.vw, im = this.im, ii = this.ii;
      const cB = this.cB, cAct = this.cAct, cnx = this.cnx, cny = this.cny, crx = this.crx, cry = this.cry, caccN = this.caccN, caccT = this.caccT;
      for (let k = 0; k < nc; k++) {
        if (!cAct[k]) continue;
        const b = cB[k], nx = cnx[k], ny = cny[k];
        const Px = caccN[k] * nx + caccT[k] * ny, Py = caccN[k] * ny - caccT[k] * nx;
        vx[b] += im[b] * Px; vy[b] += im[b] * Py; vw[b] += ii[b] * (crx[k] * Py - cry[k] * Px);
      }
    }

    solveJoints(useBias) {
      const nj = this.nj, vx = this.vx, vy = this.vy, vw = this.vw, im = this.im, ii = this.ii;
      const jA = this.jA, jB = this.jB, jrax = this.jrax, jray = this.jray, jrbx = this.jrbx, jrby = this.jrby;
      const ji11 = this.ji11, ji12 = this.ji12, ji22 = this.ji22, jcx = this.jcx, jcy = this.jcy, jth = this.jth;
      const jaccX = this.jaccX, jaccY = this.jaccY, jaccM = this.jaccM, jaccLo = this.jaccLo, jaccHi = this.jaccHi;
      const jgam = this.jgam, jbb = this.jbb, jmeff = this.jmeff, jtgt = this.jtgt, jtau = this.jtau, jwmax = this.jwmax;
      const jlo = this.jlo, jhi = this.jhi, jlimEff = this.jlimEff;
      const ih = SUB_RATE, h = SUB_DT;
      const sBias = SOFT_JOINT.biasRate, sMs = SOFT_JOINT.massScale, sIs = SOFT_JOINT.impulseScale;
      for (let j = 0; j < nj; j++) {
        const A = jA[j], B = jB[j];
        const mA = im[A], mB = im[B], iA = ii[A], iB = ii[B];
        // --- motor: implicit spring-damper towards the set-point, torque and speed limited
        {
          const Cerr = jth[j] - jtgt[j];
          let bias = jbb[j] * Cerr; const wm = jwmax[j];
          if (bias > wm) bias = wm; else if (bias < -wm) bias = -wm;
          const Cdot = vw[B] - vw[A];
          let imp = -jmeff[j] * (Cdot + bias + jgam[j] * jaccM[j]);
          const maxI = jtau[j] * h;
          let na = jaccM[j] + imp; if (na > maxI) na = maxI; else if (na < -maxI) na = -maxI;
          imp = na - jaccM[j]; jaccM[j] = na;
          vw[A] -= iA * imp; vw[B] += iB * imp;
        }
        // --- limits
        {
          const th = jth[j];
          const Cl = th - jlo[j];
          const eff = jlimEff[j];
          if (Cl < 0.1) {
            let bias, ms, is;
            if (Cl > 0) { bias = Cl * ih; ms = 1; is = 0; } else if (useBias) { bias = sBias * Cl; ms = sMs; is = sIs; } else { bias = 0; ms = 1; is = 0; }
            const Cdot = vw[B] - vw[A];
            let imp = -eff * ms * (Cdot + bias) - is * jaccLo[j];
            let na = jaccLo[j] + imp; if (na < 0) na = 0;
            imp = na - jaccLo[j]; jaccLo[j] = na;
            vw[A] -= iA * imp; vw[B] += iB * imp;
          } else jaccLo[j] = 0;
          const Cu = jhi[j] - th;
          if (Cu < 0.1) {
            let bias, ms, is;
            if (Cu > 0) { bias = Cu * ih; ms = 1; is = 0; } else if (useBias) { bias = sBias * Cu; ms = sMs; is = sIs; } else { bias = 0; ms = 1; is = 0; }
            const Cdot = vw[A] - vw[B];
            let imp = -eff * ms * (Cdot + bias) - is * jaccHi[j];
            let na = jaccHi[j] + imp; if (na < 0) na = 0;
            imp = na - jaccHi[j]; jaccHi[j] = na;
            vw[A] += iA * imp; vw[B] -= iB * imp;
          } else jaccHi[j] = 0;
        }
        // --- point constraint (2x2)
        {
          const rax = jrax[j], ray = jray[j], rbx = jrbx[j], rby = jrby[j];
          let bx = vx[B] - vw[B] * rby - vx[A] + vw[A] * ray;
          let by = vy[B] + vw[B] * rbx - vy[A] - vw[A] * rax;
          let ms = 1, is = 0;
          if (useBias) { bx += sBias * jcx[j]; by += sBias * jcy[j]; ms = sMs; is = sIs; }
          const ix = -ms * (ji11[j] * bx + ji12[j] * by) - is * jaccX[j];
          const iy = -ms * (ji12[j] * bx + ji22[j] * by) - is * jaccY[j];
          jaccX[j] += ix; jaccY[j] += iy;
          vx[A] -= mA * ix; vy[A] -= mA * iy; vw[A] -= iA * (rax * iy - ray * ix);
          vx[B] += mB * ix; vy[B] += mB * iy; vw[B] += iB * (rbx * iy - rby * ix);
        }
      }
    }

    solveContacts(useBias) {
      const nc = this.nc, vx = this.vx, vy = this.vy, vw = this.vw, im = this.im, ii = this.ii;
      const px = this.px, py = this.py, cs = this.cs, sn = this.sn, clx = this.clx, cly = this.cly, cR = this.cR, cgx = this.cgx, cgy = this.cgy;
      const cB = this.cB, cAct = this.cAct, cnx = this.cnx, cny = this.cny, crx = this.crx, cry = this.cry;
      const caccN = this.caccN, caccT = this.caccT, cmN = this.cmN, cmT = this.cmT, cMu = this.cMu;
      const ih = SUB_RATE;
      const sBias = SOFT_CONTACT.biasRate, sMs = SOFT_CONTACT.massScale, sIs = SOFT_CONTACT.impulseScale;
      for (let k = 0; k < nc; k++) {
        if (!cAct[k]) continue;
        const b = cB[k], nx = cnx[k], ny = cny[k], rx = crx[k], ry = cry[k];
        const mb = im[b], ib = ii[b];
        // friction
        {
          const tx = ny, ty = -nx;
          const vrx = vx[b] - vw[b] * ry, vry = vy[b] + vw[b] * rx;
          const vt = vrx * tx + vry * ty;
          let imp = -cmT[k] * vt;
          const maxF = cMu[k] * caccN[k];
          let na = caccT[k] + imp; if (na > maxF) na = maxF; else if (na < -maxF) na = -maxF;
          imp = na - caccT[k]; caccT[k] = na;
          const Px = imp * tx, Py = imp * ty;
          vx[b] += mb * Px; vy[b] += mb * Py; vw[b] += ib * (rx * Py - ry * Px);
        }
        // normal
        {
          const vrx = vx[b] - vw[b] * ry, vry = vy[b] + vw[b] * rx;
          const vn = vrx * nx + vry * ny;
          const wx = px[b] + cs[b] * clx[k] - sn[b] * cly[k], wy = py[b] + sn[b] * clx[k] + cs[b] * cly[k];
          const s = (wx - cgx[k]) * nx + (wy - cgy[k]) * ny - cR[k] + CONTACT_SLOP;
          let bias, ms, is;
          if (s > 0) { bias = s * ih; ms = 1; is = 0; }
          else if (useBias) { bias = sBias * s; if (bias < -CONTACT_PUSH) bias = -CONTACT_PUSH; ms = sMs; is = sIs; }
          else { bias = 0; ms = 1; is = 0; }
          let imp = -cmN[k] * ms * (vn + bias) - is * caccN[k];
          let na = caccN[k] + imp; if (na < 0) na = 0;
          imp = na - caccN[k]; caccN[k] = na;
          const Px = imp * nx, Py = imp * ny;
          vx[b] += mb * Px; vy[b] += mb * Py; vw[b] += ib * (rx * Py - ry * Px);
        }
      }
    }

    // ---- fitness accounting (called at 60 Hz) ---------------------------------------------------------------------------
    account() {
      const plan = this.plan;
      const cx = this.comX();
      if (this.t >= SETTLE_TIME) {
        const pitch = wrapPi(this.pa[0]);
        const hgt = this.py[0] - this.terr._probe(this.px[0]);
        const ll = plan.legLength;
        const gu = clamp((PITCH_ZERO - Math.abs(pitch)) / 0.4, 0, 1) * clamp((hgt / ll - 0.25) / 0.2, 0, 1);
        const gb = this.belly ? 0.25 : 1;
        const dx = cx - this.lastCx;
        // backward progress is always counted in full; forward progress only while upright and off the belly
        this.reward += dx > 0 ? dx * gu * gb : dx;
        this.countT += 1;
        this.stand += this.belly ? 0 : clamp((0.6 - Math.abs(pitch)) / 0.3, 0, 1) * clamp((hgt / ll - 0.6) / 0.2, 0, 1);
        // smoothed "still upright" measure: the score is gated by how the animal ends the run (a face-plant at the end is not free)
        this.upS += ((this.belly ? 0 : gu) - this.upS) * (DT / END_TAU);
        let anyFoot = false; for (let i = 0; i < this.nl; i++) if (this.legTouch[i]) { anyFoot = true; break; }
        if (!anyFoot && !this.belly) this.airT += 1;
        for (let i = 0; i < this.nl; i++) {
          if (!this.legLow[i]) this.legAir[i] += 1;
          if (this.legTouch[i]) this.legGnd[i] += 1;
          if (this.legTouch[i] !== this.prevTouch[i]) this.toggles++;
        }
      }
      for (let i = 0; i < this.nl; i++) this.prevTouch[i] = this.legTouch[i];
      this.lastCx = cx;
      this.lastScore = this.score();
    }

    // signed selection score; the public fitness is max(0, score)
    score() {
      if (!this.alive) return this.frozenScore;
      const air = this.countT > 0 ? this.airT / this.countT : 0;
      const pen = clamp((air - 0.2) / 0.3, 0, 1);
      const eff = this.work / (this.plan.totalMass * GRAV);
      // stepping: every leg must leave the ground for a fair share of the time (kills dragging / skating shuffles)
      // Judged per leg (lifted clear of the ground for a fair share of the time AND bearing weight for a fair share), then
      // blended mean / worst leg so that one skating, dragging or permanently raised leg cannot hide behind the others.
      let lift = 1;
      if (this.countT > 0) {
        let sum = 0, worst = 1;
        for (let i = 0; i < this.nl; i++) {
          const q = clamp(this.legAir[i] / this.countT / LIFT_MIN, 0, 1) * clamp(this.legGnd[i] / this.countT / GND_MIN, 0, 1);
          sum += q; if (q < worst) worst = q;
        }
        lift = 0.5 * (sum / this.nl) + 0.5 * worst;
      }
      // contact chatter: feet toggling faster than a real gait can (buzzing / vibrating hops) are discounted
      const trate = this.countT > 30 ? this.toggles / (this.nl * this.countT * DT) : 0;
      const chat = 1 - CHATTER_MAX * clamp((trate - CHATTER_ON) / CHATTER_SPAN, 0, 1);
      const slipFac = 1 / (1 + SLIP_W * (this.slip * 4 / this.nl) / (Math.abs(this.reward) + 0.5));
      const endFac = END_FLOOR + (1 - END_FLOOR) * this.upS;
      // The style terms (skating, stepping, end posture) bite in proportion to competence: a creature that has hardly moved
      // is ranked by its progress alone (that gradient is what a cold random population learns from); once it really travels,
      // the gait has to be clean too.
      const comp = clamp(this.reward / (COMP_BL * this.plan.bodyLength), 0, 1);
      // standing bonus: full only for animals that also make progress (standing still for 15 s is not a solution)
      const stFac = STAND_PROG + (1 - STAND_PROG) * clamp(this.reward / (STAND_BL * this.plan.bodyLength), 0, 1);
      const gate = (1 - 0.7 * pen) * chat * (1 - comp * this.strict * (1 - slipFac * endFac * (LIFT_FLOOR + (1 - LIFT_FLOOR) * lift)));
      return (this.reward > 0 ? this.reward * gate : this.reward) + STAND_W * stFac * (this.countT > 0 ? this.stand / this.countT : 0) - EFFORT_COST * eff;
    }

    // ---- write the state into a CreatureView ------------------------------------------------------------------------------
    sync(v) {
      const plan = this.plan;
      if (!this.alive) { v.alive = false; v.fitness = Math.max(0, this.frozenScore); return; }
      const px = this.px, py = this.py, pa = this.pa;
      const nodes = plan.nodes, vn = v.nodes;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i], b = n.b, c = Math.cos(pa[b]), s = Math.sin(pa[b]);
        vn[i].x = px[b] + c * n.lx - s * n.ly; vn[i].y = py[b] + s * n.lx + c * n.ly;
      }
      v.x = this.comX(); v.y = this.comY();
      v.h = py[0] - this.terr._probe(px[0]);
      v.angle = wrapPi(pa[0]);
      v.belly = this.belly;
      for (let i = 0; i < this.nl; i++) v.feet[i].contact = this.legTouch[i] === 1;
      v.alive = true;
      v.fitness = Math.max(0, this.score());
    }
    distance() { return this.comX() - this.cx0; }
  }

  // =====================================================================================================================
  // 7. CreatureView factory
  // =====================================================================================================================
  function makeView(plan, id, hue) {
    return {
      id, alive: true, fitness: 0, x: 0, y: 0, h: 0, angle: 0, hue, elite: false, age: 0,
      nodes: plan.nodes.map((n) => ({ x: 0, y: 0, r: n.r })),
      links: plan.links.map((l) => ({ a: l.a, b: l.b, w: l.w, kind: l.kind, leg: l.leg, side: l.side })),
      feet: plan.feetNodes.map((n) => ({ node: n, contact: false })),
      belly: false, bodyLength: plan.bodyLength, legLength: plan.legLength,
    };
  }

  // =====================================================================================================================
  // 8. Arena: one shared world, creatures simulated independently
  // =====================================================================================================================
  class Arena {
    constructor(o) {
      o = o || {};
      this.species = speciesId(o.species);
      this.evolveBody = !!o.evolveBody;
      this.seed = Number.isFinite(o.seed) ? o.seed : 1;
      this.terrain = o._terrain || new Terrain(o.terrain || 'flat', this.seed);
      this.time = 0; this.creatures = []; this._sims = []; this._steps = 0; this._acc = 0;
    }
    add(genome) {
      // the genome carries its own body genes (all 0.5 = the standard body), so a replay always rebuilds the creature that
      // was evolved, whatever the current evolveBody option is
      const g = sanitizeGenome(genome || W.randomGenome(this.species, this.creatures.length + 1), this.species);
      const plan = buildPlan(this.species, g.b, true);
      const sim = new Sim(plan, g, this.terrain, true);
      const view = makeView(plan, this.creatures.length, Number.isFinite(g.hue) ? g.hue : 0);
      sim.step0 = this._steps;
      this._sims.push(sim); this.creatures.push(view);
      sim.sync(view);
      return view;
    }
    // advance every creature by n internal steps (no view sync)
    advance(n) {
      const sims = this._sims;
      for (let i = 0; i < sims.length; i++) { const s = sims[i]; for (let k = 0; k < n; k++) s.step(); }
      this._steps += n; this.time = this._steps * DT;
    }
    syncViews() { for (let i = 0; i < this._sims.length; i++) this._sims[i].sync(this.creatures[i]); }
    step(dt) {
      if (!(dt > 0)) return;                        // NaN, 0, negative: nothing to do (and no time debt)
      this._acc += (dt > MAX_DT ? MAX_DT : dt) * STEP_RATE;
      const n = Math.floor(this._acc + 1e-6);
      if (n > 0) { this._acc -= n; this.advance(n); this.syncViews(); }
    }
  }
  W.Arena = Arena;

  // =====================================================================================================================
  // 9. measure(): deterministic single-creature replay
  // =====================================================================================================================
  W.measure = function (genome, o) {
    o = o || {};
    const sid = speciesId(o.species || (genome && genome.species));
    const seconds = o.seconds || 20;
    const arena = new Arena({ species: sid, terrain: o.terrain || 'flat', seed: o.seed || 1, evolveBody: !!o.evolveBody });
    const v = arena.add(genome);
    const samples = [];
    let minX = 1e9, maxX = -1e9;
    const push = () => {
      const nodes = new Array(v.nodes.length);
      for (let i = 0; i < nodes.length; i++) { const n = v.nodes[i]; nodes[i] = [n.x, n.y]; if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x; }
      samples.push({ t: arena.time, x: v.x, y: v.y, h: v.h, angle: v.angle, belly: v.belly ? 1 : 0, feet: v.feet.map((f) => (f.contact ? 1 : 0)), nodes });
    };
    push();
    const n = Math.round(seconds * 30);
    for (let i = 0; i < n; i++) { arena.step(1 / 30); push(); }
    const x0 = Math.floor((minX - 2) / 0.05) * 0.05, x1 = maxX + 2, y = [];
    for (let x = x0; x <= x1; x += 0.05) y.push(arena.terrain.heightAt(x));
    return {
      dt: 1 / 30, bodyLength: v.bodyLength, legLength: v.legLength,
      links: v.links.map((l) => ({ a: l.a, b: l.b, w: l.w, kind: l.kind })), feetNodes: v.feet.map((f) => f.node),
      groundProfile: { x0, dx: 0.05, y }, samples, fitness: v.fitness,
    };
  };

  // =====================================================================================================================
  // 10. Trainer: genetic algorithm
  // =====================================================================================================================
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const GA = {
    eliteFrac: 0.08, tournament: 3, crossoverP: 0.5, sigma0: 0.12,
    sigmaMin: 0.012, sigmaMax: 0.30, adaptK: 0.5, immigrants: 0,
    pmBase: 0.15, childSigmaSpread: 0.6,
  };

  class Trainer {
    constructor(options, deferInit) {
      this.opts = Object.assign({ species: 'quad', terrain: 'flat', seed: 1, popSize: 48, duration: 15, mutation: 1.0, evolveBody: false }, options || {});
      this._sanitize();
      if (!deferInit) this._init();
    }
    _sanitize() {
      const o = this.opts;
      o.species = speciesId(o.species);
      o.popSize = clamp(Math.round(Number.isFinite(o.popSize) ? o.popSize : 48), 12, 120);
      o.duration = clamp(Number.isFinite(o.duration) ? o.duration : 15, 0.5, 300);
      o.mutation = clamp(Number.isFinite(o.mutation) ? o.mutation : 1, 0.05, 10);
      o.seed = Number.isFinite(o.seed) ? o.seed : 1;
      o.evolveBody = !!o.evolveBody;
      if (!TERRAIN_IDS[o.terrain]) o.terrain = 'flat';
    }
    _init() {
      const o = this.opts;
      this.rng = new RNG(o.seed * 31337 + 17);
      this.generation = 1; this.history = []; this.champions = []; this.best = null;
      this.sigma = GA.sigma0;
      this.pop = [];
      for (let i = 0; i < o.popSize; i++) {
        const g = W.randomGenome(o.species, o.seed * 100003 + i * 7919 + 1, { evolveBody: o.evolveBody });
        this.pop.push({ genome: g, elite: false, age: 0, parentScore: NaN });
      }
      this._acc = 0;
      this._terrain = null;
      this._spawn();
    }
    _spawn() {
      const o = this.opts;
      if (!this._terrain || this._terrain.kind !== o.terrain || this._terrain.seed !== o.seed) this._terrain = new Terrain(o.terrain, o.seed);
      this.arena = new Arena({ species: o.species, terrain: o.terrain, seed: o.seed, evolveBody: o.evolveBody, _terrain: this._terrain });
      this.creatures = [];
      for (let i = 0; i < this.pop.length; i++) {
        const p = this.pop[i];
        const v = this.arena.add(p.genome);
        v.id = i; v.elite = !!p.elite; v.age = p.age | 0; v.hue = p.genome.hue;
        this.creatures.push(v);
      }
      this.duration = o.duration;
      this.genSteps = Math.max(1, Math.round(this.duration * STEP_RATE));
      this.time = 0;
      this._findLeader();
    }
    _findLeader() {
      let l = this.creatures[0];
      for (let i = 1; i < this.creatures.length; i++) { const c = this.creatures[i]; if (c.alive && (c.fitness > l.fitness || !l.alive)) l = c; }
      this.leader = l;
    }

    // advance n internal steps, rolling generations over when they complete
    _advance(n, sync) {
      while (n > 0) {
        const left = this.genSteps - this.arena._steps;
        const m = Math.min(n, left);
        this.arena.advance(m); n -= m;
        if (this.arena._steps >= this.genSteps) this._endGeneration();
      }
      this.time = this.arena._steps * DT;
      if (sync) { this.arena.syncViews(); this._findLeader(); }
    }
    step(dt) {
      if (!(dt > 0)) return;
      this._acc += (dt > MAX_DT ? MAX_DT : dt) * STEP_RATE;
      const n = Math.floor(this._acc + 1e-6);
      if (n > 0) { this._acc -= n; this._advance(n, true); }
    }
    finishGeneration() {
      const g = this.generation;
      while (this.generation === g) this._advance(this.genSteps - this.arena._steps, false);
      this.arena.syncViews(); this._findLeader();
    }
    runGenerations(n) { for (let i = 0; i < n; i++) this.finishGeneration(); }

    _endGeneration() {
      const o = this.opts, sims = this.arena._sims, N = sims.length;
      const scores = new Float64Array(N), dists = new Float64Array(N);
      for (let i = 0; i < N; i++) { scores[i] = sims[i].score(); dists[i] = sims[i].alive ? sims[i].distance() : 0; }
      this.arena.syncViews();
      const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
      const fit = order.map((i) => Math.max(0, scores[i]));
      const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
      const bi = order[0];
      const bestG = clone(this.pop[bi].genome);
      const r4 = (v) => Math.round(v * 1e4) / 1e4;   // 4 decimals keep saves small (history grows with every generation)
      this.history.push({
        gen: this.generation, best: r4(fit[0]), mean: r4(mean(fit)), median: r4(fit[N >> 1]), worst: r4(fit[N - 1]),
        bestDist: r4(dists[bi]), meanDist: r4(mean(Array.from(dists))), sigma: r4(this.sigma * o.mutation), terrain: o.terrain,
      });
      this.champions.push({ gen: this.generation, fitness: fit[0], dist: dists[bi], genome: bestG });
      if (!this.best || fit[0] > this.best.fitness) this.best = { fitness: fit[0], dist: dists[bi], genome: clone(bestG), gen: this.generation, species: o.species, terrain: o.terrain, seed: o.seed, evolveBody: o.evolveBody };
      if (this.champions.length > 300) this._thinChampions();
      this._breed(order, scores);
      this.generation++;
      this._spawn();
    }

    // keep <= 300 champions: the newest 150 stay dense, older ones are thinned on the GENERATION NUMBER (every 2nd, 4th, 8th ...
    // generation, so the spacing stays even and the gallery never collapses to "gen 1, then a huge gap"). Gen 1 and the
    // all-time best always stay.
    _thinChampions() {
      const list = this.champions, keepFrom = list.length - 150, bestGen = this.best ? this.best.gen : -1;
      const old = list.slice(0, keepFrom), recent = list.slice(keepFrom);
      let step = 2, kept = old;
      for (; step < 1 << 30; step *= 2) {
        kept = old.filter((c) => c.gen === 1 || c.gen === bestGen || c.gen % step === 0);
        if (kept.length <= 150) break;
      }
      this.champions = kept.concat(recent);
    }

    _tournament(order, k) {
      // order = indices sorted best -> worst; pick the best of k random ranks
      let best = order.length; const n = order.length;
      for (let i = 0; i < k; i++) { const r = Math.floor(this.rng.next() * n); if (r < best) best = r; }
      return order[Math.min(best, n - 1)];
    }

    _breed(order, scores) {
      const o = this.opts, rng = this.rng, N = order.length, nl = speciesDef(o.species).legs;
      // ---- adapt sigma with the 1/5 success rule: did the children beat their parents?
      let tried = 0, won = 0;
      for (let i = 0; i < N; i++) {
        const p = this.pop[i];
        if (!p.elite && Number.isFinite(p.parentScore)) { tried++; if (scores[i] > p.parentScore + 1e-9) won++; }
      }
      if (tried > 0) {
        const ps = won / tried;
        this.sigma = clamp(this.sigma * Math.exp(GA.adaptK * (ps - 0.2)), GA.sigmaMin, GA.sigmaMax);
      }
      const newN = o.popSize;
      const nElite = Math.max(1, Math.min(newN - 1, Math.round(newN * GA.eliteFrac)));
      const next = [];
      for (let e = 0; e < Math.min(nElite, N); e++) {
        const src = this.pop[order[e]];
        // with evolveBody switched off a surviving evolved body goes back to the standard plan (its gait is kept)
        const eg = !o.evolveBody && src.genome.b && src.genome.b.some((v) => v !== 0.5) ? Object.assign({}, src.genome, { b: new Array(NB).fill(0.5) }) : src.genome;
        next.push({ genome: eg, elite: true, age: src.age + 1, parentScore: NaN });
      }
      const gl = genomeLength(nl);
      const nImm = Math.round(GA.immigrants * newN);
      for (let k = 0; k < nImm && next.length < newN; k++) {
        const ig = W.randomGenome(o.species, Math.floor(rng.next() * 1e9), { evolveBody: o.evolveBody });
        next.push({ genome: ig, elite: false, age: 0, parentScore: NaN });
      }
      while (next.length < newN) {
        const ia = this._tournament(order, GA.tournament), pa = this.pop[ia];
        let ga = pa.genome.g, gb = null, hue = pa.genome.hue, ba = pa.genome.b, bb = null;
        let pScore = scores[ia];
        if (rng.next() < GA.crossoverP) {
          const ib = this._tournament(order, GA.tournament), pb = this.pop[ib];
          gb = pb.genome.g; bb = pb.genome.b;
          pScore = Math.max(scores[ia], scores[ib]);   // success = beats the better parent
        }
        const g = new Array(gl), b = new Array(NB);
        // crossover: per-leg blocks for leg genes, per-gene for global genes
        for (let i = 0; i < NG; i++) g[i] = gb && rng.next() < 0.5 ? gb[i] : ga[i];
        for (let l = 0; l < nl; l++) {
          const fromB = gb && rng.next() < 0.5;
          for (let k = 0; k < NL; k++) { const i = NG + l * NL + k; g[i] = fromB ? gb[i] : ga[i]; }
        }
        for (let i = 0; i < NB; i++) b[i] = bb && rng.next() < 0.5 ? bb[i] : (ba ? ba[i] : 0.5);
        // mutation: per-child step size (log-normal around sigma), each gene mutates with probability pm
        const s = this.sigma * o.mutation * Math.exp(GA.childSigmaSpread * rng.gauss());
        const pm = clamp(4 / gl + GA.pmBase, GA.pmBase, 0.6);
        for (let i = 0; i < gl; i++) {
          if (rng.next() < pm) {
            let v = g[i] + s * geneScale(i) * rng.gauss();
            if (geneKind(i) === 'circ') v -= Math.floor(v); else v = v < 0 ? -v : v > 1 ? 2 - v : v;
            g[i] = clamp(v, 0, 1);
          }
        }
        if (o.evolveBody) for (let i = 0; i < NB; i++) { if (rng.next() < pm) b[i] = clamp(b[i] + s * 0.8 * rng.gauss(), 0, 1); }
        else b.fill(0.5);
        hue = (hue + 4 * rng.gauss() + 360) % 360;
        next.push({ genome: { v: 1, species: o.species, hue: Math.round(hue * 10) / 10, g, b }, elite: false, age: 0, parentScore: pScore });
      }
      this.pop = next;
    }

    setOptions(p) {
      p = p || {};
      const o = this.opts;
      if (p.species !== undefined && speciesId(p.species) !== o.species) { this.reset(Object.assign({}, p)); return; }
      if (p.mutation !== undefined) o.mutation = clamp(Number.isFinite(p.mutation) ? p.mutation : 1, 0.05, 10);
      if (p.popSize !== undefined) o.popSize = clamp(Math.round(Number.isFinite(p.popSize) ? p.popSize : 48), 12, 120);
      if (p.duration !== undefined) o.duration = clamp(Number.isFinite(p.duration) ? p.duration : 15, 0.5, 300);
      if (p.evolveBody !== undefined) o.evolveBody = !!p.evolveBody;
      if (p.terrain !== undefined && TERRAIN_IDS[p.terrain] && p.terrain !== o.terrain) {
        o.terrain = p.terrain;
        this.duration = this.duration;   // keep the running generation length
        const keepGen = this.genSteps;
        for (const p of this.pop) p.parentScore = NaN;   // scores of the old terrain say nothing about the new one (1/5 rule)
        this._spawnKeep(keepGen);
      }
    }
    _spawnKeep(genSteps) { this._spawn(); this.genSteps = genSteps; this.duration = genSteps / STEP_RATE; }
    reset(newOptions) {
      if (newOptions) Object.assign(this.opts, newOptions);
      this._sanitize();
      this._init();
    }

    serialize() {
      return clone({
        version: 1, options: this.opts, generation: this.generation, history: this.history, champions: this.champions, best: this.best,
        population: this.pop, rng: this.rng.s, sigma: this.sigma, steps: this.arena._steps, acc: this._acc, duration: this.duration,
      });
    }
    static deserialize(s) {
      s = s && typeof s === 'object' ? s : {};
      const t = new Trainer(s.options, true);              // options (incl. a pending popSize change) are restored as saved
      const sid = t.opts.species;
      const popIn = Array.isArray(s.population) ? s.population.filter((p) => p && typeof p === 'object' && p.genome && typeof p.genome === 'object') : [];
      if (!popIn.length) { t._init(); return t; }         // unusable save: start a fresh run instead of failing later
      t.rng = new RNG(t.opts.seed * 31337 + 17);
      if (Number.isFinite(s.rng)) t.rng.s = s.rng >>> 0;
      t.generation = Number.isFinite(s.generation) ? Math.max(1, Math.floor(s.generation)) : 1;
      t.history = Array.isArray(s.history) ? clone(s.history) : [];
      t.champions = Array.isArray(s.champions) ? clone(s.champions) : [];
      t.best = s.best && s.best.genome ? clone(s.best) : null;
      t.sigma = Number.isFinite(s.sigma) ? clamp(s.sigma, GA.sigmaMin, GA.sigmaMax) : GA.sigma0;
      t.pop = popIn.map((p) => ({ genome: sanitizeGenome(p.genome, sid), elite: !!p.elite, age: Number.isFinite(p.age) ? p.age | 0 : 0, parentScore: Number.isFinite(p.parentScore) ? p.parentScore : NaN }));
      t._acc = Number.isFinite(s.acc) ? clamp(s.acc, 0, 1) : 0;
      t._terrain = null;
      t._spawn();
      if (Number.isFinite(s.duration) && s.duration > 0) { t.genSteps = Math.max(1, Math.round(s.duration * STEP_RATE)); t.duration = s.duration; }
      const steps = Number.isFinite(s.steps) ? Math.min(Math.floor(s.steps), t.genSteps - 1) : 0;
      if (steps > 0) { t.arena.advance(steps); t.time = t.arena._steps * DT; t.arena.syncViews(); t._findLeader(); }
      return t;
    }
  }
  const TERRAIN_IDS = { flat: 1, hills: 1, rough: 1, steps: 1 };
  W.Trainer = Trainer;

  return W;
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Walkers; else (typeof window !== 'undefined' ? window : globalThis).Walkers = Walkers;
