import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSatelliteGuards, DEFAULT_SATELLITE_GUARDS, isStopRequested, startOfUtcDay, type GuardInput } from './guards.js';
import type { Position } from '../types.js';

function position(overrides: Partial<Position> = {}): Position {
  return {
    id: 1,
    strategy: 'hourly',
    poolAddress: 'POOL',
    baseTokenAddress: 'TOKEN',
    baseTokenSymbol: 'FOO',
    entryPriceUsd: 1,
    sizeUsd: 10,
    stopLossPrice: 0.8,
    takeProfitPrice: 1.5,
    trailingStopPct: 15,
    highestPriceUsd: 1,
    openedAt: new Date('2026-11-26T08:00:00Z'),
    status: 'OPEN',
    ...overrides,
  };
}

const base: GuardInput = {
  strategy: 'hourly',
  capitalUsd: 100,
  newPositionSizeUsd: 10,
  openPositions: [],
  closedToday: [],
  stopRequested: false,
  settings: DEFAULT_SATELLITE_GUARDS,
};

describe('checkSatelliteGuards', () => {
  it('autorise une position quand aucune limite n’est atteinte', () => {
    expect(checkSatelliteGuards(base)).toEqual({ allowed: true });
  });

  it('bloque tout quand l’interrupteur STOP est présent', () => {
    const decision = checkSatelliteGuards({ ...base, stopRequested: true });

    expect(decision).toMatchObject({ allowed: false, reason: expect.stringMatching(/STOP/) });
  });

  it('déclenche le coupe-circuit à 5 % de perte réalisée dans la journée', () => {
    const closedToday = [
      position({ status: 'CLOSED', pnlUsd: -3 }),
      position({ id: 2, status: 'CLOSED', pnlUsd: -2.5 }),
      position({ id: 3, status: 'CLOSED', pnlUsd: 0.5 }),
    ];

    const decision = checkSatelliteGuards({ ...base, closedToday });

    expect(decision).toMatchObject({ allowed: false, reason: expect.stringMatching(/Coupe-circuit.*5\.00\$/) });
  });

  it('laisse passer une perte du jour sous la limite', () => {
    const closedToday = [position({ status: 'CLOSED', pnlUsd: -4.99 })];

    expect(checkSatelliteGuards({ ...base, closedToday }).allowed).toBe(true);
  });

  it('ne compte que les pertes de sa propre stratégie (budgets séparés)', () => {
    const closedToday = [position({ strategy: 'snipe', status: 'CLOSED', pnlUsd: -20 })];

    expect(checkSatelliteGuards({ ...base, closedToday }).allowed).toBe(true);
  });

  it('refuse une position qui ferait dépasser 50 % d’exposition', () => {
    const openPositions = [1, 2, 3, 4, 5].map((id) => position({ id }));

    const decision = checkSatelliteGuards({ ...base, openPositions });

    expect(decision).toMatchObject({ allowed: false, reason: expect.stringMatching(/Exposition maximale.*50\.00\$/) });
  });

  it('accepte une position qui amène l’exposition exactement à la limite', () => {
    const openPositions = [1, 2, 3, 4].map((id) => position({ id }));

    expect(checkSatelliteGuards({ ...base, openPositions }).allowed).toBe(true);
  });
});

describe('startOfUtcDay', () => {
  it('ramène à minuit UTC', () => {
    expect(startOfUtcDay(new Date('2026-11-26T23:59:00Z')).toISOString()).toBe('2026-11-26T00:00:00.000Z');
  });
});

describe('isStopRequested', () => {
  it('suit la présence du fichier', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stop-')), 'STOP');

    expect(isStopRequested(file)).toBe(false);
    fs.writeFileSync(file, '');
    expect(isStopRequested(file)).toBe(true);
  });
});
