import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from './db.js';
import { FirstSeenRepository } from './firstSeenRepository.js';

let db: Database.Database;
let repo: FirstSeenRepository;

beforeEach(() => {
  db = createDb(':memory:');
  repo = new FirstSeenRepository(db);
});

describe('FirstSeenRepository', () => {
  it('records and returns the given date the first time a pool is seen', () => {
    const now = new Date('2026-08-29T00:00:00.000Z');

    const firstSeenAt = repo.getOrRecordFirstSeen('POOL1', now);

    expect(firstSeenAt).toEqual(now);
  });

  it('keeps returning the original first-seen date on later calls, not the new "now"', () => {
    const firstCycle = new Date('2026-08-29T00:00:00.000Z');
    const laterCycle = new Date('2026-08-29T02:00:00.000Z');
    repo.getOrRecordFirstSeen('POOL1', firstCycle);

    const firstSeenAt = repo.getOrRecordFirstSeen('POOL1', laterCycle);

    expect(firstSeenAt).toEqual(firstCycle);
  });

  it('tracks each pool address independently', () => {
    const now = new Date('2026-08-29T00:00:00.000Z');
    repo.getOrRecordFirstSeen('POOL1', now);

    const firstSeenAt = repo.getOrRecordFirstSeen('POOL2', now);

    expect(firstSeenAt).toEqual(now);
  });
});
