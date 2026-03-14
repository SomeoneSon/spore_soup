// brain/neat.js — Modular neural network: Core Brain + Part Modules
//
// Core Brain:  16 inputs → 12 hidden (tanh) → 3 outputs (thrust 0..1, turn -1..1, memory -1..1)
// Part Module: 4 inputs (from hidden) → 4 hidden (tanh) → 1 output (e.g. fin_flap)
//
// Genome = { core: Float64Array, modules: [{ type, weights: Float64Array }] }

const CORE_INPUTS  = 16;
const CORE_HIDDEN  = 12;
const CORE_OUTPUTS = 3;    // thrust, turn, memory

// Weight counts
const CORE_IH = CORE_INPUTS  * CORE_HIDDEN;           // input → hidden
const CORE_HB = CORE_HIDDEN;                           // hidden biases
const CORE_HO = CORE_HIDDEN  * CORE_OUTPUTS;           // hidden → output
const CORE_OB = CORE_OUTPUTS;                           // output biases
const CORE_WEIGHT_COUNT = CORE_IH + CORE_HB + CORE_HO + CORE_OB;  // 16*12+12+12*3+3 = 231

// Part module sizing
const MOD_INPUTS  = 4;
const MOD_HIDDEN  = 4;
const MOD_OUTPUTS = 1;
const MOD_WEIGHT_COUNT = MOD_INPUTS * MOD_HIDDEN + MOD_HIDDEN + MOD_HIDDEN * MOD_OUTPUTS + MOD_OUTPUTS; // 4*4+4+4*1+1 = 25

export { CORE_WEIGHT_COUNT, MOD_WEIGHT_COUNT, CORE_HIDDEN };

// --- NeatBrain class -------------------------------------------------------

export class NeatBrain {
  constructor(genome = null) {
    if (genome) {
      this.genome = genome;
    } else {
      this.genome = {
        core: _randomWeights(CORE_WEIGHT_COUNT),
        modules: [],
      };
    }
    // reusable hidden activation buffer
    this._hidden = new Float64Array(CORE_HIDDEN);
  }

  /**
   * Forward pass. Returns { thrust, turn, memory, modules: number[] }.
   * @param {number[]} inputs — 16 floats
   */
  forward(inputs) {
    const w = this.genome.core;
    const h = this._hidden;

    // --- Core: input → hidden (tanh) ---
    let off = 0;
    for (let j = 0; j < CORE_HIDDEN; j++) {
      let sum = 0;
      for (let i = 0; i < CORE_INPUTS; i++) {
        sum += inputs[i] * w[off++];
      }
      sum += w[CORE_IH + j];   // bias
      h[j] = Math.tanh(sum);
    }

    // --- Core: hidden → output ---
    off = CORE_IH + CORE_HB;
    const out = [];
    for (let k = 0; k < CORE_OUTPUTS; k++) {
      let sum = 0;
      for (let j = 0; j < CORE_HIDDEN; j++) {
        sum += h[j] * w[off++];
      }
      sum += w[CORE_IH + CORE_HB + CORE_HO + k];   // output bias
      out.push(sum);
    }

    // activations: thrust=sigmoid(0..1), turn=tanh(-1..1), memory=tanh(-1..1)
    const thrust = _sigmoid(out[0]);
    const turn   = Math.tanh(out[1]);
    const memory = Math.tanh(out[2]);

    // --- Part modules (fin_flap etc.) ---
    const moduleOutputs = [];
    for (const mod of this.genome.modules) {
      moduleOutputs.push(_forwardModule(mod.weights, h));
    }

    return { thrust, turn, memory, modules: moduleOutputs };
  }

  /** Number of total weights (for info) */
  get weightCount() {
    return CORE_WEIGHT_COUNT + this.genome.modules.length * MOD_WEIGHT_COUNT;
  }
}

// --- Module forward --------------------------------------------------------

function _forwardModule(w, coreHidden) {
  // pick first 4 hidden neurons as input
  let off = 0;
  const h = new Float64Array(MOD_HIDDEN);
  for (let j = 0; j < MOD_HIDDEN; j++) {
    let sum = 0;
    for (let i = 0; i < MOD_INPUTS; i++) {
      sum += coreHidden[i] * w[off++];
    }
    sum += w[MOD_INPUTS * MOD_HIDDEN + j];
    h[j] = Math.tanh(sum);
  }

  off = MOD_INPUTS * MOD_HIDDEN + MOD_HIDDEN;
  let sum = 0;
  for (let j = 0; j < MOD_HIDDEN; j++) {
    sum += h[j] * w[off++];
  }
  sum += w[off];  // output bias
  return Math.tanh(sum);
}

// --- Helpers ---------------------------------------------------------------

function _sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function _randomWeights(n) {
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = (Math.random() - 0.5) * 2;   // uniform [-1, 1]
  }
  return a;
}

// --- Genome utilities (used by pool.js) ------------------------------------

/** Deep-clone a genome */
export function cloneGenome(g) {
  return {
    core: new Float64Array(g.core),
    modules: g.modules.map(m => ({
      type: m.type,
      weights: new Float64Array(m.weights),
    })),
  };
}

/** Mutate genome in-place */
export function mutateGenome(g, rate = 0.1, strength = 0.3) {
  _mutateArray(g.core, rate, strength);
  for (const m of g.modules) {
    _mutateArray(m.weights, rate, strength);
  }
}

function _mutateArray(arr, rate, strength) {
  for (let i = 0; i < arr.length; i++) {
    if (Math.random() < rate) {
      arr[i] += (Math.random() - 0.5) * 2 * strength;
      // clamp to reasonable range
      if (arr[i] > 4) arr[i] = 4;
      if (arr[i] < -4) arr[i] = -4;
    }
  }
}

/** Crossover: uniform mix of two genomes */
export function crossover(a, b) {
  const child = cloneGenome(a);
  for (let i = 0; i < child.core.length; i++) {
    if (Math.random() < 0.5) child.core[i] = b.core[i];
  }
  // modules: match by index (same body plan assumed)
  const minMod = Math.min(child.modules.length, b.modules.length);
  for (let m = 0; m < minMod; m++) {
    for (let i = 0; i < child.modules[m].weights.length; i++) {
      if (Math.random() < 0.5) child.modules[m].weights[i] = b.modules[m].weights[i];
    }
  }
  return child;
}

/** Create a random genome (for a fresh creature) */
export function randomGenome() {
  return {
    core: _randomWeights(CORE_WEIGHT_COUNT),
    modules: [],
  };
}
