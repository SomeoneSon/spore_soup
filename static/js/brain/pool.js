// brain/pool.js — Genome pool: archive, selection, mutation, crossover, generations
import { cloneGenome, mutateGenome, crossover, randomGenome } from './neat.js';

const ARCHIVE_SIZE     = 200;
const ELITE_FRACTION   = 0.2;    // top 20% reproduce
const CROSSOVER_RATE   = 0.5;    // probability of crossover vs pure mutation
const BASE_MUTATION_RATE     = 0.10;
const BASE_MUTATION_STRENGTH = 0.30;
const STAGNATION_GENS  = 5;      // gens without improvement → boost mutation
const SPECIES_THRESHOLD = 3.0;   // genome distance threshold for speciation
const NUM_SPECIES       = 4;     // target number of species niches

export class GenomePool {
  constructor(populationSize = 30) {
    this.populationSize = populationSize;
    this.archive   = [];           // sorted best-first
    this.generation = 0;
    this.bestFitness = -Infinity;
    this.avgFitness  = 0;
    this._stagnation = 0;          // generations without improvement
    this._history    = [];         // { gen, best, avg } per generation
  }

  /**
   * Create initial random population of genomes.
   * @returns {object[]} array of genome objects
   */
  initPopulation() {
    const genomes = [];
    for (let i = 0; i < this.populationSize; i++) {
      genomes.push(randomGenome());
    }
    return genomes;
  }

  /**
   * End-of-generation: receive scored creatures, produce next generation.
   * @param {{ genome: object, fitness: number }[]} scored
   * @returns {object[]}  new genomes for next generation
   */
  evolve(scored) {
    // Sort by fitness descending
    scored.sort((a, b) => b.fitness - a.fitness);

    const best = scored[0].fitness;
    const avg  = scored.reduce((s, c) => s + c.fitness, 0) / scored.length;

    // Update archive
    for (const s of scored) {
      this._insertArchive(s.genome, s.fitness);
    }

    // Stagnation detection — bestFitness decays so lucky-layout peaks don't block progress
    this.bestFitness *= 0.995;
    if (best > this.bestFitness + 0.5) {
      this.bestFitness = best;
      this._stagnation = 0;
    } else {
      this._stagnation++;
    }

    // Hard reset after extreme stagnation (safety valve)
    if (this._stagnation >= STAGNATION_GENS * 6) { // 30 gens
      this.bestFitness = best;
      this._stagnation = 0;
    }

    this.avgFitness = avg;
    this._history.push({ gen: this.generation, best, avg });
    this.generation++;

    // Adaptive mutation — escalates with stagnation
    const stagnant = this._stagnation >= STAGNATION_GENS;
    const deepStagnant = this._stagnation >= STAGNATION_GENS * 3;  // 15+ gens
    const mutRate = deepStagnant ? BASE_MUTATION_RATE * 4
      : stagnant ? BASE_MUTATION_RATE * 2
      : BASE_MUTATION_RATE;
    const mutStr = deepStagnant ? BASE_MUTATION_STRENGTH * 3
      : stagnant ? BASE_MUTATION_STRENGTH * 2
      : BASE_MUTATION_STRENGTH;

    // --- Build next generation with fitness sharing / speciation ---
    // Group scored individuals into species by genome distance
    const species = _speciate(scored.map(s => s.genome), scored.map(s => s.fitness));

    // Compute shared fitness: each individual's fitness / species size
    // This prevents one species from dominating
    const sharedScores = [];
    for (const sp of species) {
      for (const idx of sp.members) {
        sharedScores.push({
          genome: scored[idx].genome,
          fitness: scored[idx].fitness,
          sharedFitness: scored[idx].fitness / sp.members.length,
          speciesId: sp.id,
        });
      }
    }

    // Sort by shared fitness for archive/elite purposes
    sharedScores.sort((a, b) => b.sharedFitness - a.sharedFitness);

    const eliteCount = Math.max(2, Math.floor(scored.length * ELITE_FRACTION));

    // Mix in top archive genomes
    const archiveTop = this.archive.slice(0, eliteCount).map(a => a.genome);

    const nextGen = [];

    // Keep best genome unchanged (elitism)
    nextGen.push(cloneGenome(scored[0].genome));

    // Inject random genomes on deep stagnation (25% of population)
    if (deepStagnant) {
      const randomCount = Math.floor(this.populationSize * 0.25);
      for (let i = 0; i < randomCount && nextGen.length < this.populationSize; i++) {
        nextGen.push(randomGenome());
      }
    }

    // Allocate remaining slots proportionally to species total shared fitness
    const remaining = this.populationSize - nextGen.length;
    const totalSharedFit = species.reduce((s, sp) => s + sp.totalFitness, 0) || 1;

    for (const sp of species) {
      const slots = Math.max(1, Math.round((sp.totalFitness / totalSharedFit) * remaining));
      // Build species-local elite pool
      const spElites = sp.members
        .map(idx => scored[idx])
        .sort((a, b) => b.fitness - a.fitness)
        .slice(0, Math.max(2, Math.ceil(sp.members.length * 0.3)))
        .map(s => s.genome);

      // Add archive genomes to species pool for diversity
      for (const ag of archiveTop) {
        spElites.push(ag);
      }

      for (let i = 0; i < slots && nextGen.length < this.populationSize; i++) {
        let child;
        if (Math.random() < CROSSOVER_RATE && spElites.length >= 2) {
          const pA = _tournamentSelect(spElites);
          const pB = _tournamentSelect(spElites);
          child = crossover(pA, pB);
        } else {
          child = cloneGenome(_tournamentSelect(spElites));
        }
        mutateGenome(child, mutRate, mutStr);
        nextGen.push(child);
      }
    }

    // Fill any remaining slots from global elites
    while (nextGen.length < this.populationSize) {
      const globalElites = scored.slice(0, eliteCount).map(s => s.genome);
      let child = cloneGenome(_tournamentSelect(globalElites));
      mutateGenome(child, mutRate, mutStr);
      nextGen.push(child);
    }

    return nextGen;
  }

  /** Insert into archive (keep top N by fitness) */
  _insertArchive(genome, fitness) {
    this.archive.push({ genome: cloneGenome(genome), fitness });
    this.archive.sort((a, b) => b.fitness - a.fitness);
    if (this.archive.length > ARCHIVE_SIZE) {
      this.archive.length = ARCHIVE_SIZE;
    }
  }

  /** History for graphing */
  get history() { return this._history; }
}

// --- Tournament selection: pick best of 3 random from scored list ---
function _tournamentSelect(elites) {
  const size = Math.min(3, elites.length);
  let bestIdx = Math.floor(Math.random() * elites.length);
  for (let i = 1; i < size; i++) {
    const idx = Math.floor(Math.random() * elites.length);
    // Lower index = better fitness (elites are sorted best-first)
    if (idx < bestIdx) bestIdx = idx;
  }
  return elites[bestIdx];
}

// --- Genome distance (for speciation) ---
function _genomeDistance(a, b) {
  // Euclidean distance of core weights, sampled for speed
  const wa = a.core;
  const wb = b.core;
  const len = Math.min(wa.length, wb.length);
  // Sample every 4th weight for speed (231/4 ≈ 58 comparisons)
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < len; i += 4) {
    const d = wa[i] - wb[i];
    sumSq += d * d;
    count++;
  }
  return Math.sqrt(sumSq / (count || 1));
}

// --- Speciation: group genomes into species by distance ---
function _speciate(genomes, fitnesses) {
  if (genomes.length === 0) return [];

  // Pick NUM_SPECIES random centroids from the population
  const centroids = [];
  const used = new Set();
  const numSpecies = Math.min(NUM_SPECIES, genomes.length);
  
  // Pick diverse centroids: first is best, rest are random
  centroids.push(0);
  used.add(0);
  while (centroids.length < numSpecies) {
    const idx = Math.floor(Math.random() * genomes.length);
    if (!used.has(idx)) {
      centroids.push(idx);
      used.add(idx);
    }
  }

  // Assign each genome to nearest centroid
  const species = centroids.map((c, i) => ({
    id: i,
    centroidIdx: c,
    members: [],
    totalFitness: 0,
  }));

  for (let i = 0; i < genomes.length; i++) {
    let bestSp = 0;
    let bestDist = Infinity;
    for (let s = 0; s < species.length; s++) {
      const d = _genomeDistance(genomes[i], genomes[species[s].centroidIdx]);
      if (d < bestDist) {
        bestDist = d;
        bestSp = s;
      }
    }
    species[bestSp].members.push(i);
    species[bestSp].totalFitness += fitnesses[i];
  }

  // Remove empty species
  return species.filter(sp => sp.members.length > 0);
}
