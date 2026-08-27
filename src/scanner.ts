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
