// src/store/decisionLogRepository.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from './db.js';
import { DecisionLogRepository } from './decisionLogRepository.js';

let db: Database.Database;
let repo: DecisionLogRepository;

beforeEach(() => {
  db = createDb(':memory:');
  repo = new DecisionLogRepository(db);
});

describe('DecisionLogRepository', () => {
  it('logs an entry and reads it back', () => {
    repo.log({
      timestamp: new Date('2026-08-27T00:00:00.000Z'),
      poolAddress: 'POOL1',
      stage: 'FILTER',
      decision: 'REJECTED',
      reason: 'liquidité insuffisante',
    });

    const recent = repo.getRecent(10);

    expect(recent).toHaveLength(1);
    expect(recent[0].poolAddress).toBe('POOL1');
    expect(recent[0].decision).toBe('REJECTED');
  });

  it('returns the most recent entries first, limited to `limit`', () => {
    for (let i = 0; i < 5; i++) {
      repo.log({
        timestamp: new Date(),
        poolAddress: `POOL${i}`,
        stage: 'SIGNAL',
        decision: 'HOLD',
        reason: 'test',
      });
    }

    const recent = repo.getRecent(2);

    expect(recent).toHaveLength(2);
    expect(recent[0].poolAddress).toBe('POOL4');
  });
});
