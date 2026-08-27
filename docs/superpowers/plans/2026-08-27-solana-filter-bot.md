# Bot de trading Solana (filtrage + indicateurs, paper trading) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript bot that scans Solana DEX pools via the GeckoTerminal API, filters and scores them with technical indicators (RSI, SMA, momentum), simulates trades (paper trading) with stop-loss/take-profit/trailing-stop risk management, and can backtest the same strategy against historical OHLCV data.

**Architecture:** A cyclic pipeline (`Scanner -> Filter -> Signal -> Risk -> Executor -> SQLite store`) where every stage is an independently testable module behind a narrow interface. The `Executor` is swappable (`PaperExecutor` now, a future `JupiterExecutor` later) so nothing else changes when real execution is added. No real wallet, private key, or on-chain execution is part of this plan.

**Tech Stack:** Node.js (v18+, native `fetch`) + TypeScript, `vitest` for tests, `better-sqlite3` for storage, `zod` for config validation, `tsx` to run TypeScript directly.

**Spec:** `docs/superpowers/specs/2026-08-27-solana-filter-bot-design.md`

## Global Constraints

- Paper trading only — no real order execution, no wallet, no private key anywhere in this plan (per spec "Hors scope").
- Data source is the GeckoTerminal public API (`https://api.geckoterminal.com/api/v2`), not DexScreener's undocumented API (per spec "Choix technique").
- Simulated capital and all risk thresholds live in `config/config.json`, never hard-coded inline in logic modules (per spec "Config").
- Every module (Scanner, Filter, Signal, Risk, Executor) is independently unit-testable and swappable behind its exported function/interface (per spec "Architecture").
- User-facing console output (in `main.ts` / `backtestRunner.ts`) is in French, matching the user's language; code identifiers and comments are in English per standard convention.
- API errors must never crash the process — log and continue (per spec "Gestion des erreurs").

---

## Task 1: Project scaffolding, shared types, and config loader

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `config/config.json`
- Create: `src/types.ts`
- Create: `src/config.ts`
- Test: `src/config.test.ts`

**Interfaces:**
- Produces: `Pool`, `Candle`, `FilterResult`, `SignalDecision`, `Signal`, `RiskDecision`, `Order`, `Fill`, `Executor`, `CloseReason`, `Position` (all in `src/types.ts`); `BotConfig` type and `loadConfig(path: string): BotConfig` (in `src/config.ts`).

- [ ] **Step 1: Initialize the project and install dependencies**

Run:
```bash
cd "C:/Users/titom/Projets/solana-trading-bot-ts"
npm init -y
npm install better-sqlite3 zod
npm install -D typescript tsx vitest @types/node @types/better-sqlite3
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Update `package.json` scripts and `type` field**

Edit `package.json` so it contains at least:

```json
{
  "name": "solana-trading-bot-ts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/main.ts",
    "backtest": "tsx src/backtestRunner.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```
(Keep the `dependencies`/`devDependencies` that `npm install` already added.)

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
data/
*.sqlite
.env
```

- [ ] **Step 6: Create `.env.example`**

```
# Réservé à la phase 2 (exécution réelle on-chain) — inutilisé en phase 1 (paper trading)
# SOLANA_WALLET_PRIVATE_KEY=
# RPC_URL=
```

- [ ] **Step 7: Create `config/config.json` with default values**

```json
{
  "scanIntervalSeconds": 60,
  "network": "solana",
  "filters": {
    "minLiquidityUsd": 20000,
    "minPoolAgeMinutes": 60
  },
  "indicators": {
    "rsiPeriod": 14,
    "rsiOversold": 35,
    "smaPeriod": 20,
    "momentumLookbackCandles": 6,
    "momentumMinPct": 3
  },
  "risk": {
    "simulatedCapitalUsd": 100,
    "maxPositionPct": 10,
    "maxOpenPositions": 3,
    "stopLossPct": 20,
    "takeProfitPct": 50,
    "trailingStopPct": 15
  },
  "geckoTerminal": {
    "baseUrl": "https://api.geckoterminal.com/api/v2",
    "timeframe": "hour",
    "ohlcvLimit": 100
  }
}
```

- [ ] **Step 8: Write `src/types.ts` (shared domain types, no test needed — pure types)**

```ts
export interface Pool {
  poolAddress: string;
  baseTokenSymbol: string;
  baseTokenAddress: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange24hPct: number;
  poolCreatedAt: Date;
}

export interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FilterResult {
  pool: Pool;
  passed: boolean;
  reason: string;
}

export type SignalDecision = 'BUY' | 'HOLD' | 'SKIP';

export interface Signal {
  pool: Pool;
  decision: SignalDecision;
  reason: string;
  indicators: {
    rsi: number | null;
    sma: number | null;
    momentumPct: number | null;
  };
}

export interface RiskDecision {
  approved: boolean;
  reason: string;
  positionSizeUsd?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingStopPct?: number;
}

export interface Order {
  poolAddress: string;
  baseTokenSymbol: string;
  side: 'BUY' | 'SELL';
  sizeUsd: number;
  priceUsd: number;
}

export interface Fill {
  poolAddress: string;
  side: 'BUY' | 'SELL';
  sizeUsd: number;
  filledPriceUsd: number;
  filledAt: Date;
}

export interface Executor {
  execute(order: Order): Promise<Fill>;
}

export type CloseReason = 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP';

export interface Position {
  id: number;
  poolAddress: string;
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

- [ ] **Step 9: Write the failing test for the config loader**

```ts
// src/config.test.ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.js';

function writeTempConfig(content: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-config-'));
  const filePath = path.join(dir, 'config.json');
  fs.writeFileSync(filePath, JSON.stringify(content));
  return filePath;
}

const validConfig = {
  scanIntervalSeconds: 60,
  network: 'solana',
  filters: { minLiquidityUsd: 20000, minPoolAgeMinutes: 60 },
  indicators: {
    rsiPeriod: 14,
    rsiOversold: 35,
    smaPeriod: 20,
    momentumLookbackCandles: 6,
    momentumMinPct: 3,
  },
  risk: {
    simulatedCapitalUsd: 100,
    maxPositionPct: 10,
    maxOpenPositions: 3,
    stopLossPct: 20,
    takeProfitPct: 50,
    trailingStopPct: 15,
  },
  geckoTerminal: {
    baseUrl: 'https://api.geckoterminal.com/api/v2',
    timeframe: 'hour',
    ohlcvLimit: 100,
  },
};

describe('loadConfig', () => {
  it('loads a valid config file', () => {
    const filePath = writeTempConfig(validConfig);
    const config = loadConfig(filePath);
    expect(config.scanIntervalSeconds).toBe(60);
    expect(config.risk.simulatedCapitalUsd).toBe(100);
  });

  it('throws a clear error when a required field is missing', () => {
    const { risk, ...withoutRisk } = validConfig;
    const filePath = writeTempConfig(withoutRisk);
    expect(() => loadConfig(filePath)).toThrow(/Config invalide/);
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL — `Cannot find module './config.js'` (or similar, since `src/config.ts` doesn't exist yet).

- [ ] **Step 11: Implement `src/config.ts`**

```ts
import fs from 'node:fs';
import { z } from 'zod';

export const BotConfigSchema = z.object({
  scanIntervalSeconds: z.number().positive(),
  network: z.string().min(1),
  filters: z.object({
    minLiquidityUsd: z.number().nonnegative(),
    minPoolAgeMinutes: z.number().nonnegative(),
  }),
  indicators: z.object({
    rsiPeriod: z.number().int().positive(),
    rsiOversold: z.number().min(0).max(100),
    smaPeriod: z.number().int().positive(),
    momentumLookbackCandles: z.number().int().positive(),
    momentumMinPct: z.number(),
  }),
  risk: z.object({
    simulatedCapitalUsd: z.number().positive(),
    maxPositionPct: z.number().positive().max(100),
    maxOpenPositions: z.number().int().positive(),
    stopLossPct: z.number().positive().max(100),
    takeProfitPct: z.number().positive(),
    trailingStopPct: z.number().positive().max(100),
  }),
  geckoTerminal: z.object({
    baseUrl: z.string().url(),
    timeframe: z.enum(['day', 'hour', 'minute']),
    ohlcvLimit: z.number().int().positive(),
  }),
});

export type BotConfig = z.infer<typeof BotConfigSchema>;

export function loadConfig(path: string): BotConfig {
  const raw = fs.readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw);
  const result = BotConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Config invalide dans ${path} : ${result.error.message}`);
  }
  return result.data;
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `npx vitest run src/config.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example config/config.json src/types.ts src/config.ts src/config.test.ts
git commit -m "chore: project scaffolding, shared types, and config loader"
```

---

## Task 2: GeckoTerminal API client

**Files:**
- Create: `src/geckoterminal/client.ts`
- Test: `src/geckoterminal/client.test.ts`

**Interfaces:**
- Consumes: `Pool`, `Candle` from `src/types.ts` (Task 1).
- Produces: `GeckoTerminalClient` interface with `fetchTrendingPools(network: string): Promise<Pool[]>`, `fetchOhlcv(network: string, poolAddress: string, timeframe: 'day' | 'hour' | 'minute', limit: number): Promise<Candle[]>`, `fetchPoolPrice(network: string, poolAddress: string): Promise<number | null>`; `createGeckoTerminalClient(baseUrl: string): GeckoTerminalClient` factory. Used by Task 3 (Scanner), Task 6 (Signal), Task 11 (Pipeline), Task 12 (main), Task 13 (backtestRunner).

- [ ] **Step 1: Write the failing tests**

```ts
// src/geckoterminal/client.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeckoTerminalClient } from './client.js';

const trendingPoolsResponse = {
  data: [
    {
      id: 'solana_POOL1',
      attributes: {
        address: 'POOL1',
        base_token_price_usd: '0.5',
        pool_created_at: '2026-08-01T00:00:00.000Z',
        reserve_in_usd: '25000',
        volume_usd: { h24: '10000' },
        price_change_percentage: { h24: '5.5' },
      },
      relationships: {
        base_token: { data: { id: 'solana_TOKEN1' } },
      },
    },
  ],
  included: [
    {
      id: 'solana_TOKEN1',
      type: 'token',
      attributes: { symbol: 'FOO', name: 'Foo Token', address: 'TOKEN1' },
    },
  ],
};

const ohlcvResponse = {
  data: {
    attributes: {
      ohlcv_list: [
        [1000, 1.3, 1.4, 1.2, 1.35, 500],
        [900, 1.1, 1.2, 1.0, 1.2, 400],
        [800, 1.0, 1.1, 0.9, 1.1, 300],
      ],
    },
  },
};

const poolResponse = {
  data: { attributes: { base_token_price_usd: '0.42' } },
};

function mockFetchOnce(response: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: async () => response,
  });
}

describe('GeckoTerminalHttpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchTrendingPools maps the raw response into Pool objects', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(trendingPoolsResponse));
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2');

    const pools = await client.fetchTrendingPools('solana');

    expect(pools).toEqual([
      {
        poolAddress: 'POOL1',
        baseTokenSymbol: 'FOO',
        baseTokenAddress: 'TOKEN1',
        priceUsd: 0.5,
        liquidityUsd: 25000,
        volume24hUsd: 10000,
        priceChange24hPct: 5.5,
        poolCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]);
  });

  it('fetchOhlcv reverses the newest-first list into chronological order', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(ohlcvResponse));
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2');

    const candles = await client.fetchOhlcv('solana', 'POOL1', 'hour', 3);

    expect(candles.map((c) => c.close)).toEqual([1.1, 1.2, 1.35]);
    expect(candles[0].timestamp).toEqual(new Date(800 * 1000));
  });

  it('fetchPoolPrice parses the single-pool response', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(poolResponse));
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2');

    const price = await client.fetchPoolPrice('solana', 'POOL1');

    expect(price).toBe(0.42);
  });

  it('fetchPoolPrice returns null instead of throwing when the request keeps failing', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({}, false));
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2');

    const price = await client.fetchPoolPrice('solana', 'MISSING');

    expect(price).toBeNull();
  });

  it('fetchTrendingPools retries on failure and eventually throws after exhausting retries', async () => {
    const failingFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', failingFetch);
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2');

    await expect(client.fetchTrendingPools('solana')).rejects.toThrow(/Échec de la requête/);
    expect(failingFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/geckoterminal/client.test.ts`
Expected: FAIL — `Cannot find module './client.js'`

- [ ] **Step 3: Implement `src/geckoterminal/client.ts`**

```ts
import type { Candle, Pool } from '../types.js';

export interface GeckoTerminalClient {
  fetchTrendingPools(network: string): Promise<Pool[]>;
  fetchOhlcv(
    network: string,
    poolAddress: string,
    timeframe: 'day' | 'hour' | 'minute',
    limit: number
  ): Promise<Candle[]>;
  fetchPoolPrice(network: string, poolAddress: string): Promise<number | null>;
}

interface RawTokenIncluded {
  id: string;
  type: string;
  attributes: { symbol: string; name: string; address: string };
}

interface RawPoolData {
  attributes: {
    address: string;
    base_token_price_usd: string;
    pool_created_at: string;
    reserve_in_usd: string;
    volume_usd: { h24: string };
    price_change_percentage: { h24: string };
  };
  relationships: {
    base_token: { data: { id: string } };
  };
}

export class GeckoTerminalHttpClient implements GeckoTerminalClient {
  constructor(private baseUrl: string) {}

  async fetchTrendingPools(network: string): Promise<Pool[]> {
    const url = `${this.baseUrl}/networks/${network}/trending_pools?include=base_token`;
    const json = await fetchJsonWithRetry(url);
    const tokensById = new Map<string, RawTokenIncluded>();
    for (const item of json.included ?? []) {
      if (item.type === 'token') tokensById.set(item.id, item);
    }
    return (json.data as RawPoolData[]).map((raw) => {
      const baseTokenId = raw.relationships.base_token.data.id;
      const baseToken = tokensById.get(baseTokenId);
      return {
        poolAddress: raw.attributes.address,
        baseTokenSymbol: baseToken?.attributes.symbol ?? 'UNKNOWN',
        baseTokenAddress: baseToken?.attributes.address ?? '',
        priceUsd: parseFloat(raw.attributes.base_token_price_usd),
        liquidityUsd: parseFloat(raw.attributes.reserve_in_usd),
        volume24hUsd: parseFloat(raw.attributes.volume_usd.h24),
        priceChange24hPct: parseFloat(raw.attributes.price_change_percentage.h24),
        poolCreatedAt: new Date(raw.attributes.pool_created_at),
      };
    });
  }

  async fetchOhlcv(
    network: string,
    poolAddress: string,
    timeframe: 'day' | 'hour' | 'minute',
    limit: number
  ): Promise<Candle[]> {
    const url = `${this.baseUrl}/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=1&limit=${limit}&currency=usd`;
    const json = await fetchJsonWithRetry(url);
    const list: number[][] = json.data.attributes.ohlcv_list;
    return list
      .map(([timestamp, open, high, low, close, volume]) => ({
        timestamp: new Date(timestamp * 1000),
        open,
        high,
        low,
        close,
        volume,
      }))
      .reverse();
  }

  async fetchPoolPrice(network: string, poolAddress: string): Promise<number | null> {
    try {
      const url = `${this.baseUrl}/networks/${network}/pools/${poolAddress}`;
      const json = await fetchJsonWithRetry(url);
      return parseFloat(json.data.attributes.base_token_price_usd);
    } catch {
      return null;
    }
  }
}

export function createGeckoTerminalClient(baseUrl: string): GeckoTerminalClient {
  return new GeckoTerminalHttpClient(baseUrl);
}

async function fetchJsonWithRetry(url: string, retries = 3): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`GeckoTerminal API error: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(500 * Math.pow(2, attempt));
      }
    }
  }
  throw new Error(`Échec de la requête GeckoTerminal après ${retries + 1} tentatives : ${String(lastError)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/geckoterminal/client.test.ts`
Expected: PASS (5 tests). Note: the retry test takes ~3.5s of real time (500ms + 1s + 2s backoff) — this is expected, not a hang.

- [ ] **Step 5: Commit**

```bash
git add src/geckoterminal/client.ts src/geckoterminal/client.test.ts
git commit -m "feat: GeckoTerminal API client (trending pools, OHLCV, single-pool price)"
```

---

## Task 3: Scanner

**Files:**
- Create: `src/scanner.ts`
- Test: `src/scanner.test.ts`

**Interfaces:**
- Consumes: `GeckoTerminalClient` (Task 2), `Pool`, `BotConfig` (Task 1).
- Produces: `scanPools(client: GeckoTerminalClient, config: BotConfig): Promise<Pool[]>`. Used by Task 11 (Pipeline).

- [ ] **Step 1: Write the failing test**

```ts
// src/scanner.test.ts
import { describe, expect, it, vi } from 'vitest';
import { scanPools } from './scanner.js';
import type { GeckoTerminalClient } from './geckoterminal/client.js';
import type { BotConfig } from './config.js';
import type { Pool } from './types.js';

function makePool(poolAddress: string): Pool {
  return {
    poolAddress,
    baseTokenSymbol: 'FOO',
    baseTokenAddress: 'token-' + poolAddress,
    priceUsd: 1,
    liquidityUsd: 10000,
    volume24hUsd: 5000,
    priceChange24hPct: 1,
    poolCreatedAt: new Date(),
  };
}

const config = { network: 'solana' } as BotConfig;

describe('scanPools', () => {
  it('returns the pools from the client', async () => {
    const client: GeckoTerminalClient = {
      fetchTrendingPools: vi.fn().mockResolvedValue([makePool('A'), makePool('B')]),
      fetchOhlcv: vi.fn(),
      fetchPoolPrice: vi.fn(),
    };

    const pools = await scanPools(client, config);

    expect(pools.map((p) => p.poolAddress)).toEqual(['A', 'B']);
    expect(client.fetchTrendingPools).toHaveBeenCalledWith('solana');
  });

  it('deduplicates pools with the same address', async () => {
    const client: GeckoTerminalClient = {
      fetchTrendingPools: vi.fn().mockResolvedValue([makePool('A'), makePool('A')]),
      fetchOhlcv: vi.fn(),
      fetchPoolPrice: vi.fn(),
    };

    const pools = await scanPools(client, config);

    expect(pools).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/scanner.test.ts`
Expected: FAIL — `Cannot find module './scanner.js'`

- [ ] **Step 3: Implement `src/scanner.ts`**

```ts
import type { BotConfig } from './config.js';
import type { GeckoTerminalClient } from './geckoterminal/client.js';
import type { Pool } from './types.js';

export async function scanPools(client: GeckoTerminalClient, config: BotConfig): Promise<Pool[]> {
  const pools = await client.fetchTrendingPools(config.network);
  const seen = new Set<string>();
  const deduped: Pool[] = [];
  for (const pool of pools) {
    if (seen.has(pool.poolAddress)) continue;
    seen.add(pool.poolAddress);
    deduped.push(pool);
  }
  return deduped;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/scanner.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/scanner.ts src/scanner.test.ts
git commit -m "feat: scanner module (fetch + dedupe trending pools)"
```

---

## Task 4: Filter

**Files:**
- Create: `src/filter.ts`
- Test: `src/filter.test.ts`

**Interfaces:**
- Consumes: `Pool`, `FilterResult`, `BotConfig` (Task 1).
- Produces: `filterPools(pools: Pool[], config: BotConfig, now?: Date): FilterResult[]`. Used by Task 11 (Pipeline).

- [ ] **Step 1: Write the failing test**

```ts
// src/filter.test.ts
import { describe, expect, it } from 'vitest';
import { filterPools } from './filter.js';
import type { BotConfig } from './config.js';
import type { Pool } from './types.js';

const config = {
  filters: { minLiquidityUsd: 10000, minPoolAgeMinutes: 60 },
} as BotConfig;

const now = new Date('2026-08-27T12:00:00.000Z');

function makePool(overrides: Partial<Pool>): Pool {
  return {
    poolAddress: 'A',
    baseTokenSymbol: 'FOO',
    baseTokenAddress: 'token-A',
    priceUsd: 1,
    liquidityUsd: 20000,
    volume24hUsd: 5000,
    priceChange24hPct: 1,
    poolCreatedAt: new Date('2026-08-27T10:00:00.000Z'), // 2h before `now`
    ...overrides,
  };
}

describe('filterPools', () => {
  it('passes a pool that meets both thresholds', () => {
    const [result] = filterPools([makePool({})], config, now);
    expect(result.passed).toBe(true);
  });

  it('rejects a pool with insufficient liquidity', () => {
    const [result] = filterPools([makePool({ liquidityUsd: 5000 })], config, now);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/Liquidité/);
  });

  it('rejects a pool that is too young', () => {
    const [result] = filterPools(
      [makePool({ poolCreatedAt: new Date('2026-08-27T11:30:00.000Z') })], // 30 min before now
      config,
      now
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/âgé/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/filter.test.ts`
Expected: FAIL — `Cannot find module './filter.js'`

- [ ] **Step 3: Implement `src/filter.ts`**

```ts
import type { BotConfig } from './config.js';
import type { FilterResult, Pool } from './types.js';

export function filterPools(pools: Pool[], config: BotConfig, now: Date = new Date()): FilterResult[] {
  return pools.map((pool) => {
    if (pool.liquidityUsd < config.filters.minLiquidityUsd) {
      return {
        pool,
        passed: false,
        reason: `Liquidité ${pool.liquidityUsd.toFixed(0)}$ < minimum ${config.filters.minLiquidityUsd}$`,
      };
    }
    const ageMinutes = (now.getTime() - pool.poolCreatedAt.getTime()) / 60000;
    if (ageMinutes < config.filters.minPoolAgeMinutes) {
      return {
        pool,
        passed: false,
        reason: `Pool âgé de ${ageMinutes.toFixed(1)} min < minimum ${config.filters.minPoolAgeMinutes} min`,
      };
    }
    return { pool, passed: true, reason: 'OK' };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/filter.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/filter.ts src/filter.test.ts
git commit -m "feat: filter module (liquidity and pool-age thresholds)"
```

---

## Task 5: Indicators (RSI, SMA, momentum)

**Files:**
- Create: `src/indicators/rsi.ts`
- Create: `src/indicators/sma.ts`
- Create: `src/indicators/momentum.ts`
- Test: `src/indicators/rsi.test.ts`
- Test: `src/indicators/sma.test.ts`
- Test: `src/indicators/momentum.test.ts`

**Interfaces:**
- Produces: `calculateRSI(closes: number[], period: number): number | null`, `calculateSMA(closes: number[], period: number): number | null`, `calculateMomentumPct(closes: number[], lookback: number): number | null`. Used by Task 6 (Signal).

- [ ] **Step 1: Write the failing RSI test**

```ts
// src/indicators/rsi.test.ts
import { describe, expect, it } from 'vitest';
import { calculateRSI } from './rsi.js';

describe('calculateRSI', () => {
  it('returns null when there are fewer than period+1 closes', () => {
    expect(calculateRSI([1, 2, 3], 14)).toBeNull();
  });

  it('matches the classic 14-period RSI textbook example (~70.46)', () => {
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
      45.89, 46.03, 45.61, 46.28, 46.28,
    ];
    expect(calculateRSI(closes, 14)).toBeCloseTo(70.46, 1);
  });

  it('returns 100 when there are no losses in the period', () => {
    expect(calculateRSI([1, 2, 3, 4], 3)).toBe(100);
  });
});
```

- [ ] **Step 2: Run the RSI test to verify it fails**

Run: `npx vitest run src/indicators/rsi.test.ts`
Expected: FAIL — `Cannot find module './rsi.js'`

- [ ] **Step 3: Implement `src/indicators/rsi.ts`**

```ts
export function calculateRSI(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  const recent = closes.slice(closes.length - (period + 1));
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff > 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }
  const avgGain = gainSum / period;
  const avgLoss = lossSum / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
```

- [ ] **Step 4: Run the RSI test to verify it passes**

Run: `npx vitest run src/indicators/rsi.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing SMA test**

```ts
// src/indicators/sma.test.ts
import { describe, expect, it } from 'vitest';
import { calculateSMA } from './sma.js';

describe('calculateSMA', () => {
  it('returns null when there are fewer closes than the period', () => {
    expect(calculateSMA([1, 2], 5)).toBeNull();
  });

  it('averages the last `period` closes', () => {
    expect(calculateSMA([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(calculateSMA([10, 1, 2, 3, 4, 5], 5)).toBe(3); // ignores the older leading value
  });
});
```

- [ ] **Step 6: Run the SMA test to verify it fails**

Run: `npx vitest run src/indicators/sma.test.ts`
Expected: FAIL — `Cannot find module './sma.js'`

- [ ] **Step 7: Implement `src/indicators/sma.ts`**

```ts
export function calculateSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const recent = closes.slice(closes.length - period);
  const sum = recent.reduce((acc, v) => acc + v, 0);
  return sum / period;
}
```

- [ ] **Step 8: Run the SMA test to verify it passes**

Run: `npx vitest run src/indicators/sma.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Write the failing momentum test**

```ts
// src/indicators/momentum.test.ts
import { describe, expect, it } from 'vitest';
import { calculateMomentumPct } from './momentum.js';

describe('calculateMomentumPct', () => {
  it('returns null when there are not enough closes for the lookback', () => {
    expect(calculateMomentumPct([1, 2], 5)).toBeNull();
  });

  it('computes the percent change vs. `lookback` candles ago', () => {
    expect(calculateMomentumPct([100, 105, 110], 2)).toBeCloseTo(10, 5);
  });

  it('returns a negative value when the price dropped', () => {
    expect(calculateMomentumPct([100, 95, 90], 2)).toBeCloseTo(-10, 5);
  });
});
```

- [ ] **Step 10: Run the momentum test to verify it fails**

Run: `npx vitest run src/indicators/momentum.test.ts`
Expected: FAIL — `Cannot find module './momentum.js'`

- [ ] **Step 11: Implement `src/indicators/momentum.ts`**

```ts
export function calculateMomentumPct(closes: number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;
  const latest = closes[closes.length - 1];
  const past = closes[closes.length - 1 - lookback];
  if (past === 0) return null;
  return ((latest - past) / past) * 100;
}
```

- [ ] **Step 12: Run the momentum test to verify it passes**

Run: `npx vitest run src/indicators/momentum.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 13: Commit**

```bash
git add src/indicators/rsi.ts src/indicators/rsi.test.ts src/indicators/sma.ts src/indicators/sma.test.ts src/indicators/momentum.ts src/indicators/momentum.test.ts
git commit -m "feat: RSI, SMA, and momentum indicators"
```

---

## Task 6: Signal

**Files:**
- Create: `src/signal.ts`
- Test: `src/signal.test.ts`

**Interfaces:**
- Consumes: `calculateRSI`, `calculateSMA`, `calculateMomentumPct` (Task 5), `GeckoTerminalClient` (Task 2), `Pool`, `Candle`, `Signal`, `BotConfig` (Task 1).
- Produces: `evaluateSignal(pool: Pool, candles: Candle[], config: BotConfig): Signal` (pure, used directly by Task 13 Backtest), `generateSignal(client: GeckoTerminalClient, pool: Pool, config: BotConfig): Promise<Signal>` (live wrapper, used by Task 11 Pipeline).

**Decision rule:** BUY when RSI ≤ `rsiOversold` (oversold) AND momentum ≥ `momentumMinPct` (renewed upward move) AND latest close > SMA (price above its trend line). SKIP when there isn't enough history to compute the indicators. Otherwise HOLD.

- [ ] **Step 1: Write the failing tests**

```ts
// src/signal.test.ts
import { describe, expect, it, vi } from 'vitest';
import { evaluateSignal, generateSignal } from './signal.js';
import type { GeckoTerminalClient } from './geckoterminal/client.js';
import type { BotConfig } from './config.js';
import type { Candle, Pool } from './types.js';

const config = {
  network: 'solana',
  indicators: {
    rsiPeriod: 2,
    rsiOversold: 50,
    smaPeriod: 2,
    momentumLookbackCandles: 1,
    momentumMinPct: 0,
  },
  geckoTerminal: { baseUrl: 'x', timeframe: 'hour', ohlcvLimit: 100 },
} as BotConfig;

const pool: Pool = {
  poolAddress: 'POOL1',
  baseTokenSymbol: 'FOO',
  baseTokenAddress: 'TOKEN1',
  priceUsd: 0.9,
  liquidityUsd: 50000,
  volume24hUsd: 10000,
  priceChange24hPct: 5,
  poolCreatedAt: new Date(),
};

function candle(close: number, offsetMs: number): Candle {
  return { timestamp: new Date(offsetMs), open: close, high: close, low: close, close, volume: 100 };
}

describe('evaluateSignal', () => {
  it('returns SKIP when there is not enough history', () => {
    const candles = [candle(1, 0), candle(0.9, 1)];
    const signal = evaluateSignal(pool, candles, config);
    expect(signal.decision).toBe('SKIP');
  });

  it('returns BUY when RSI is oversold, momentum is positive, and price is above the SMA', () => {
    // closes: 1.0, 0.9, 0.8, 0.9 -> RSI(2)=50, SMA(2)=0.85, momentum(1)=+12.5%
    const candles = [candle(1.0, 0), candle(0.9, 1), candle(0.8, 2), candle(0.9, 3)];
    const signal = evaluateSignal(pool, candles, config);
    expect(signal.decision).toBe('BUY');
    expect(signal.indicators.rsi).toBeCloseTo(50, 5);
    expect(signal.indicators.sma).toBeCloseTo(0.85, 5);
    expect(signal.indicators.momentumPct).toBeCloseTo(12.5, 5);
  });

  it('returns HOLD when conditions are not all met', () => {
    // closes: 1.0, 1.1, 1.2, 1.4 -> RSI(2) will be high (not oversold)
    const candles = [candle(1.0, 0), candle(1.1, 1), candle(1.2, 2), candle(1.4, 3)];
    const signal = evaluateSignal(pool, candles, config);
    expect(signal.decision).toBe('HOLD');
  });
});

describe('generateSignal', () => {
  it('fetches OHLCV from the client and delegates to evaluateSignal', async () => {
    const candles = [candle(1.0, 0), candle(0.9, 1), candle(0.8, 2), candle(0.9, 3)];
    const client: GeckoTerminalClient = {
      fetchTrendingPools: vi.fn(),
      fetchOhlcv: vi.fn().mockResolvedValue(candles),
      fetchPoolPrice: vi.fn(),
    };

    const signal = await generateSignal(client, pool, config);

    expect(client.fetchOhlcv).toHaveBeenCalledWith('solana', 'POOL1', 'hour', 100);
    expect(signal.decision).toBe('BUY');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/signal.test.ts`
Expected: FAIL — `Cannot find module './signal.js'`

- [ ] **Step 3: Implement `src/signal.ts`**

```ts
import type { BotConfig } from './config.js';
import type { GeckoTerminalClient } from './geckoterminal/client.js';
import type { Candle, Pool, Signal } from './types.js';
import { calculateRSI } from './indicators/rsi.js';
import { calculateSMA } from './indicators/sma.js';
import { calculateMomentumPct } from './indicators/momentum.js';

export function evaluateSignal(pool: Pool, candles: Candle[], config: BotConfig): Signal {
  const closes = candles.map((c) => c.close);
  const rsi = calculateRSI(closes, config.indicators.rsiPeriod);
  const sma = calculateSMA(closes, config.indicators.smaPeriod);
  const momentumPct = calculateMomentumPct(closes, config.indicators.momentumLookbackCandles);
  const indicators = { rsi, sma, momentumPct };

  if (rsi === null || sma === null || momentumPct === null) {
    return {
      pool,
      decision: 'SKIP',
      reason: 'Pas assez de données historiques pour calculer les indicateurs',
      indicators,
    };
  }

  const latestClose = closes[closes.length - 1];
  const isOversold = rsi <= config.indicators.rsiOversold;
  const hasMomentum = momentumPct >= config.indicators.momentumMinPct;
  const aboveTrend = latestClose > sma;

  if (isOversold && hasMomentum && aboveTrend) {
    return {
      pool,
      decision: 'BUY',
      reason: `RSI survendu (${rsi.toFixed(1)}) avec momentum positif (${momentumPct.toFixed(1)}%) et prix au-dessus de la SMA`,
      indicators,
    };
  }

  const reasons: string[] = [];
  if (!isOversold) reasons.push(`RSI ${rsi.toFixed(1)} > seuil ${config.indicators.rsiOversold}`);
  if (!hasMomentum) reasons.push(`momentum ${momentumPct.toFixed(1)}% < seuil ${config.indicators.momentumMinPct}%`);
  if (!aboveTrend) reasons.push('prix sous la SMA');

  return { pool, decision: 'HOLD', reason: reasons.join(' ; '), indicators };
}

export async function generateSignal(
  client: GeckoTerminalClient,
  pool: Pool,
  config: BotConfig
): Promise<Signal> {
  const candles = await client.fetchOhlcv(
    config.network,
    pool.poolAddress,
    config.geckoTerminal.timeframe,
    config.geckoTerminal.ohlcvLimit
  );
  return evaluateSignal(pool, candles, config);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/signal.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/signal.ts src/signal.test.ts
git commit -m "feat: signal module (RSI + SMA + momentum decision rule)"
```

---

## Task 7: Risk management

**Files:**
- Create: `src/risk.ts`
- Test: `src/risk.test.ts`

**Interfaces:**
- Consumes: `Signal`, `RiskDecision`, `BotConfig` (Task 1).
- Produces: `evaluateRisk(signal: Signal, openPositionsCount: number, availableCapitalUsd: number, config: BotConfig): RiskDecision`. Used by Task 11 (Pipeline) and Task 13 (Backtest).

- [ ] **Step 1: Write the failing test**

```ts
// src/risk.test.ts
import { describe, expect, it } from 'vitest';
import { evaluateRisk } from './risk.js';
import type { BotConfig } from './config.js';
import type { Pool, Signal } from './types.js';

const config = {
  risk: {
    simulatedCapitalUsd: 100,
    maxPositionPct: 10,
    maxOpenPositions: 3,
    stopLossPct: 20,
    takeProfitPct: 50,
    trailingStopPct: 15,
  },
} as BotConfig;

const pool: Pool = {
  poolAddress: 'POOL1',
  baseTokenSymbol: 'FOO',
  baseTokenAddress: 'TOKEN1',
  priceUsd: 1,
  liquidityUsd: 50000,
  volume24hUsd: 10000,
  priceChange24hPct: 5,
  poolCreatedAt: new Date(),
};

const buySignal: Signal = {
  pool,
  decision: 'BUY',
  reason: 'test',
  indicators: { rsi: 30, sma: 0.9, momentumPct: 5 },
};

describe('evaluateRisk', () => {
  it('approves a BUY signal and computes size, stop-loss, and take-profit', () => {
    const decision = evaluateRisk(buySignal, 0, 100, config);
    expect(decision.approved).toBe(true);
    expect(decision.positionSizeUsd).toBeCloseTo(10, 5); // 10% of 100
    expect(decision.stopLossPrice).toBeCloseTo(0.8, 5); // 1 * (1 - 0.20)
    expect(decision.takeProfitPrice).toBeCloseTo(1.5, 5); // 1 * (1 + 0.50)
    expect(decision.trailingStopPct).toBe(15);
  });

  it('rejects when the signal is not BUY', () => {
    const decision = evaluateRisk({ ...buySignal, decision: 'HOLD' }, 0, 100, config);
    expect(decision.approved).toBe(false);
  });

  it('rejects when the max number of open positions is reached', () => {
    const decision = evaluateRisk(buySignal, 3, 100, config);
    expect(decision.approved).toBe(false);
    expect(decision.reason).toMatch(/max de positions/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/risk.test.ts`
Expected: FAIL — `Cannot find module './risk.js'`

- [ ] **Step 3: Implement `src/risk.ts`**

```ts
import type { BotConfig } from './config.js';
import type { RiskDecision, Signal } from './types.js';

export function evaluateRisk(
  signal: Signal,
  openPositionsCount: number,
  availableCapitalUsd: number,
  config: BotConfig
): RiskDecision {
  if (signal.decision !== 'BUY') {
    return { approved: false, reason: `Signal n'est pas BUY (${signal.decision})` };
  }
  if (openPositionsCount >= config.risk.maxOpenPositions) {
    return {
      approved: false,
      reason: `Nombre max de positions ouvertes atteint (${openPositionsCount}/${config.risk.maxOpenPositions})`,
    };
  }
  const positionSizeUsd = (availableCapitalUsd * config.risk.maxPositionPct) / 100;
  if (positionSizeUsd <= 0) {
    return { approved: false, reason: 'Capital disponible insuffisant' };
  }
  const entryPrice = signal.pool.priceUsd;
  const stopLossPrice = entryPrice * (1 - config.risk.stopLossPct / 100);
  const takeProfitPrice = entryPrice * (1 + config.risk.takeProfitPct / 100);
  return {
    approved: true,
    reason: 'Approuvé',
    positionSizeUsd,
    stopLossPrice,
    takeProfitPrice,
    trailingStopPct: config.risk.trailingStopPct,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/risk.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/risk.ts src/risk.test.ts
git commit -m "feat: risk module (position sizing, stop-loss, take-profit)"
```

---

## Task 8: SQLite store

**Files:**
- Create: `src/store/db.ts`
- Create: `src/store/positionRepository.ts`
- Create: `src/store/decisionLogRepository.ts`
- Test: `src/store/positionRepository.test.ts`
- Test: `src/store/decisionLogRepository.test.ts`

**Interfaces:**
- Produces: `createDb(dbPath: string): Database.Database` (Db.ts); `PositionRepository` class with `openPosition(data: NewPositionData): Position`, `getById(id: number): Position | undefined`, `getOpenPositions(): Position[]`, `updateHighestPrice(id: number, priceUsd: number): void`, `closePosition(id: number, closePriceUsd: number, closeReason: CloseReason, closedAt: Date): Position`; `DecisionLogRepository` class with `log(entry: DecisionLogEntry): void`, `getRecent(limit: number): DecisionLogEntry[]`. Used by Task 10 (Position Manager) and Task 11 (Pipeline).

- [ ] **Step 1: Implement `src/store/db.ts` (schema setup, no separate test — exercised by the repository tests below)**

```ts
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function createDb(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_address TEXT NOT NULL,
      base_token_symbol TEXT NOT NULL,
      entry_price_usd REAL NOT NULL,
      size_usd REAL NOT NULL,
      stop_loss_price REAL NOT NULL,
      take_profit_price REAL NOT NULL,
      trailing_stop_pct REAL NOT NULL,
      highest_price_usd REAL NOT NULL,
      opened_at TEXT NOT NULL,
      status TEXT NOT NULL,
      closed_at TEXT,
      close_price_usd REAL,
      close_reason TEXT,
      pnl_usd REAL
    );
    CREATE TABLE IF NOT EXISTS decision_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      pool_address TEXT NOT NULL,
      stage TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL
    );
  `);
  return db;
}
```

- [ ] **Step 2: Write the failing PositionRepository test**

```ts
// src/store/positionRepository.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from './db.js';
import { PositionRepository } from './positionRepository.js';

let db: Database.Database;
let repo: PositionRepository;

beforeEach(() => {
  db = createDb(':memory:');
  repo = new PositionRepository(db);
});

describe('PositionRepository', () => {
  it('opens a position and can read it back among open positions', () => {
    const position = repo.openPosition({
      poolAddress: 'POOL1',
      baseTokenSymbol: 'FOO',
      entryPriceUsd: 1,
      sizeUsd: 10,
      stopLossPrice: 0.8,
      takeProfitPrice: 1.5,
      trailingStopPct: 15,
      openedAt: new Date('2026-08-27T00:00:00.000Z'),
    });

    expect(position.status).toBe('OPEN');
    expect(position.highestPriceUsd).toBe(1);
    expect(repo.getOpenPositions()).toHaveLength(1);
  });

  it('updates the highest price seen', () => {
    const position = repo.openPosition({
      poolAddress: 'POOL1',
      baseTokenSymbol: 'FOO',
      entryPriceUsd: 1,
      sizeUsd: 10,
      stopLossPrice: 0.8,
      takeProfitPrice: 1.5,
      trailingStopPct: 15,
      openedAt: new Date(),
    });

    repo.updateHighestPrice(position.id, 1.3);

    expect(repo.getById(position.id)!.highestPriceUsd).toBe(1.3);
  });

  it('closes a position, computes PnL, and removes it from open positions', () => {
    const position = repo.openPosition({
      poolAddress: 'POOL1',
      baseTokenSymbol: 'FOO',
      entryPriceUsd: 1,
      sizeUsd: 10,
      stopLossPrice: 0.8,
      takeProfitPrice: 1.5,
      trailingStopPct: 15,
      openedAt: new Date(),
    });

    const closed = repo.closePosition(position.id, 1.5, 'TAKE_PROFIT', new Date('2026-08-27T01:00:00.000Z'));

    expect(closed.status).toBe('CLOSED');
    expect(closed.pnlUsd).toBeCloseTo(5, 5); // (1.5-1)/1 * 10
    expect(repo.getOpenPositions()).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/store/positionRepository.test.ts`
Expected: FAIL — `Cannot find module './positionRepository.js'`

- [ ] **Step 4: Implement `src/store/positionRepository.ts`**

```ts
import type Database from 'better-sqlite3';
import type { CloseReason, Position } from '../types.js';

export interface NewPositionData {
  poolAddress: string;
  baseTokenSymbol: string;
  entryPriceUsd: number;
  sizeUsd: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  trailingStopPct: number;
  openedAt: Date;
}

export class PositionRepository {
  constructor(private db: Database.Database) {}

  openPosition(data: NewPositionData): Position {
    const stmt = this.db.prepare(`
      INSERT INTO positions
        (pool_address, base_token_symbol, entry_price_usd, size_usd,
         stop_loss_price, take_profit_price, trailing_stop_pct,
         highest_price_usd, opened_at, status)
      VALUES (@poolAddress, @baseTokenSymbol, @entryPriceUsd, @sizeUsd,
              @stopLossPrice, @takeProfitPrice, @trailingStopPct,
              @entryPriceUsd, @openedAt, 'OPEN')
    `);
    const result = stmt.run({
      poolAddress: data.poolAddress,
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

  getById(id: number): Position | undefined {
    const row = this.db.prepare('SELECT * FROM positions WHERE id = ?').get(id);
    return row ? rowToPosition(row) : undefined;
  }

  getOpenPositions(): Position[] {
    const rows = this.db.prepare("SELECT * FROM positions WHERE status = 'OPEN'").all();
    return rows.map(rowToPosition);
  }

  updateHighestPrice(id: number, priceUsd: number): void {
    this.db.prepare('UPDATE positions SET highest_price_usd = ? WHERE id = ?').run(priceUsd, id);
  }

  closePosition(id: number, closePriceUsd: number, closeReason: CloseReason, closedAt: Date): Position {
    const position = this.getById(id);
    if (!position) throw new Error(`Position ${id} introuvable`);
    const pnlUsd = ((closePriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * position.sizeUsd;
    this.db
      .prepare(
        `UPDATE positions
         SET status = 'CLOSED', closed_at = ?, close_price_usd = ?, close_reason = ?, pnl_usd = ?
         WHERE id = ?`
      )
      .run(closedAt.toISOString(), closePriceUsd, closeReason, pnlUsd, id);
    return this.getById(id)!;
  }
}

function rowToPosition(row: any): Position {
  return {
    id: row.id,
    poolAddress: row.pool_address,
    baseTokenSymbol: row.base_token_symbol,
    entryPriceUsd: row.entry_price_usd,
    sizeUsd: row.size_usd,
    stopLossPrice: row.stop_loss_price,
    takeProfitPrice: row.take_profit_price,
    trailingStopPct: row.trailing_stop_pct,
    highestPriceUsd: row.highest_price_usd,
    openedAt: new Date(row.opened_at),
    status: row.status,
    closedAt: row.closed_at ? new Date(row.closed_at) : undefined,
    closePriceUsd: row.close_price_usd ?? undefined,
    closeReason: row.close_reason ?? undefined,
    pnlUsd: row.pnl_usd ?? undefined,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/store/positionRepository.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Write the failing DecisionLogRepository test**

```ts
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
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run src/store/decisionLogRepository.test.ts`
Expected: FAIL — `Cannot find module './decisionLogRepository.js'`

- [ ] **Step 8: Implement `src/store/decisionLogRepository.ts`**

```ts
import type Database from 'better-sqlite3';

export interface DecisionLogEntry {
  timestamp: Date;
  poolAddress: string;
  stage: 'FILTER' | 'SIGNAL' | 'RISK';
  decision: string;
  reason: string;
}

export class DecisionLogRepository {
  constructor(private db: Database.Database) {}

  log(entry: DecisionLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO decision_logs (timestamp, pool_address, stage, decision, reason)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(entry.timestamp.toISOString(), entry.poolAddress, entry.stage, entry.decision, entry.reason);
  }

  getRecent(limit: number): DecisionLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM decision_logs ORDER BY id DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map((row) => ({
      timestamp: new Date(row.timestamp),
      poolAddress: row.pool_address,
      stage: row.stage,
      decision: row.decision,
      reason: row.reason,
    }));
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run src/store/decisionLogRepository.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 10: Commit**

```bash
git add src/store/db.ts src/store/positionRepository.ts src/store/positionRepository.test.ts src/store/decisionLogRepository.ts src/store/decisionLogRepository.test.ts
git commit -m "feat: SQLite store (positions and decision log repositories)"
```

---

## Task 9: Paper Executor

**Files:**
- Create: `src/executor/paperExecutor.ts`
- Test: `src/executor/paperExecutor.test.ts`

**Interfaces:**
- Consumes: `Executor`, `Order`, `Fill` (Task 1).
- Produces: `PaperExecutor` class implementing `Executor`. Used by Task 10 (Position Manager), Task 11 (Pipeline), Task 12 (main).

- [ ] **Step 1: Write the failing test**

```ts
// src/executor/paperExecutor.test.ts
import { describe, expect, it } from 'vitest';
import { PaperExecutor } from './paperExecutor.js';
import type { Order } from '../types.js';

describe('PaperExecutor', () => {
  it('simulates an immediate fill at the order price', async () => {
    const executor = new PaperExecutor();
    const order: Order = {
      poolAddress: 'POOL1',
      baseTokenSymbol: 'FOO',
      side: 'BUY',
      sizeUsd: 10,
      priceUsd: 1.23,
    };

    const before = Date.now();
    const fill = await executor.execute(order);
    const after = Date.now();

    expect(fill.poolAddress).toBe('POOL1');
    expect(fill.side).toBe('BUY');
    expect(fill.sizeUsd).toBe(10);
    expect(fill.filledPriceUsd).toBe(1.23);
    expect(fill.filledAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(fill.filledAt.getTime()).toBeLessThanOrEqual(after);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/executor/paperExecutor.test.ts`
Expected: FAIL — `Cannot find module './paperExecutor.js'`

- [ ] **Step 3: Implement `src/executor/paperExecutor.ts`**

```ts
import type { Executor, Fill, Order } from '../types.js';

export class PaperExecutor implements Executor {
  async execute(order: Order): Promise<Fill> {
    return {
      poolAddress: order.poolAddress,
      side: order.side,
      sizeUsd: order.sizeUsd,
      filledPriceUsd: order.priceUsd,
      filledAt: new Date(),
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/executor/paperExecutor.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/executor/paperExecutor.ts src/executor/paperExecutor.test.ts
git commit -m "feat: paper executor (simulated fills)"
```

---

## Task 10: Position Manager

**Files:**
- Create: `src/positionManager.ts`
- Test: `src/positionManager.test.ts`

**Interfaces:**
- Consumes: `PositionRepository` (Task 8), `Executor` (Task 1/9).
- Produces: `PriceLookup` type (`(poolAddress: string) => Promise<number | null>`), `reviewOpenPositions(positionRepo: PositionRepository, priceLookup: PriceLookup, executor: Executor, now?: Date): Promise<number>` (returns count of positions closed this call). Used by Task 11 (Pipeline).

- [ ] **Step 1: Write the failing tests**

```ts
// src/positionManager.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from './store/db.js';
import { PositionRepository } from './store/positionRepository.js';
import { reviewOpenPositions } from './positionManager.js';
import type { Executor, Fill, Order } from './types.js';

let db: Database.Database;
let repo: PositionRepository;
let executor: Executor;
let executeMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  db = createDb(':memory:');
  repo = new PositionRepository(db);
  executeMock = vi.fn().mockImplementation(
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

function openTestPosition() {
  return repo.openPosition({
    poolAddress: 'POOL1',
    baseTokenSymbol: 'FOO',
    entryPriceUsd: 1,
    sizeUsd: 10,
    stopLossPrice: 0.8,
    takeProfitPrice: 1.5,
    trailingStopPct: 15,
    openedAt: new Date(),
  });
}

describe('reviewOpenPositions', () => {
  it('closes a position that reached take-profit', async () => {
    openTestPosition();
    const closedCount = await reviewOpenPositions(repo, async () => 1.6, executor);

    expect(closedCount).toBe(1);
    expect(repo.getOpenPositions()).toHaveLength(0);
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ poolAddress: 'POOL1', side: 'SELL' })
    );
  });

  it('closes a position that hit stop-loss', async () => {
    openTestPosition();
    const closedCount = await reviewOpenPositions(repo, async () => 0.7, executor);

    expect(closedCount).toBe(1);
    expect(repo.getOpenPositions()[0]).toBeUndefined();
  });

  it('leaves a position open when price is between stop-loss and take-profit', async () => {
    openTestPosition();
    const closedCount = await reviewOpenPositions(repo, async () => 1.1, executor);

    expect(closedCount).toBe(0);
    expect(repo.getOpenPositions()).toHaveLength(1);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('closes on trailing stop after the price rose then pulled back 15% from its peak', async () => {
    const position = openTestPosition();
    // Price rises to 1.3 first (peak), then pulls back to 1.3 * 0.85 = 1.105 or below.
    await reviewOpenPositions(repo, async () => 1.3, executor);
    expect(repo.getById(position.id)!.highestPriceUsd).toBe(1.3);

    const closedCount = await reviewOpenPositions(repo, async () => 1.1, executor);

    expect(closedCount).toBe(1);
    expect(repo.getById(position.id)!.closeReason).toBe('TRAILING_STOP');
  });

  it('skips a position when the price lookup returns null', async () => {
    openTestPosition();
    const closedCount = await reviewOpenPositions(repo, async () => null, executor);

    expect(closedCount).toBe(0);
    expect(repo.getOpenPositions()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/positionManager.test.ts`
Expected: FAIL — `Cannot find module './positionManager.js'`

- [ ] **Step 3: Implement `src/positionManager.ts`**

```ts
import type { Executor } from './types.js';
import type { PositionRepository } from './store/positionRepository.js';

export type PriceLookup = (poolAddress: string) => Promise<number | null>;

export async function reviewOpenPositions(
  positionRepo: PositionRepository,
  priceLookup: PriceLookup,
  executor: Executor,
  now: Date = new Date()
): Promise<number> {
  const openPositions = positionRepo.getOpenPositions();
  let closedCount = 0;

  for (const position of openPositions) {
    const currentPrice = await priceLookup(position.poolAddress);
    if (currentPrice === null) continue;

    if (currentPrice > position.highestPriceUsd) {
      positionRepo.updateHighestPrice(position.id, currentPrice);
    }
    const highestPrice = Math.max(currentPrice, position.highestPriceUsd);

    let closeReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | null = null;
    if (currentPrice >= position.takeProfitPrice) {
      closeReason = 'TAKE_PROFIT';
    } else if (currentPrice <= position.stopLossPrice) {
      closeReason = 'STOP_LOSS';
    } else if (
      highestPrice > position.entryPriceUsd &&
      currentPrice <= highestPrice * (1 - position.trailingStopPct / 100)
    ) {
      closeReason = 'TRAILING_STOP';
    }

    if (closeReason) {
      await executor.execute({
        poolAddress: position.poolAddress,
        baseTokenSymbol: position.baseTokenSymbol,
        side: 'SELL',
        sizeUsd: position.sizeUsd,
        priceUsd: currentPrice,
      });
      positionRepo.closePosition(position.id, currentPrice, closeReason, now);
      closedCount += 1;
    }
  }

  return closedCount;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/positionManager.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/positionManager.ts src/positionManager.test.ts
git commit -m "feat: position manager (TP/SL/trailing-stop re-evaluation)"
```

---

## Task 11: Pipeline orchestration

**Files:**
- Create: `src/pipeline.ts`
- Test: `src/pipeline.test.ts`

**Interfaces:**
- Consumes: `scanPools` (Task 3), `filterPools` (Task 4), `generateSignal` (Task 6), `evaluateRisk` (Task 7), `PositionRepository`/`DecisionLogRepository` (Task 8), `reviewOpenPositions` (Task 10), `GeckoTerminalClient`, `Executor`, `BotConfig` (Task 1/2).
- Produces: `CycleSummary` type (`{ poolsScanned: number; poolsPassedFilter: number; buySignals: number; positionsOpened: number; positionsClosed: number }`), `PipelineDeps` type, `runCycle(deps: PipelineDeps): Promise<CycleSummary>`. Used by Task 12 (main).

- [ ] **Step 1: Write the failing test**

```ts
// src/pipeline.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from './store/db.js';
import { PositionRepository } from './store/positionRepository.js';
import { DecisionLogRepository } from './store/decisionLogRepository.js';
import { runCycle } from './pipeline.js';
import type { GeckoTerminalClient } from './geckoterminal/client.js';
import type { BotConfig } from './config.js';
import type { Candle, Executor, Fill, Order, Pool } from './types.js';

const config = {
  network: 'solana',
  filters: { minLiquidityUsd: 1000, minPoolAgeMinutes: 60 },
  indicators: {
    rsiPeriod: 2,
    rsiOversold: 50,
    smaPeriod: 2,
    momentumLookbackCandles: 1,
    momentumMinPct: 0,
  },
  risk: {
    simulatedCapitalUsd: 1000,
    maxPositionPct: 10,
    maxOpenPositions: 5,
    stopLossPct: 50,
    takeProfitPct: 10,
    trailingStopPct: 50,
  },
  geckoTerminal: { baseUrl: 'x', timeframe: 'hour', ohlcvLimit: 100 },
} as BotConfig;

const pool: Pool = {
  poolAddress: 'POOL1',
  baseTokenSymbol: 'FOO',
  baseTokenAddress: 'TOKEN1',
  priceUsd: 0.9,
  liquidityUsd: 50000,
  volume24hUsd: 10000,
  priceChange24hPct: 5,
  poolCreatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24h old
};

function candle(close: number, offsetMs: number): Candle {
  return { timestamp: new Date(offsetMs), open: close, high: close, low: close, close, volume: 100 };
}

// closes: 1.0, 0.9, 0.8, 0.9 -> RSI(2)=50, SMA(2)=0.85, momentum(1)=+12.5% -> BUY, entry 0.9
const buyCandles = [candle(1.0, 0), candle(0.9, 1), candle(0.8, 2), candle(0.9, 3)];

let db: Database.Database;
let positionRepo: PositionRepository;
let decisionLog: DecisionLogRepository;
let executor: Executor;
let executeMock: ReturnType<typeof vi.fn>;
let client: GeckoTerminalClient;

beforeEach(() => {
  db = createDb(':memory:');
  positionRepo = new PositionRepository(db);
  decisionLog = new DecisionLogRepository(db);
  executeMock = vi.fn().mockImplementation(
    async (order: Order): Promise<Fill> => ({
      poolAddress: order.poolAddress,
      side: order.side,
      sizeUsd: order.sizeUsd,
      filledPriceUsd: order.priceUsd,
      filledAt: new Date(),
    })
  );
  executor = { execute: executeMock };
  client = {
    fetchTrendingPools: vi.fn().mockResolvedValue([pool]),
    fetchOhlcv: vi.fn().mockResolvedValue(buyCandles),
    // Price stays between stop-loss (0.45) and take-profit (0.99): position stays open.
    fetchPoolPrice: vi.fn().mockResolvedValue(0.5),
  };
});

describe('runCycle', () => {
  it('scans, filters, signals, opens a position, and leaves it open', async () => {
    const summary = await runCycle({ client, positionRepo, decisionLog, executor, config });

    expect(summary).toEqual({
      poolsScanned: 1,
      poolsPassedFilter: 1,
      buySignals: 1,
      positionsOpened: 1,
      positionsClosed: 0,
    });
    expect(positionRepo.getOpenPositions()).toHaveLength(1);
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ poolAddress: 'POOL1', side: 'BUY', sizeUsd: 100 })
    );
    expect(decisionLog.getRecent(10).length).toBeGreaterThan(0);
  });

  it('rejects a pool that fails the filter without calling the client for OHLCV', async () => {
    client.fetchTrendingPools = vi.fn().mockResolvedValue([{ ...pool, liquidityUsd: 10 }]);

    const summary = await runCycle({ client, positionRepo, decisionLog, executor, config });

    expect(summary.poolsPassedFilter).toBe(0);
    expect(summary.buySignals).toBe(0);
    expect(client.fetchOhlcv).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pipeline.test.ts`
Expected: FAIL — `Cannot find module './pipeline.js'`

- [ ] **Step 3: Implement `src/pipeline.ts`**

```ts
import type { BotConfig } from './config.js';
import type { GeckoTerminalClient } from './geckoterminal/client.js';
import type { PositionRepository } from './store/positionRepository.js';
import type { DecisionLogRepository } from './store/decisionLogRepository.js';
import type { Executor } from './types.js';
import { scanPools } from './scanner.js';
import { filterPools } from './filter.js';
import { generateSignal } from './signal.js';
import { evaluateRisk } from './risk.js';
import { reviewOpenPositions } from './positionManager.js';

export interface PipelineDeps {
  client: GeckoTerminalClient;
  positionRepo: PositionRepository;
  decisionLog: DecisionLogRepository;
  executor: Executor;
  config: BotConfig;
}

export interface CycleSummary {
  poolsScanned: number;
  poolsPassedFilter: number;
  buySignals: number;
  positionsOpened: number;
  positionsClosed: number;
}

export async function runCycle(deps: PipelineDeps): Promise<CycleSummary> {
  const { client, positionRepo, decisionLog, executor, config } = deps;
  const now = new Date();

  const pools = await scanPools(client, config);
  const filterResults = filterPools(pools, config, now);

  let poolsPassedFilter = 0;
  let buySignals = 0;
  let positionsOpened = 0;

  for (const result of filterResults) {
    if (!result.passed) {
      decisionLog.log({
        timestamp: now,
        poolAddress: result.pool.poolAddress,
        stage: 'FILTER',
        decision: 'REJECTED',
        reason: result.reason,
      });
      continue;
    }
    poolsPassedFilter += 1;

    const signal = await generateSignal(client, result.pool, config);
    decisionLog.log({
      timestamp: now,
      poolAddress: result.pool.poolAddress,
      stage: 'SIGNAL',
      decision: signal.decision,
      reason: signal.reason,
    });

    if (signal.decision !== 'BUY') continue;
    buySignals += 1;

    const openCount = positionRepo.getOpenPositions().length;
    const risk = evaluateRisk(signal, openCount, config.risk.simulatedCapitalUsd, config);
    decisionLog.log({
      timestamp: now,
      poolAddress: result.pool.poolAddress,
      stage: 'RISK',
      decision: risk.approved ? 'APPROVED' : 'REJECTED',
      reason: risk.reason,
    });

    if (!risk.approved || !risk.positionSizeUsd || !risk.stopLossPrice || !risk.takeProfitPrice) continue;

    await executor.execute({
      poolAddress: result.pool.poolAddress,
      baseTokenSymbol: result.pool.baseTokenSymbol,
      side: 'BUY',
      sizeUsd: risk.positionSizeUsd,
      priceUsd: result.pool.priceUsd,
    });

    positionRepo.openPosition({
      poolAddress: result.pool.poolAddress,
      baseTokenSymbol: result.pool.baseTokenSymbol,
      entryPriceUsd: result.pool.priceUsd,
      sizeUsd: risk.positionSizeUsd,
      stopLossPrice: risk.stopLossPrice,
      takeProfitPrice: risk.takeProfitPrice,
      trailingStopPct: risk.trailingStopPct ?? config.risk.trailingStopPct,
      openedAt: now,
    });
    positionsOpened += 1;
  }

  const positionsClosed = await reviewOpenPositions(
    positionRepo,
    (poolAddress) => client.fetchPoolPrice(config.network, poolAddress),
    executor,
    now
  );

  return { poolsScanned: pools.length, poolsPassedFilter, buySignals, positionsOpened, positionsClosed };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/pipeline.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/pipeline.ts src/pipeline.test.ts
git commit -m "feat: pipeline orchestration (scan -> filter -> signal -> risk -> execute -> review)"
```

---

## Task 12: Main entry point (live paper-trading loop)

**Files:**
- Create: `src/main.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 1), `createGeckoTerminalClient` (Task 2), `createDb`, `PositionRepository`, `DecisionLogRepository` (Task 8), `PaperExecutor` (Task 9), `runCycle` (Task 11).
- Produces: the `npm start` entry point. Nothing downstream depends on this file — it is verified manually, not with an automated test (it runs an infinite loop against the real network).

- [ ] **Step 1: Implement `src/main.ts`**

```ts
import { loadConfig } from './config.js';
import { createGeckoTerminalClient } from './geckoterminal/client.js';
import { createDb } from './store/db.js';
import { PositionRepository } from './store/positionRepository.js';
import { DecisionLogRepository } from './store/decisionLogRepository.js';
import { PaperExecutor } from './executor/paperExecutor.js';
import { runCycle } from './pipeline.js';

let stopRequested = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const config = loadConfig('config/config.json');
  const client = createGeckoTerminalClient(config.geckoTerminal.baseUrl);
  const db = createDb('data/bot.sqlite');
  const positionRepo = new PositionRepository(db);
  const decisionLog = new DecisionLogRepository(db);
  const executor = new PaperExecutor();

  process.on('SIGINT', () => {
    console.log('\nArrêt demandé, fin du cycle en cours...');
    stopRequested = true;
  });

  console.log(
    `Bot démarré (paper trading). Intervalle : ${config.scanIntervalSeconds}s. Ctrl+C pour arrêter proprement.`
  );

  while (!stopRequested) {
    const cycleStart = Date.now();
    try {
      const summary = await runCycle({ client, positionRepo, decisionLog, executor, config });
      console.log(
        `Cycle terminé : ${summary.poolsScanned} pools scannés, ${summary.poolsPassedFilter} retenus après filtre, ` +
          `${summary.buySignals} signaux BUY, ${summary.positionsOpened} position(s) ouverte(s), ` +
          `${summary.positionsClosed} position(s) clôturée(s).`
      );
    } catch (error) {
      console.error('Erreur pendant le cycle :', error);
    }
    const elapsedMs = Date.now() - cycleStart;
    const remainingMs = config.scanIntervalSeconds * 1000 - elapsedMs;
    if (remainingMs > 0 && !stopRequested) {
      await sleep(remainingMs);
    }
  }

  db.close();
  console.log('Bot arrêté proprement.');
}

main().catch((error) => {
  console.error('Erreur fatale :', error);
  process.exit(1);
});
```

- [ ] **Step 2: Manual verification**

Run: `npm start`

Expected: the console prints the startup message, then after `scanIntervalSeconds` (60s by default — you can temporarily lower `scanIntervalSeconds` in `config/config.json` to a small value like `5` for a quicker manual check, then set it back) it prints a "Cycle terminé" line with real counts from the live GeckoTerminal API. Press `Ctrl+C`: the process prints "Arrêt demandé..." then "Bot arrêté proprement." and exits — it does not hang or need to be killed forcefully. Confirm `data/bot.sqlite` now exists on disk.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: main entry point (live paper-trading loop with graceful shutdown)"
```

---

## Task 13: Backtest engine and CLI runner

**Files:**
- Create: `src/backtest.ts`
- Create: `src/backtestRunner.ts`
- Test: `src/backtest.test.ts`

**Interfaces:**
- Consumes: `evaluateSignal` (Task 6), `evaluateRisk` (Task 7), `Pool`, `Candle`, `BotConfig` (Task 1), `createGeckoTerminalClient` (Task 2) — the last one only in `backtestRunner.ts`.
- Produces: `BacktestTrade`, `BacktestReport` types, `runBacktest(pool: Pool, candles: Candle[], config: BotConfig): BacktestReport`. `backtestRunner.ts` is the `npm run backtest` CLI entry point — verified manually.

- [ ] **Step 1: Write the failing test**

```ts
// src/backtest.test.ts
import { describe, expect, it } from 'vitest';
import { runBacktest } from './backtest.js';
import type { BotConfig } from './config.js';
import type { Candle, Pool } from './types.js';

const config = {
  network: 'solana',
  indicators: {
    rsiPeriod: 2,
    rsiOversold: 50,
    smaPeriod: 2,
    momentumLookbackCandles: 1,
    momentumMinPct: 0,
  },
  risk: {
    simulatedCapitalUsd: 1000,
    maxPositionPct: 10,
    maxOpenPositions: 5,
    stopLossPct: 50,
    takeProfitPct: 10,
    trailingStopPct: 50,
  },
} as BotConfig;

const pool: Pool = {
  poolAddress: 'POOL1',
  baseTokenSymbol: 'FOO',
  baseTokenAddress: 'TOKEN1',
  priceUsd: 1,
  liquidityUsd: 50000,
  volume24hUsd: 10000,
  priceChange24hPct: 5,
  poolCreatedAt: new Date(),
};

function candle(open: number, high: number, low: number, close: number, offsetMs: number): Candle {
  return { timestamp: new Date(offsetMs), open, high, low, close, volume: 100 };
}

describe('runBacktest', () => {
  it('opens exactly one trade on the BUY signal and closes it at take-profit', () => {
    // Index 0-3: warm-up candles (RSI/SMA period 2 -> minCandles = 3, first evaluation at index 3).
    // closes at index 0-3: 1.0, 0.9, 0.8, 0.9 -> RSI(2)=50, SMA(2)=0.85, momentum(1)=+12.5% -> BUY, entry 0.9
    // Index 4: high 1.6 hits take-profit price (0.9 * 1.10 = 0.99) -> exit at 0.99
    // Index 5: closes[0..5] recompute to a non-BUY signal (RSI no longer oversold) -> no second trade
    const candles = [
      candle(1.0, 1.0, 1.0, 1.0, 0),
      candle(1.0, 1.0, 0.9, 0.9, 1),
      candle(0.9, 0.9, 0.8, 0.8, 2),
      candle(0.8, 0.9, 0.8, 0.9, 3),
      candle(0.9, 1.6, 0.9, 1.5, 4),
      candle(1.5, 1.5, 1.4, 1.4, 5),
    ];

    const report = runBacktest(pool, candles, config);

    expect(report.totalTrades).toBe(1);
    expect(report.wins).toBe(1);
    expect(report.losses).toBe(0);
    expect(report.winRatePct).toBe(100);
    const [trade] = report.trades;
    expect(trade.entryPriceUsd).toBeCloseTo(0.9, 5);
    expect(trade.exitPriceUsd).toBeCloseTo(0.99, 5);
    expect(trade.exitReason).toBe('TAKE_PROFIT');
    expect(trade.pnlUsd).toBeCloseTo(10, 1); // 10% of the 100$ position (10% of 1000$ capital)
  });

  it('returns an empty report when no candle ever triggers a BUY', () => {
    const flatCandles = Array.from({ length: 10 }, (_, i) => candle(1, 1, 1, 1, i));

    const report = runBacktest(pool, flatCandles, config);

    expect(report.totalTrades).toBe(0);
    expect(report.winRatePct).toBe(0);
    expect(report.totalPnlUsd).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/backtest.test.ts`
Expected: FAIL — `Cannot find module './backtest.js'`

- [ ] **Step 3: Implement `src/backtest.ts`**

```ts
import type { BotConfig } from './config.js';
import type { Candle, Pool } from './types.js';
import { evaluateSignal } from './signal.js';
import { evaluateRisk } from './risk.js';

export interface BacktestTrade {
  poolAddress: string;
  entryPriceUsd: number;
  entryAt: Date;
  exitPriceUsd: number;
  exitAt: Date;
  exitReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'END_OF_DATA';
  pnlUsd: number;
  pnlPct: number;
}

export interface BacktestReport {
  trades: BacktestTrade[];
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalPnlUsd: number;
}

/**
 * Simplification: position sizing always uses config.risk.simulatedCapitalUsd
 * (not compounded with prior trade PnL), so results stay simple to reason about.
 */
export function runBacktest(pool: Pool, candles: Candle[], config: BotConfig): BacktestReport {
  const minCandles = Math.max(config.indicators.rsiPeriod, config.indicators.smaPeriod) + 1;
  const trades: BacktestTrade[] = [];

  let i = minCandles;
  while (i < candles.length) {
    const window = candles.slice(0, i + 1);
    const signal = evaluateSignal(pool, window, config);

    if (signal.decision === 'BUY') {
      const risk = evaluateRisk(signal, 0, config.risk.simulatedCapitalUsd, config);
      if (risk.approved && risk.positionSizeUsd && risk.stopLossPrice && risk.takeProfitPrice) {
        const entryCandle = candles[i];
        const trailingPct = risk.trailingStopPct ?? config.risk.trailingStopPct;
        let highestPrice = entryCandle.close;
        let exitIndex = candles.length - 1;
        let exitPrice = candles[candles.length - 1].close;
        let exitReason: BacktestTrade['exitReason'] = 'END_OF_DATA';

        for (let j = i + 1; j < candles.length; j++) {
          const candle = candles[j];
          if (candle.high > highestPrice) highestPrice = candle.high;

          if (candle.high >= risk.takeProfitPrice) {
            exitIndex = j;
            exitPrice = risk.takeProfitPrice;
            exitReason = 'TAKE_PROFIT';
            break;
          }
          if (candle.low <= risk.stopLossPrice) {
            exitIndex = j;
            exitPrice = risk.stopLossPrice;
            exitReason = 'STOP_LOSS';
            break;
          }
          const trailingStopPrice = highestPrice * (1 - trailingPct / 100);
          if (highestPrice > entryCandle.close && candle.low <= trailingStopPrice) {
            exitIndex = j;
            exitPrice = trailingStopPrice;
            exitReason = 'TRAILING_STOP';
            break;
          }
        }

        const exitCandle = candles[exitIndex];
        const pnlPct = ((exitPrice - entryCandle.close) / entryCandle.close) * 100;
        const pnlUsd = (pnlPct / 100) * risk.positionSizeUsd;

        trades.push({
          poolAddress: pool.poolAddress,
          entryPriceUsd: entryCandle.close,
          entryAt: entryCandle.timestamp,
          exitPriceUsd: exitPrice,
          exitAt: exitCandle.timestamp,
          exitReason,
          pnlUsd,
          pnlPct,
        });

        i = exitIndex + 1;
        continue;
      }
    }
    i += 1;
  }

  const wins = trades.filter((t) => t.pnlUsd > 0).length;
  const losses = trades.length - wins;
  const totalPnlUsd = trades.reduce((sum, t) => sum + t.pnlUsd, 0);

  return {
    trades,
    totalTrades: trades.length,
    wins,
    losses,
    winRatePct: trades.length > 0 ? (wins / trades.length) * 100 : 0,
    totalPnlUsd,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/backtest.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Implement `src/backtestRunner.ts` (CLI entry point, no automated test)**

```ts
import { loadConfig } from './config.js';
import { createGeckoTerminalClient } from './geckoterminal/client.js';
import { runBacktest } from './backtest.js';

async function main() {
  const config = loadConfig('config/config.json');
  const client = createGeckoTerminalClient(config.geckoTerminal.baseUrl);
  const poolAddress = process.argv[2];

  if (!poolAddress) {
    console.error('Usage : npm run backtest -- <poolAddress>');
    console.error('Trouvez une poolAddress sur https://www.geckoterminal.com/solana ou https://dexscreener.com/solana');
    process.exit(1);
  }

  const pools = await client.fetchTrendingPools(config.network);
  const pool = pools.find((p) => p.poolAddress === poolAddress);
  if (!pool) {
    console.error(`Pool ${poolAddress} introuvable parmi les pools trending actuels.`);
    process.exit(1);
  }

  const candles = await client.fetchOhlcv(
    config.network,
    poolAddress,
    config.geckoTerminal.timeframe,
    Math.max(config.geckoTerminal.ohlcvLimit, 500)
  );

  const report = runBacktest(pool, candles, config);

  console.log(`\nRésultats du backtest pour ${pool.baseTokenSymbol} (${poolAddress})`);
  console.log(`Nombre de trades : ${report.totalTrades}`);
  console.log(`Gagnants / Perdants : ${report.wins} / ${report.losses}`);
  console.log(`Taux de réussite : ${report.winRatePct.toFixed(1)}%`);
  console.log(`PnL total simulé : ${report.totalPnlUsd.toFixed(2)}$`);
  for (const trade of report.trades) {
    console.log(
      `  ${trade.entryAt.toISOString()} -> ${trade.exitAt.toISOString()} | ${trade.exitReason} | ` +
        `PnL: ${trade.pnlUsd.toFixed(2)}$ (${trade.pnlPct.toFixed(1)}%)`
    );
  }
}

main().catch((error) => {
  console.error('Erreur lors du backtest :', error);
  process.exit(1);
});
```

- [ ] **Step 6: Manual verification**

Pick a real Solana pool address (from `https://www.geckoterminal.com/solana` or `https://dexscreener.com/solana` — use the pool/pair address, not the token address) and run:

`npm run backtest -- <poolAddress>`

Expected: a report is printed with a trade count, win/loss counts, win rate, and total simulated PnL. If the pool is very new and has few OHLCV candles, `totalTrades` may legitimately be `0` — that's correct behavior, not a bug.

- [ ] **Step 7: Commit**

```bash
git add src/backtest.ts src/backtest.test.ts src/backtestRunner.ts
git commit -m "feat: backtest engine and CLI runner"
```

---

## Final verification

- [ ] Run the full test suite: `npm test` — expect all tests across every task to pass (~35 tests).
- [ ] Run `npm run typecheck` — expect no TypeScript errors.
- [ ] Do the Task 12 and Task 13 manual verifications above.
