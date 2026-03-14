// creature/parts.js — Body part catalog & slot logic

/**
 * Part definitions.
 * Each part has: id, name, slot type, cost (genes), layer unlock, effects
 */
export const PARTS = {
  eye: {
    id: 'eye',
    name: 'Глаз',
    slot: 'side',        // side slot (any segment)
    cost: 30,
    unlockedAt: 0,       // layer 0 = available from start
    max: 2,
    effect: { sensorRange: 60, extraRays: true },
    description: '+60px обзор, +лучи',
  },
  cilia: {
    id: 'cilia',
    name: 'Усики',
    slot: 'front',       // head front only
    cost: 50,
    unlockedAt: 0,
    max: 1,
    incompatible: ['mouth'],
    effect: { eatGrass: 1.0 },
    description: 'Есть траву (100%)',
  },
  fin: {
    id: 'fin',
    name: 'Плавник',
    slot: 'side',
    cost: 80,
    unlockedAt: 1,
    max: 4,
    effect: { speedBoost: true, nnOutput: 'fin_flap' },
    description: 'Буст скорости (расход энергии)',
  },
  mouth: {
    id: 'mouth',
    name: 'Рот хищника',
    slot: 'front',
    cost: 100,
    unlockedAt: 2,
    max: 1,
    incompatible: ['cilia'],
    effect: { eatMeat: 1.0, bite: true },
    description: 'Есть мясо/существ (100%)',
  },
  spike: {
    id: 'spike',
    name: 'Шип',
    slot: 'side',
    cost: 120,
    unlockedAt: 3,
    max: 4,
    effect: { contactDamage: true },
    description: 'Урон при скорости',
  },
};

/** Get available parts for a given layer */
export function getAvailableParts(layer = 0) {
  return Object.values(PARTS).filter(p => p.unlockedAt <= layer);
}

/**
 * Count parts of a given type on a body.
 * body.parts is expected to be an array of part IDs: ['eye', 'eye', 'fin']
 */
export function countParts(body, partId) {
  if (!body.parts) return 0;
  return body.parts.filter(p => p === partId).length;
}

/**
 * Get total cost of all parts on a body.
 */
export function totalPartsCost(parts) {
  let cost = 0;
  for (const id of parts) {
    if (PARTS[id]) cost += PARTS[id].cost;
  }
  return cost;
}

/**
 * Check if a part can be added to a body.
 * Returns { ok: boolean, reason?: string }
 */
export function canAddPart(body, partId, segmentIndex) {
  const def = PARTS[partId];
  if (!def) return { ok: false, reason: 'Неизвестная часть' };

  const current = countParts(body, partId);
  if (current >= def.max) return { ok: false, reason: `Макс ${def.max}` };

  // Check incompatibilities
  if (def.incompatible) {
    for (const inc of def.incompatible) {
      if (countParts(body, inc) > 0) {
        return { ok: false, reason: `Несовместим с ${PARTS[inc]?.name || inc}` };
      }
    }
  }

  // Check segment slot capacity (max 2 side parts per segment)
  const seg = body.segments[segmentIndex];
  if (seg && seg.parts && seg.parts.length >= 2 && def.slot === 'side') {
    return { ok: false, reason: 'Слот занят' };
  }

  return { ok: true };
}
