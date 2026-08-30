# Sniper pump.fun (paper trading) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buy newly-created pump.fun tokens in paper trading within seconds of launch, via a real-time PumpPortal WebSocket feed, running alongside the existing hourly RSI/SMA strategy without disturbing it.

**Architecture:** A second, independent async flow inside the same `main.ts` process: a WebSocket client (`pumpPortalClient.ts`) emits normalized `NewTokenEvent`s; a pure filter (`snipeFilter.ts`) and a pure risk function (`snipeRisk.ts`) decide whether/how big to buy; a fast review loop (every few seconds) closes sniped positions on take-profit, stop-loss, or a hold-time timeout. Snipe positions share the existing `positions` table (tagged with a new `strategy` column) and reuse `PositionRepository`, `Notifier`, and `PaperExecutor` — only the decision logic and the timing are new.

**Tech Stack:** TypeScript, Node's built-in global `WebSocket` (no new dependency — same policy as the rest of the project, which already uses native `fetch` everywhere), better-sqlite3, vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-pumpfun-sniper-design.md`

## Global Constraints

- Paper trading only — no real wallet, no private key, no real execution (`PaperExecutor` only).
- No new npm dependency for the WebSocket client — use the global `WebSocket` (Node 22+, already available on this project's Node 24).
- No API key required for PumpPortal's `subscribeNewToken` (it's the free tier).
- Every new/modified function gets a failing test before implementation (TDD), following the exact style of the existing test suite (`vi.stubGlobal` for network globals, `vi.fn()` mocks for injected dependencies).
- Existing tests must keep passing unmodified unless a task explicitly says to change one — most of this plan is additive (optional parameters with defaults, new columns with migrations), specifically to avoid touching already-approved, already-tested behavior.
- Run `npm run typecheck` and `npm test` at the end of every task.

---

### Task 1: Types and schema foundation — `strategy` tag, `TIMEOUT` reason, `SNIPE` log stage

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store/decisionLogRepository.ts`
- Modify: `src/store/db.ts`
- Modify: `src/store/positionRepository.ts`
- Modify: `src/store/positionRepository.test.ts`

**Interfaces:**
- Produces: `Position.strategy: 'hourly' | 'snipe'` (always present on read), `NewPositionData.strategy?: 'hourly' | 'snipe'` (optional on write, defaults to `'hourly'`), `CloseReason` now includes `'TIMEOUT'`, `DecisionLogEntry['stage']` now includes `'SNIPE'`.

This task lets snipe positions live in the same `positions` table as the hourly strategy's positions, distinguishable by `strategy`, without touching any existing call site (every existing `openPosition({...})` call omits `strategy` and still gets `'hourly'` by default).

- [ ] **Step 1: Write the failing test for `strategy` defaulting and round-tripping**

Add to `src/store/positionRepository.test.ts`, inside the existing `describe('PositionRepository', ...)` block:

```ts
  it('defaults strategy to "hourly" when not specified, and stores an explicit "snipe"', () => {
    const hourlyPosition = repo.openPosition({
      poolAddress: 'POOL1',
      baseTokenAddress: 'TOKEN1',
      baseTokenSymbol: 'FOO',
      entryPriceUsd: 1,
      sizeUsd: 10,
      stopLossPrice: 0.8,
      takeProfitPrice: 1.5,
      trailingStopPct: 15,
      openedAt: new Date(),
    });
    expect(hourlyPosition.strategy).toBe('hourly');

    const snipePosition = repo.openPosition({
      poolAddress: 'POOL2',
      baseTokenAddress: 'TOKEN2',
      baseTokenSymbol: 'BAR',
      entryPriceUsd: 1,
      sizeUsd: 2,
      stopLossPrice: 0.6,
      takeProfitPrice: 2,
      trailingStopPct: 100,
      openedAt: new Date(),
      strategy: 'snipe',
    });
    expect(snipePosition.strategy).toBe('snipe');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- positionRepository`
Expected: FAIL — `strategy` does not exist on the type passed to `openPosition`, or `hourlyPosition.strategy` is `undefined`.

- [ ] **Step 3: Add `strategy` to the domain types**

In `src/types.ts`, change:

```ts
export type CloseReason = 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP';
```

to:

```ts
export type CloseReason = 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'TIMEOUT';

export type PositionStrategy = 'hourly' | 'snipe';
```

Then in the `Position` interface, add the field right after `id`:

```ts
export interface Position {
  id: number;
  strategy: PositionStrategy;
  poolAddress: string;
  baseTokenAddress: string;
  baseTokenSymbol: string;
  entryPriceUsd: number;
  sizeUsd: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  trailingStopPct: number;
  highestPriceUsd: number;
  openedAt: Date;
  status: 'OPEN' | 'CLOSED';
  closedAt?: Date;
  closePriceUsd?: number;
  closeReason?: CloseReason;
  pnlUsd?: number;
}
```

- [ ] **Step 4: Add `'SNIPE'` to the decision log stage union**

In `src/store/decisionLogRepository.ts`, change:

```ts
  stage: 'FILTER' | 'SIGNAL' | 'RISK' | 'ERROR' | 'THROTTLE';
```

to:

```ts
  stage: 'FILTER' | 'SIGNAL' | 'RISK' | 'ERROR' | 'THROTTLE' | 'SNIPE';
```

- [ ] **Step 5: Migrate the `positions` table**

In `src/store/db.ts`, add `strategy` to the `CREATE TABLE IF NOT EXISTS positions` statement (right after `id`):

```sql
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy TEXT NOT NULL DEFAULT 'hourly',
      pool_address TEXT NOT NULL,
```

Then, right after the existing `base_token_address` migration block (the `if (!hasBaseTokenAddress) { ... }` block), add a second migration in the same style:

```ts
  const hasStrategy = (db.prepare('PRAGMA table_info(positions)').all() as { name: string }[]).some(
    (column) => column.name === 'strategy'
  );
  if (!hasStrategy) {
    db.exec(`ALTER TABLE positions ADD COLUMN strategy TEXT NOT NULL DEFAULT 'hourly'`);
  }
```

- [ ] **Step 6: Update `PositionRepository` to store and read `strategy`**

In `src/store/positionRepository.ts`, add `strategy` as optional to `NewPositionData`:

```ts
export interface NewPositionData {
  poolAddress: string;
  baseTokenAddress: string;
  baseTokenSymbol: string;
  entryPriceUsd: number;
  sizeUsd: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  trailingStopPct: number;
  openedAt: Date;
  strategy?: PositionStrategy;
}
```

(add `PositionStrategy` to the `import type { CloseReason, Position } from '../types.js';` line, making it `import type { CloseReason, Position, PositionStrategy } from '../types.js';`)

Update the INSERT in `openPosition` to include `strategy`, defaulting when absent:

```ts
  openPosition(data: NewPositionData): Position {
    const stmt = this.db.prepare(`
      INSERT INTO positions
        (strategy, pool_address, base_token_address, base_token_symbol, entry_price_usd, size_usd,
         stop_loss_price, take_profit_price, trailing_stop_pct,
         highest_price_usd, opened_at, status)
      VALUES (@strategy, @poolAddress, @baseTokenAddress, @baseTokenSymbol, @entryPriceUsd, @sizeUsd,
              @stopLossPrice, @takeProfitPrice, @trailingStopPct,
              @entryPriceUsd, @openedAt, 'OPEN')
    `);
    const result = stmt.run({
      strategy: data.strategy ?? 'hourly',
      poolAddress: data.poolAddress,
      baseTokenAddress: data.baseTokenAddress,
      baseTokenSymbol: data.baseTokenSymbol,
      entryPriceUsd: data.entryPriceUsd,
      sizeUsd: data.sizeUsd,
      stopLossPrice: data.stopLossPrice,
      takeProfitPrice: data.takeProfitPrice,
      trailingStopPct: data.trailingStopPct,
      openedAt: data.openedAt.toISOString(),
    });
    return this.getById(result.lastInsertRowid as number)!;
  }
```

And in `rowToPosition`, add the field:

```ts
function rowToPosition(row: any): Position {
  return {
    id: row.id,
    strategy: row.strategy,
    poolAddress: row.pool_address,
    baseTokenAddress: row.base_token_address,
    baseTokenSymbol: row.base_token_symbol,
    ...
```

(keep every other existing field as-is — only add the `strategy: row.strategy` line)

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- positionRepository`
Expected: PASS

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: All existing tests still pass unmodified (they never pass `strategy`, so every existing position defaults to `'hourly'`).

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/store/decisionLogRepository.ts src/store/db.ts src/store/positionRepository.ts src/store/positionRepository.test.ts
git commit -m "Add strategy tag to positions, TIMEOUT close reason, SNIPE log stage"
```

---

### Task 2: Scope `reviewOpenPositions` to one strategy at a time

**Files:**
- Modify: `src/positionManager.ts`
- Modify: `src/positionManager.test.ts`
- Modify: `src/pipeline.ts`

**Interfaces:**
- Consumes: `Position.strategy` from Task 1.
- Produces: `reviewOpenPositions(positionRepo, priceLookup, executor, now?, strategy?: PositionStrategy)` — when `strategy` is omitted, behavior is unchanged (reviews every open position, exactly as today). The sniper's own review loop (Task 8) will pass `'snipe'`; the existing hourly loop will now pass `'hourly'` explicitly.

This exists so the sniper's fast review loop (running every few seconds, Task 8) and the existing hourly loop (running every 120s) never touch each other's positions concurrently — without this, both loops calling `reviewOpenPositions` on the full open-position list could race on the same row (e.g. both decide to close the same hourly position at once).

- [ ] **Step 1: Write the failing test**

Add to `src/positionManager.test.ts`, inside `describe('reviewOpenPositions', ...)`:

```ts
  it('only reviews positions matching the given strategy, leaving the others untouched', async () => {
    openTestPosition(); // defaults to strategy 'hourly', poolAddress POOL1
    repo.openPosition({
      poolAddress: 'POOL2',
      baseTokenAddress: 'TOKEN2',
      baseTokenSymbol: 'BAR',
      entryPriceUsd: 1,
      sizeUsd: 2,
      stopLossPrice: 0.6,
      takeProfitPrice: 1.2,
      trailingStopPct: 100,
      openedAt: new Date(),
      strategy: 'snipe',
    });

    // 1.5 is above both positions' take-profit, so anything reviewed would close.
    const closed = await reviewOpenPositions(repo, async () => 1.5, executor, new Date(), 'snipe');

    expect(closed).toHaveLength(1);
    expect(closed[0].poolAddress).toBe('POOL2');
    expect(repo.getOpenPositions().filter((p) => p.poolAddress === 'POOL1')).toHaveLength(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- positionManager`
Expected: FAIL — `reviewOpenPositions` does not accept a 5th argument, or both positions get reviewed/closed instead of just the snipe one.

- [ ] **Step 3: Implement the strategy filter**

In `src/positionManager.ts`, change the signature and the first line of the body:

```ts
import type { Executor, Position, PositionStrategy } from './types.js';
import type { PositionRepository } from './store/positionRepository.js';

export type PriceLookup = (baseTokenAddress: string) => Promise<number | null>;

export async function reviewOpenPositions(
  positionRepo: PositionRepository,
  priceLookup: PriceLookup,
  executor: Executor,
  now: Date = new Date(),
  strategy?: PositionStrategy
): Promise<Position[]> {
  const allOpenPositions = positionRepo.getOpenPositions();
  const openPositions = strategy
    ? allOpenPositions.filter((position) => position.strategy === strategy)
    : allOpenPositions;
  const closedPositions: Position[] = [];
  // ... rest of the function body is unchanged
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- positionManager`
Expected: PASS

- [ ] **Step 5: Scope the existing hourly loop to its own strategy**

In `src/pipeline.ts`, find the call:

```ts
    const closedPositions = await reviewOpenPositions(
      positionRepo,
      async (baseTokenAddress) => prices.get(baseTokenAddress) ?? null,
      executor,
      now
    );
```

and add `'hourly'` as the 5th argument:

```ts
    const closedPositions = await reviewOpenPositions(
      positionRepo,
      async (baseTokenAddress) => prices.get(baseTokenAddress) ?? null,
      executor,
      now,
      'hourly'
    );
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: All tests pass, including the existing `pipeline.test.ts` suite (every position it opens defaults to `'hourly'`, matching the new explicit filter).

- [ ] **Step 7: Commit**

```bash
git add src/positionManager.ts src/positionManager.test.ts src/pipeline.ts
git commit -m "Scope reviewOpenPositions to one strategy, so the sniper's fast loop can't race the hourly loop"
```

---

### Task 3: Sniper configuration block

**Files:**
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`
- Modify: `config/config.json`

**Interfaces:**
- Produces: `BotConfig.sniper` — `{ enabled, pumpPortalWsUrl, simulatedCapitalUsd, stakeUsd, maxOpenSnipes, stopLossPct, takeProfitPct, maxHoldMinutes, reviewIntervalSeconds, filters: { requireSocialLink, bannedNamePatterns, maxCreatorInitialBuyPct } }`, all fields defaulted so a minimal `"sniper": {}` in the JSON file is valid.

- [ ] **Step 1: Write the failing test**

Add to `src/config.test.ts`, inside `describe('loadConfig', ...)`:

```ts
  it('defaults every sniper field when the sniper block is empty', () => {
    const filePath = writeTempConfig({ ...validConfig, sniper: {} });
    const config = loadConfig(filePath);
    expect(config.sniper.enabled).toBe(true);
    expect(config.sniper.pumpPortalWsUrl).toBe('wss://pumpportal.fun/api/data');
    expect(config.sniper.stakeUsd).toBe(2);
    expect(config.sniper.maxOpenSnipes).toBe(5);
    expect(config.sniper.takeProfitPct).toBe(100);
    expect(config.sniper.filters.bannedNamePatterns).toEqual(['test', 'scam', 'rug']);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- config.test`
Expected: FAIL — `config.sniper` is `undefined` (the schema doesn't know this field yet).

- [ ] **Step 3: Add the `sniper` schema**

In `src/config.ts`, add this block right after the closing `}),` of the `jupiter` schema entry (still inside `BotConfigSchema`'s outer `z.object({...})`):

```ts
  // Sniper temps réel sur les nouveaux tokens pump.fun (paper trading uniquement) — indépendant
  // de la stratégie horaire : capital simulé et plafond de positions séparés, voir
  // docs/superpowers/specs/2026-08-30-pumpfun-sniper-design.md.
  sniper: z
    .object({
      enabled: z.boolean().default(true),
      pumpPortalWsUrl: z.string().default('wss://pumpportal.fun/api/data'),
      simulatedCapitalUsd: z.number().positive().default(20),
      stakeUsd: z.number().positive().default(2),
      maxOpenSnipes: z.number().int().positive().default(5),
      stopLossPct: z.number().positive().max(100).default(40),
      takeProfitPct: z.number().positive().default(100),
      maxHoldMinutes: z.number().positive().default(15),
      reviewIntervalSeconds: z.number().positive().default(8),
      filters: z
        .object({
          requireSocialLink: z.boolean().default(true),
          bannedNamePatterns: z.array(z.string()).default(['test', 'scam', 'rug']),
          maxCreatorInitialBuyPct: z.number().positive().max(100).default(20),
        })
        .default({}),
    })
    .default({}),
```

(`z.string()` rather than `z.url()` for `pumpPortalWsUrl`: it's a `wss://` WebSocket URL, not an `http(s)://` one, and this project's `z.url()` usage elsewhere is only ever for the `http(s)://` REST base URLs.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- config.test`
Expected: PASS

- [ ] **Step 5: Add the concrete block to the live config file**

In `config/config.json`, add (matching the indentation of the surrounding file) right after the `"jupiter"` block:

```json
  "sniper": {
    "enabled": true,
    "pumpPortalWsUrl": "wss://pumpportal.fun/api/data",
    "simulatedCapitalUsd": 20,
    "stakeUsd": 2,
    "maxOpenSnipes": 5,
    "stopLossPct": 40,
    "takeProfitPct": 100,
    "maxHoldMinutes": 15,
    "reviewIntervalSeconds": 8,
    "filters": {
      "requireSocialLink": true,
      "bannedNamePatterns": ["test", "scam", "rug"],
      "maxCreatorInitialBuyPct": 20
    }
  }
```

(remember to add a trailing comma after the closing `}` of the `"jupiter"` block above it, since JSON needs one between siblings)

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/config.test.ts config/config.json
git commit -m "Add sniper configuration block"
```

---

### Task 4: `snipeFilter.ts` — pure anti-rug filter

**Files:**
- Create: `src/sniper/snipeFilter.ts`
- Test: `src/sniper/snipeFilter.test.ts`

**Interfaces:**
- Produces: `NewTokenEvent` (`tokenAddress`, `symbol`, `name`, `creatorAddress`, `hasSocialLink`, `creatorInitialBuyPct`), `SnipeFilterConfig` (mirrors `config.sniper.filters` from Task 3), `SnipeFilterResult` (`{ passed: boolean; reason: string }`), `shouldSnipe(event, config): SnipeFilterResult`.
- Consumed by: Task 8 (`sniperPipeline.ts`).

- [ ] **Step 1: Write the failing tests**

Create `src/sniper/snipeFilter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shouldSnipe } from './snipeFilter.js';
import type { NewTokenEvent, SnipeFilterConfig } from './snipeFilter.js';

const config: SnipeFilterConfig = {
  requireSocialLink: true,
  bannedNamePatterns: ['test', 'scam', 'rug'],
  maxCreatorInitialBuyPct: 20,
};

function makeEvent(overrides: Partial<NewTokenEvent> = {}): NewTokenEvent {
  return {
    tokenAddress: 'MINT1',
    symbol: 'FOO',
    name: 'Foo Coin',
    creatorAddress: 'CREATOR1',
    hasSocialLink: true,
    creatorInitialBuyPct: 5,
    ...overrides,
  };
}

describe('shouldSnipe', () => {
  it('accepts a token with a social link, a clean name, and a modest creator buy', () => {
    const result = shouldSnipe(makeEvent(), config);
    expect(result.passed).toBe(true);
  });

  it('rejects a token with no social link when requireSocialLink is true', () => {
    const result = shouldSnipe(makeEvent({ hasSocialLink: false }), config);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/lien social/i);
  });

  it('accepts a token with no social link when requireSocialLink is false', () => {
    const result = shouldSnipe(makeEvent({ hasSocialLink: false }), { ...config, requireSocialLink: false });
    expect(result.passed).toBe(true);
  });

  it('rejects a name matching a banned pattern, case-insensitively', () => {
    const result = shouldSnipe(makeEvent({ name: 'Definitely Not A Scam Coin' }), config);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/scam/i);
  });

  it('rejects a symbol matching a banned pattern', () => {
    const result = shouldSnipe(makeEvent({ symbol: 'RUG' }), config);
    expect(result.passed).toBe(false);
  });

  it('rejects when the creator initial buy exceeds the configured maximum', () => {
    const result = shouldSnipe(makeEvent({ creatorInitialBuyPct: 25 }), config);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/25/);
  });

  it('accepts when the creator initial buy is exactly at the configured maximum', () => {
    const result = shouldSnipe(makeEvent({ creatorInitialBuyPct: 20 }), config);
    expect(result.passed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- snipeFilter`
Expected: FAIL with "Cannot find module './snipeFilter.js'".

- [ ] **Step 3: Implement `snipeFilter.ts`**

Create `src/sniper/snipeFilter.ts`:

```ts
export interface NewTokenEvent {
  tokenAddress: string;
  symbol: string;
  name: string;
  creatorAddress: string;
  hasSocialLink: boolean;
  creatorInitialBuyPct: number;
}

export interface SnipeFilterConfig {
  requireSocialLink: boolean;
  bannedNamePatterns: string[];
  maxCreatorInitialBuyPct: number;
}

export interface SnipeFilterResult {
  passed: boolean;
  reason: string;
}

export function shouldSnipe(event: NewTokenEvent, config: SnipeFilterConfig): SnipeFilterResult {
  if (config.requireSocialLink && !event.hasSocialLink) {
    return { passed: false, reason: 'Aucun lien social (site/twitter/telegram)' };
  }

  const nameAndSymbol = `${event.name} ${event.symbol}`.toLowerCase();
  const bannedMatch = config.bannedNamePatterns.find((pattern) =>
    nameAndSymbol.includes(pattern.toLowerCase())
  );
  if (bannedMatch) {
    return { passed: false, reason: `Nom/symbole contient un motif banni : "${bannedMatch}"` };
  }

  if (event.creatorInitialBuyPct > config.maxCreatorInitialBuyPct) {
    return {
      passed: false,
      reason: `Achat initial du créateur trop élevé (${event.creatorInitialBuyPct.toFixed(1)}% > ${config.maxCreatorInitialBuyPct}%)`,
    };
  }

  return { passed: true, reason: 'Accepté' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- snipeFilter`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/sniper/snipeFilter.ts src/sniper/snipeFilter.test.ts
git commit -m "Add snipeFilter: pure anti-rug checks for new pump.fun tokens"
```

---

### Task 5: `snipeRisk.ts` — position sizing and open-snipe cap

**Files:**
- Create: `src/sniper/snipeRisk.ts`
- Test: `src/sniper/snipeRisk.test.ts`

**Interfaces:**
- Consumes: `BotConfig` (Task 3's `config.sniper`).
- Produces: `SnipeRiskDecision` (`{ approved: boolean; reason: string; positionSizeUsd?: number; stopLossPrice?: number; takeProfitPrice?: number }`), `evaluateSnipeRisk(entryPriceUsd, openSnipesCount, config): SnipeRiskDecision`.
- Consumed by: Task 8 (`sniperPipeline.ts`).

- [ ] **Step 1: Write the failing tests**

Create `src/sniper/snipeRisk.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evaluateSnipeRisk } from './snipeRisk.js';
import type { BotConfig } from '../config.js';

const config = {
  sniper: {
    stakeUsd: 2,
    maxOpenSnipes: 5,
    stopLossPct: 40,
    takeProfitPct: 100,
  },
} as BotConfig;

describe('evaluateSnipeRisk', () => {
  it('approves with a fixed stake and TP/SL derived from entry price', () => {
    const decision = evaluateSnipeRisk(0.001, 2, config);
    expect(decision.approved).toBe(true);
    expect(decision.positionSizeUsd).toBe(2);
    expect(decision.stopLossPrice).toBeCloseTo(0.0006, 10); // 0.001 * (1 - 0.40)
    expect(decision.takeProfitPrice).toBeCloseTo(0.002, 10); // 0.001 * (1 + 1.00)
  });

  it('rejects when the open-snipe cap is already reached', () => {
    const decision = evaluateSnipeRisk(0.001, 5, config);
    expect(decision.approved).toBe(false);
    expect(decision.reason).toMatch(/5\/5/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- snipeRisk`
Expected: FAIL with "Cannot find module './snipeRisk.js'".

- [ ] **Step 3: Implement `snipeRisk.ts`**

Create `src/sniper/snipeRisk.ts`:

```ts
import type { BotConfig } from '../config.js';

export interface SnipeRiskDecision {
  approved: boolean;
  reason: string;
  positionSizeUsd?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export function evaluateSnipeRisk(
  entryPriceUsd: number,
  openSnipesCount: number,
  config: BotConfig
): SnipeRiskDecision {
  if (openSnipesCount >= config.sniper.maxOpenSnipes) {
    return {
      approved: false,
      reason: `Nombre max de snipes ouverts atteint (${openSnipesCount}/${config.sniper.maxOpenSnipes})`,
    };
  }
  return {
    approved: true,
    reason: 'Approuvé',
    positionSizeUsd: config.sniper.stakeUsd,
    stopLossPrice: entryPriceUsd * (1 - config.sniper.stopLossPct / 100),
    takeProfitPrice: entryPriceUsd * (1 + config.sniper.takeProfitPct / 100),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- snipeRisk`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sniper/snipeRisk.ts src/sniper/snipeRisk.test.ts
git commit -m "Add snipeRisk: fixed-stake sizing and open-snipe cap"
```

---

### Task 6: `timeoutManager.ts` — force-close positions held too long

**Files:**
- Create: `src/sniper/timeoutManager.ts`
- Test: `src/sniper/timeoutManager.test.ts`

**Interfaces:**
- Consumes: `PriceLookup` (from `src/positionManager.ts`, Task 2), `PositionRepository`, `Executor`, `Position` (from `src/types.js`).
- Produces: `closeTimedOutPositions(positionRepo, maxHoldMs, priceLookup, executor, now?): Promise<Position[]>` — closes every open `'snipe'` position whose `openedAt` is older than `maxHoldMs`, with `closeReason: 'TIMEOUT'`.
- Consumed by: Task 8 (`sniperPipeline.ts`).

- [ ] **Step 1: Write the failing tests**

Create `src/sniper/timeoutManager.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from '../store/db.js';
import { PositionRepository } from '../store/positionRepository.js';
import { closeTimedOutPositions } from './timeoutManager.js';
import type { Executor, Fill, Order } from '../types.js';

let db: Database.Database;
let repo: PositionRepository;
let executor: Executor;
let executeMock: ReturnType<typeof vi.fn<(order: Order) => Promise<Fill>>>;

beforeEach(() => {
  db = createDb(':memory:');
  repo = new PositionRepository(db);
  executeMock = vi.fn<(order: Order) => Promise<Fill>>().mockImplementation(
    async (order: Order): Promise<Fill> => ({
      poolAddress: order.poolAddress,
      side: order.side,
      sizeUsd: order.sizeUsd,
      filledPriceUsd: order.priceUsd,
      filledAt: new Date(),
    })
  );
  executor = { execute: executeMock };
});

function openSnipe(openedAt: Date) {
  return repo.openPosition({
    poolAddress: 'MINT1',
    baseTokenAddress: 'MINT1',
    baseTokenSymbol: 'FOO',
    entryPriceUsd: 1,
    sizeUsd: 2,
    stopLossPrice: 0.6,
    takeProfitPrice: 2,
    trailingStopPct: 100,
    openedAt,
    strategy: 'snipe',
  });
}

describe('closeTimedOutPositions', () => {
  it('closes a snipe position held past maxHoldMs, at the looked-up price', async () => {
    const openedAt = new Date('2026-08-30T12:00:00.000Z');
    const position = openSnipe(openedAt);
    const now = new Date('2026-08-30T12:16:00.000Z'); // 16 min later
    const maxHoldMs = 15 * 60 * 1000;

    const closed = await closeTimedOutPositions(repo, maxHoldMs, async () => 1.1, executor, now);

    expect(closed).toHaveLength(1);
    expect(closed[0].id).toBe(position.id);
    expect(closed[0].closeReason).toBe('TIMEOUT');
    expect(closed[0].closePriceUsd).toBe(1.1);
    expect(repo.getOpenPositions()).toHaveLength(0);
  });

  it('leaves a snipe position open when it has not yet reached maxHoldMs', async () => {
    const openedAt = new Date('2026-08-30T12:00:00.000Z');
    openSnipe(openedAt);
    const now = new Date('2026-08-30T12:10:00.000Z'); // 10 min later
    const maxHoldMs = 15 * 60 * 1000;

    const closed = await closeTimedOutPositions(repo, maxHoldMs, async () => 1.1, executor, now);

    expect(closed).toHaveLength(0);
    expect(repo.getOpenPositions()).toHaveLength(1);
  });

  it('skips a timed-out position when the price lookup returns null, retrying next time', async () => {
    const openedAt = new Date('2026-08-30T12:00:00.000Z');
    openSnipe(openedAt);
    const now = new Date('2026-08-30T12:16:00.000Z');
    const maxHoldMs = 15 * 60 * 1000;

    const closed = await closeTimedOutPositions(repo, maxHoldMs, async () => null, executor, now);

    expect(closed).toHaveLength(0);
    expect(repo.getOpenPositions()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- timeoutManager`
Expected: FAIL with "Cannot find module './timeoutManager.js'".

- [ ] **Step 3: Implement `timeoutManager.ts`**

Create `src/sniper/timeoutManager.ts`:

```ts
import type { Executor, Position } from '../types.js';
import type { PositionRepository } from '../store/positionRepository.js';
import type { PriceLookup } from '../positionManager.js';

export async function closeTimedOutPositions(
  positionRepo: PositionRepository,
  maxHoldMs: number,
  priceLookup: PriceLookup,
  executor: Executor,
  now: Date = new Date()
): Promise<Position[]> {
  const openSnipes = positionRepo.getOpenPositions().filter((position) => position.strategy === 'snipe');
  const closed: Position[] = [];

  for (const position of openSnipes) {
    const heldMs = now.getTime() - position.openedAt.getTime();
    if (heldMs < maxHoldMs) continue;

    const currentPrice = await priceLookup(position.baseTokenAddress);
    if (currentPrice === null) continue;

    const fill = await executor.execute({
      poolAddress: position.poolAddress,
      baseTokenSymbol: position.baseTokenSymbol,
      side: 'SELL',
      sizeUsd: position.sizeUsd,
      priceUsd: currentPrice,
    });
    closed.push(positionRepo.closePosition(position.id, fill.filledPriceUsd, 'TIMEOUT', now));
  }

  return closed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- timeoutManager`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/sniper/timeoutManager.ts src/sniper/timeoutManager.test.ts
git commit -m "Add timeoutManager: force-close snipes held past maxHoldMinutes"
```

---

### Task 7: `pumpPortalClient.ts` — WebSocket feed with metadata enrichment

**Files:**
- Create: `src/sniper/pumpPortalClient.ts`
- Test: `src/sniper/pumpPortalClient.test.ts`

**Interfaces:**
- Produces: `NewTokenListener = (event: NewTokenEvent) => void`, `PumpPortalClient` (`{ onNewToken(listener): void; connect(): void; close(): void }`), `createPumpPortalClient(wsUrl: string): PumpPortalClient`.
- Consumes: `NewTokenEvent` type from Task 4 (`./snipeFilter.js`).
- Consumed by: Task 8 (`sniperPipeline.ts`), Task 9 (`main.ts`).

PumpPortal's `subscribeNewToken` message does not carry social-link info directly — only a metadata `uri`. This client fetches that URI once per event and inspects the metadata JSON for `twitter`/`telegram`/`website` to resolve `hasSocialLink`, so `snipeFilter.ts` can stay a synchronous pure function.

- [ ] **Step 1: Write the failing tests**

Create `src/sniper/pumpPortalClient.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPumpPortalClient } from './pumpPortalClient.js';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

const createMessage = {
  txType: 'create',
  mint: 'MINT1',
  traderPublicKey: 'CREATOR1',
  name: 'Foo Coin',
  symbol: 'FOO',
  uri: 'https://metadata.example/foo.json',
  initialBuy: 10_000_000,
  vTokensInBondingCurve: 990_000_000,
};

afterEach(() => {
  FakeWebSocket.instances = [];
  vi.unstubAllGlobals();
});

describe('createPumpPortalClient', () => {
  it('subscribes to new-token events on connect', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const client = createPumpPortalClient('wss://pumpportal.fun/api/data');

    client.connect();
    FakeWebSocket.instances[0].onopen?.();

    expect(FakeWebSocket.instances[0].sent).toEqual([JSON.stringify({ method: 'subscribeNewToken' })]);
  });

  it('emits a normalized event with hasSocialLink=true when the metadata has a twitter link', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ twitter: 'https://x.com/foo' })));
    const client = createPumpPortalClient('wss://pumpportal.fun/api/data');
    const listener = vi.fn();
    client.onNewToken(listener);

    client.connect();
    await FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify(createMessage) });
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());

    expect(listener).toHaveBeenCalledWith({
      tokenAddress: 'MINT1',
      symbol: 'FOO',
      name: 'Foo Coin',
      creatorAddress: 'CREATOR1',
      hasSocialLink: true,
      creatorInitialBuyPct: 1, // 10_000_000 / (10_000_000 + 990_000_000) * 100
    });
  });

  it('emits hasSocialLink=false when the metadata has no social fields', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ description: 'no socials here' })));
    const client = createPumpPortalClient('wss://pumpportal.fun/api/data');
    const listener = vi.fn();
    client.onNewToken(listener);

    client.connect();
    await FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify(createMessage) });
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());

    expect(listener.mock.calls[0][0].hasSocialLink).toBe(false);
  });

  it('emits hasSocialLink=false when the metadata fetch fails, instead of throwing', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const client = createPumpPortalClient('wss://pumpportal.fun/api/data');
    const listener = vi.fn();
    client.onNewToken(listener);

    client.connect();
    await FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify(createMessage) });
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());

    expect(listener.mock.calls[0][0].hasSocialLink).toBe(false);
  });

  it('ignores a message missing required fields, without throwing or notifying listeners', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn());
    const client = createPumpPortalClient('wss://pumpportal.fun/api/data');
    const listener = vi.fn();
    client.onNewToken(listener);

    client.connect();
    await FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ txType: 'create' }) });

    expect(listener).not.toHaveBeenCalled();
  });

  it('reconnects a new WebSocket after the connection closes', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const client = createPumpPortalClient('wss://pumpportal.fun/api/data');

    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].onclose?.();
    vi.runOnlyPendingTimers();

    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pumpPortalClient`
Expected: FAIL with "Cannot find module './pumpPortalClient.js'".

- [ ] **Step 3: Implement `pumpPortalClient.ts`**

Create `src/sniper/pumpPortalClient.ts`:

```ts
import type { NewTokenEvent } from './snipeFilter.js';

export type NewTokenListener = (event: NewTokenEvent) => void;

export interface PumpPortalClient {
  onNewToken(listener: NewTokenListener): void;
  connect(): void;
  close(): void;
}

interface RawCreateMessage {
  mint: string;
  traderPublicKey: string;
  name: string;
  symbol: string;
  uri: string;
  initialBuy: number;
  vTokensInBondingCurve: number;
}

const RECONNECT_DELAY_MS = 3000;

export function createPumpPortalClient(wsUrl: string): PumpPortalClient {
  const listeners: NewTokenListener[] = [];
  let ws: WebSocket | null = null;
  let closedByUser = false;

  function connect(): void {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws?.send(JSON.stringify({ method: 'subscribeNewToken' }));
    };
    ws.onmessage = (event) => {
      void handleMessage(String((event as { data: unknown }).data));
    };
    ws.onclose = () => {
      if (closedByUser) return;
      setTimeout(connect, RECONNECT_DELAY_MS);
    };
    ws.onerror = () => {
      // onclose se déclenche juste après une vraie erreur réseau : la reconnexion est déjà gérée
      // là-bas, pas besoin de la dupliquer ici.
    };
  }

  async function handleMessage(raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // message mal formé, ignoré
    }
    const message = parsed as Partial<RawCreateMessage>;
    if (
      typeof message.mint !== 'string' ||
      typeof message.traderPublicKey !== 'string' ||
      typeof message.name !== 'string' ||
      typeof message.symbol !== 'string' ||
      typeof message.uri !== 'string' ||
      typeof message.initialBuy !== 'number' ||
      typeof message.vTokensInBondingCurve !== 'number'
    ) {
      return; // pas un événement de création de token complet, ignoré
    }

    const hasSocialLink = await fetchHasSocialLink(message.uri);
    const totalTokens = message.initialBuy + message.vTokensInBondingCurve;
    const creatorInitialBuyPct = totalTokens > 0 ? (message.initialBuy / totalTokens) * 100 : 0;

    const event: NewTokenEvent = {
      tokenAddress: message.mint,
      symbol: message.symbol,
      name: message.name,
      creatorAddress: message.traderPublicKey,
      hasSocialLink,
      creatorInitialBuyPct,
    };
    for (const listener of listeners) listener(event);
  }

  return {
    onNewToken(listener) {
      listeners.push(listener);
    },
    connect,
    close() {
      closedByUser = true;
      ws?.close();
      ws = null;
    },
  };
}

async function fetchHasSocialLink(uri: string): Promise<boolean> {
  try {
    const response = await fetch(uri);
    if (!response.ok) return false;
    const metadata = (await response.json()) as Record<string, unknown>;
    return Boolean(metadata.twitter || metadata.telegram || metadata.website);
  } catch {
    // Métadonnée injoignable : traité comme "aucun lien social" — le filtre tranchera selon
    // requireSocialLink, plutôt que de faire planter le flux sur un token entier.
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pumpPortalClient`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/sniper/pumpPortalClient.ts src/sniper/pumpPortalClient.test.ts
git commit -m "Add pumpPortalClient: WebSocket feed for new pump.fun tokens with metadata enrichment"
```

---

### Task 8: `sniperPipeline.ts` — orchestration (buy on event, fast review loop)

**Files:**
- Create: `src/sniper/sniperPipeline.ts`
- Test: `src/sniper/sniperPipeline.test.ts`

**Interfaces:**
- Consumes: `shouldSnipe`/`NewTokenEvent` (Task 4), `evaluateSnipeRisk` (Task 5), `closeTimedOutPositions` (Task 6), `reviewOpenPositions` (Task 2), `PositionRepository`, `DecisionLogRepository`, `Notifier`, `Executor`, `PriceClient` (`src/jupiter/priceClient.js`), `BotConfig`.
- Produces: `SniperDeps` (bag of the above dependencies), `handleNewToken(event, deps): Promise<void>`, `runSniperReviewCycle(deps): Promise<void>`.
- Consumed by: Task 9 (`main.ts`).

- [ ] **Step 1: Write the failing tests**

Create `src/sniper/sniperPipeline.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from '../store/db.js';
import { PositionRepository } from '../store/positionRepository.js';
import { DecisionLogRepository } from '../store/decisionLogRepository.js';
import { handleNewToken, runSniperReviewCycle } from './sniperPipeline.js';
import type { SniperDeps } from './sniperPipeline.js';
import type { NewTokenEvent } from './snipeFilter.js';
import type { BotConfig } from '../config.js';
import type { Executor, Fill, Order } from '../types.js';
import type { PriceClient } from '../jupiter/priceClient.js';
import type { Notifier } from '../notifier/notifier.js';

const config = {
  sniper: {
    stakeUsd: 2,
    maxOpenSnipes: 2,
    stopLossPct: 40,
    takeProfitPct: 100,
    maxHoldMinutes: 15,
    filters: {
      requireSocialLink: true,
      bannedNamePatterns: ['scam'],
      maxCreatorInitialBuyPct: 20,
    },
  },
} as BotConfig;

function makeEvent(overrides: Partial<NewTokenEvent> = {}): NewTokenEvent {
  return {
    tokenAddress: 'MINT1',
    symbol: 'FOO',
    name: 'Foo Coin',
    creatorAddress: 'CREATOR1',
    hasSocialLink: true,
    creatorInitialBuyPct: 5,
    ...overrides,
  };
}

let db: Database.Database;
let positionRepo: PositionRepository;
let decisionLog: DecisionLogRepository;
let executor: Executor;
let executeMock: ReturnType<typeof vi.fn<(order: Order) => Promise<Fill>>>;
let notifier: Notifier;
let notifyMock: ReturnType<typeof vi.fn<(message: string) => Promise<void>>>;
let priceClient: PriceClient;
let deps: SniperDeps;

beforeEach(() => {
  db = createDb(':memory:');
  positionRepo = new PositionRepository(db);
  decisionLog = new DecisionLogRepository(db);
  executeMock = vi.fn<(order: Order) => Promise<Fill>>().mockImplementation(
    async (order: Order): Promise<Fill> => ({
      poolAddress: order.poolAddress,
      side: order.side,
      sizeUsd: order.sizeUsd,
      filledPriceUsd: order.priceUsd,
      filledAt: new Date(),
    })
  );
  executor = { execute: executeMock };
  notifyMock = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
  notifier = { notify: notifyMock };
  priceClient = { fetchPrices: vi.fn().mockResolvedValue(new Map()) };
  deps = { positionRepo, decisionLog, executor, notifier, priceClient, config };
});

describe('handleNewToken', () => {
  it('opens a snipe position when the event passes the filter, at a fixed stake', async () => {
    await handleNewToken(makeEvent(), deps, 0.001);

    const [position] = positionRepo.getOpenPositions();
    expect(position).toBeDefined();
    expect(position.strategy).toBe('snipe');
    expect(position.sizeUsd).toBe(2);
    expect(position.baseTokenAddress).toBe('MINT1');
    expect(notifyMock).toHaveBeenCalledWith(expect.stringMatching(/Snipe ouvert.*FOO/s));
  });

  it('does not open a position when the event fails the filter, and logs the rejection', async () => {
    await handleNewToken(makeEvent({ name: 'Scam Coin' }), deps, 0.001);

    expect(positionRepo.getOpenPositions()).toHaveLength(0);
    expect(notifyMock).not.toHaveBeenCalled();
    const rejected = decisionLog.getRecent(5).find((entry) => entry.stage === 'SNIPE');
    expect(rejected?.decision).toBe('REJECTED');
  });

  it('does not open a position when maxOpenSnipes is already reached', async () => {
    await handleNewToken(makeEvent({ tokenAddress: 'MINT1', symbol: 'AAA' }), deps, 0.001);
    await handleNewToken(makeEvent({ tokenAddress: 'MINT2', symbol: 'BBB' }), deps, 0.001);

    await handleNewToken(makeEvent({ tokenAddress: 'MINT3', symbol: 'CCC' }), deps, 0.001);

    expect(positionRepo.getOpenPositions()).toHaveLength(2);
  });
});

describe('runSniperReviewCycle', () => {
  it('closes a snipe position on take-profit using the batched Jupiter price', async () => {
    await handleNewToken(makeEvent(), deps, 0.001); // TP at 0.002 (100%)
    priceClient.fetchPrices = vi.fn().mockResolvedValue(new Map([['MINT1', 0.0025]]));

    await runSniperReviewCycle(deps);

    expect(positionRepo.getOpenPositions()).toHaveLength(0);
    expect(notifyMock).toHaveBeenCalledWith(expect.stringMatching(/Snipe fermé.*FOO.*TAKE_PROFIT/s));
  });

  it('force-closes a snipe position past maxHoldMinutes even when price is flat', async () => {
    const openedAt = new Date(Date.now() - 16 * 60 * 1000);
    positionRepo.openPosition({
      poolAddress: 'MINT1',
      baseTokenAddress: 'MINT1',
      baseTokenSymbol: 'FOO',
      entryPriceUsd: 0.001,
      sizeUsd: 2,
      stopLossPrice: 0.0006,
      takeProfitPrice: 0.002,
      trailingStopPct: 100,
      openedAt,
      strategy: 'snipe',
    });
    priceClient.fetchPrices = vi.fn().mockResolvedValue(new Map([['MINT1', 0.001]])); // unchanged price

    await runSniperReviewCycle(deps);

    expect(positionRepo.getOpenPositions()).toHaveLength(0);
    expect(notifyMock).toHaveBeenCalledWith(expect.stringMatching(/Snipe fermé.*FOO.*TIMEOUT/s));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sniperPipeline`
Expected: FAIL with "Cannot find module './sniperPipeline.js'".

- [ ] **Step 3: Implement `sniperPipeline.ts`**

Create `src/sniper/sniperPipeline.ts`:

```ts
import type { BotConfig } from '../config.js';
import type { PositionRepository } from '../store/positionRepository.js';
import type { DecisionLogRepository } from '../store/decisionLogRepository.js';
import type { Executor, Position } from '../types.js';
import type { Notifier } from '../notifier/notifier.js';
import type { PriceClient } from '../jupiter/priceClient.js';
import { shouldSnipe, type NewTokenEvent } from './snipeFilter.js';
import { evaluateSnipeRisk } from './snipeRisk.js';
import { reviewOpenPositions } from '../positionManager.js';
import { closeTimedOutPositions } from './timeoutManager.js';

export interface SniperDeps {
  positionRepo: PositionRepository;
  decisionLog: DecisionLogRepository;
  executor: Executor;
  notifier: Notifier;
  priceClient: PriceClient;
  config: BotConfig;
}

export async function handleNewToken(
  event: NewTokenEvent,
  deps: SniperDeps,
  entryPriceUsd: number
): Promise<void> {
  const { positionRepo, decisionLog, executor, notifier, config } = deps;
  const now = new Date();

  const filterResult = shouldSnipe(event, config.sniper.filters);
  decisionLog.log({
    timestamp: now,
    poolAddress: event.tokenAddress,
    stage: 'SNIPE',
    decision: filterResult.passed ? 'APPROVED' : 'REJECTED',
    reason: filterResult.reason,
  });
  if (!filterResult.passed) return;

  const openSnipesCount = positionRepo.getOpenPositions().filter((p) => p.strategy === 'snipe').length;
  const risk = evaluateSnipeRisk(entryPriceUsd, openSnipesCount, config);
  if (!risk.approved || risk.positionSizeUsd === undefined || risk.stopLossPrice === undefined || risk.takeProfitPrice === undefined) {
    decisionLog.log({
      timestamp: now,
      poolAddress: event.tokenAddress,
      stage: 'SNIPE',
      decision: 'REJECTED',
      reason: risk.reason,
    });
    return;
  }

  const fill = await executor.execute({
    poolAddress: event.tokenAddress,
    baseTokenSymbol: event.symbol,
    side: 'BUY',
    sizeUsd: risk.positionSizeUsd,
    priceUsd: entryPriceUsd,
  });

  positionRepo.openPosition({
    poolAddress: event.tokenAddress,
    baseTokenAddress: event.tokenAddress,
    baseTokenSymbol: event.symbol,
    entryPriceUsd: fill.filledPriceUsd,
    sizeUsd: risk.positionSizeUsd,
    stopLossPrice: risk.stopLossPrice,
    takeProfitPrice: risk.takeProfitPrice,
    trailingStopPct: 100, // pas de trailing stop pour les snipes : TP/SL/timeout suffisent (voir spec)
    openedAt: now,
    strategy: 'snipe',
  });

  await notifier.notify(
    `🎯 Snipe ouvert : ${event.symbol} (${event.tokenAddress})\n` +
      `Entrée : ${fill.filledPriceUsd}$ — Mise : ${risk.positionSizeUsd.toFixed(2)}$`
  );
}

export async function runSniperReviewCycle(deps: SniperDeps): Promise<void> {
  const { positionRepo, notifier, priceClient, config } = deps;

  const openSnipeAddresses = positionRepo
    .getOpenPositions()
    .filter((p) => p.strategy === 'snipe')
    .map((p) => p.baseTokenAddress);
  const prices = await priceClient.fetchPrices(openSnipeAddresses);
  const priceLookup = async (baseTokenAddress: string) => prices.get(baseTokenAddress) ?? null;

  const closedOnTpSl = await reviewOpenPositions(positionRepo, priceLookup, deps.executor, new Date(), 'snipe');
  const closedOnTimeout = await closeTimedOutPositions(
    positionRepo,
    config.sniper.maxHoldMinutes * 60 * 1000,
    priceLookup,
    deps.executor
  );

  for (const position of [...closedOnTpSl, ...closedOnTimeout]) {
    await notifySnipeClosed(notifier, position);
  }
}

async function notifySnipeClosed(notifier: Notifier, position: Position): Promise<void> {
  const pnl = position.pnlUsd ?? 0;
  const sign = pnl >= 0 ? '+' : '';
  await notifier.notify(
    `🔴 Snipe fermé : ${position.baseTokenSymbol} (${position.baseTokenAddress})\n` +
      `Raison : ${position.closeReason} — PnL : ${sign}${pnl.toFixed(2)}$`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sniperPipeline`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: All tests pass across the whole project.

- [ ] **Step 6: Commit**

```bash
git add src/sniper/sniperPipeline.ts src/sniper/sniperPipeline.test.ts
git commit -m "Add sniperPipeline: buy on qualifying event, fast TP/SL/timeout review loop"
```

---

### Task 9: Wire the sniper into `main.ts`

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `createPumpPortalClient` (Task 7), `handleNewToken`/`runSniperReviewCycle`/`SniperDeps` (Task 8).

This is the final integration: the sniper's WebSocket listener and its own fast review loop run concurrently with the existing hourly `while` loop, gated by `config.sniper.enabled`, and shut down cleanly on `SIGINT` alongside the rest of the bot.

- [ ] **Step 1: Add the imports**

In `src/main.ts`, add near the top with the other imports:

```ts
import { createPumpPortalClient } from './sniper/pumpPortalClient.js';
import { handleNewToken, runSniperReviewCycle, type SniperDeps } from './sniper/sniperPipeline.js';
```

- [ ] **Step 2: Start the sniper alongside the existing bot loop**

In `src/main.ts`, right after the line `process.on('SIGINT', () => { ... });` block and before the `console.log('Bot démarré...')` line, add:

```ts
  let pumpPortalClient: ReturnType<typeof createPumpPortalClient> | null = null;
  if (config.sniper.enabled) {
    const sniperDeps: SniperDeps = { positionRepo, decisionLog, executor, notifier, priceClient, config };

    pumpPortalClient = createPumpPortalClient(config.sniper.pumpPortalWsUrl);
    pumpPortalClient.onNewToken((event) => {
      // Le prix d'entrée n'est pas dans l'événement PumpPortal (qui ne fournit que des quantités
      // de bonding curve, pas un prix en dollars directement exploitable) : on utilise le prix
      // Jupiter dès que le token est indexé, avec un court délai pour lui laisser le temps de l'être.
      setTimeout(() => {
        void (async () => {
          const prices = await priceClient.fetchPrices([event.tokenAddress]);
          const entryPriceUsd = prices.get(event.tokenAddress);
          if (entryPriceUsd == null) return; // pas encore indexé par Jupiter, on rate ce snipe
          await handleNewToken(event, sniperDeps, entryPriceUsd);
        })();
      }, 2000);
    });
    pumpPortalClient.connect();
    console.log(`Sniper pump.fun activé (mise ${config.sniper.stakeUsd}$, ${config.sniper.maxOpenSnipes} max).`);

    void (async () => {
      while (!stopRequested) {
        try {
          await runSniperReviewCycle(sniperDeps);
        } catch (error) {
          console.error('Erreur pendant la revue des snipes :', error);
        }
        await sleep(config.sniper.reviewIntervalSeconds * 1000);
      }
    })();
  } else {
    console.log('Sniper pump.fun désactivé (config.sniper.enabled = false).');
  }
```

- [ ] **Step 3: Close the WebSocket on shutdown**

Still in `src/main.ts`, find:

```ts
  db.close();
  console.log('Bot arrêté proprement.');
```

and change it to:

```ts
  pumpPortalClient?.close();
  db.close();
  console.log('Bot arrêté proprement.');
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: Clean — no type errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: All tests pass (this task has no new automated tests of its own — `main.ts`'s bootstrap wiring is exercised by the manual smoke test in Step 6, matching how the rest of `main.ts` is untested today).

- [ ] **Step 6: Manual smoke test**

Run: `npm start`, let it run for a few minutes, and confirm in the console output:
- `Sniper pump.fun activé (...)` appears at startup.
- Within a couple of minutes, `decision_logs` gains `SNIPE` rows (check with the same `better-sqlite3` inline query pattern used earlier in this project to inspect `data/bot.sqlite`).
- If any snipe passes the filter, a `🎯 Snipe ouvert` Telegram notification arrives and a new `strategy='snipe'` row appears in `positions`.

This step confirms the real PumpPortal WebSocket message shape matches what Task 7 assumed — if it doesn't, this is where a mismatch surfaces, well after the unit tests already caught everything encodable without live network access.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "Wire the pump.fun sniper into main.ts, alongside the existing hourly loop"
```
