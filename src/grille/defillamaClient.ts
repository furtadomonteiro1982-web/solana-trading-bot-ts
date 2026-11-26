import { defaultFetch, getJson, type FetchLike } from './http.js';

// API publique de DefiLlama : gratuite, sans clé.
export const DEFILLAMA_BASE_URL = 'https://api.llama.fi';

export interface LlamaProtocol {
  id: string;
  name: string;
  slug: string;
  symbol?: string | null;
  category?: string | null;
  chains?: string[];
  tvl?: number | null;
  gecko_id?: string | null;
  parentProtocol?: string | null;
  audits?: string | null;
}

export interface LlamaParent {
  id: string;
  name: string;
  symbol?: string | null;
  gecko_id?: string | null;
}

export interface LlamaFeeEntry {
  defillamaId?: string | null;
  parentProtocol?: string | null;
  total1y?: number | null;
}

export interface LlamaHack {
  /** Secondes depuis 1970. */
  date: number;
  amount?: number | null;
  defillamaId?: string | null;
}

export class DefiLlamaClient {
  constructor(
    private baseUrl = DEFILLAMA_BASE_URL,
    private fetchFn: FetchLike = defaultFetch()
  ) {}

  async fetchProtocols(): Promise<LlamaProtocol[]> {
    return (await this.get('/protocols')) as LlamaProtocol[];
  }

  /** Projets « parents » (Aave, Uniswap…) qui regroupent leurs versions. */
  async fetchParents(): Promise<LlamaParent[]> {
    const json = (await this.get('/lite/protocols2')) as { parentProtocols?: LlamaParent[] };
    return json.parentProtocols ?? [];
  }

  /** Frais (`dailyFees`) ou revenus (`dailyRevenue`) par protocole, dont le total sur 1 an. */
  async fetchFees(dataType: 'dailyFees' | 'dailyRevenue'): Promise<LlamaFeeEntry[]> {
    const json = (await this.get(
      `/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=${dataType}`
    )) as { protocols?: LlamaFeeEntry[] };
    return json.protocols ?? [];
  }

  async fetchHacks(): Promise<LlamaHack[]> {
    return (await this.get('/hacks')) as LlamaHack[];
  }

  /** Évolution de la TVL totale de la DeFi sur `days` jours, en %, ou null sans historique. */
  async fetchDefiTvlChangePct(days: number): Promise<number | null> {
    const points = (await this.get('/v2/historicalChainTvl')) as { date: number; tvl: number }[];
    if (!Array.isArray(points) || points.length === 0) return null;
    const before = tvlDaysAgo(
      points.map((point) => ({ date: point.date, totalLiquidityUSD: point.tvl })),
      days
    );
    const last = points[points.length - 1]!.tvl;
    return before && before > 0 ? (last / before - 1) * 100 : null;
  }

  /** TVL du projet `daysAgo` jours avant le dernier point connu, ou null sans historique. */
  async fetchTvlDaysAgo(slug: string, daysAgo: number): Promise<number | null> {
    const json = (await this.get(`/protocol/${encodeURIComponent(slug)}`)) as {
      tvl?: { date: number; totalLiquidityUSD: number }[];
    };
    return tvlDaysAgo(json.tvl ?? [], daysAgo);
  }

  private get(path: string): Promise<unknown> {
    return getJson(`${this.baseUrl}${path}`, this.fetchFn, 'DefiLlama');
  }
}

export function tvlDaysAgo(points: { date: number; totalLiquidityUSD: number }[], daysAgo: number): number | null {
  if (points.length === 0) return null;
  const target = points[points.length - 1]!.date - daysAgo * 86_400;
  if (points[0]!.date > target) return null; // historique plus court que demandé
  let best = points[0]!;
  for (const point of points) {
    if (point.date <= target) best = point;
    else break;
  }
  return best.totalLiquidityUSD;
}
