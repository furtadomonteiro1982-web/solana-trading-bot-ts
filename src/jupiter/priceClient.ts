export interface PriceClient {
  /** Un seul appel HTTP batché pour toutes les adresses demandées (gratuit, sans clé API). */
  fetchPrices(addresses: string[]): Promise<Map<string, number | null>>;
}

class JupiterPriceClient implements PriceClient {
  constructor(private baseUrl: string) {}

  async fetchPrices(addresses: string[]): Promise<Map<string, number | null>> {
    if (addresses.length === 0) return new Map();

    const result = new Map<string, number | null>(addresses.map((address) => [address, null]));
    try {
      const url = `${this.baseUrl}/price/v3?ids=${addresses.join(',')}`;
      const response = await fetch(url);
      if (!response.ok) {
        // Une seule requête ratée pour toutes les positions : on renvoie null partout plutôt que
        // de faire planter la revue des positions ouvertes (elle sera simplement ignorée ce cycle).
        return result;
      }
      const json = (await response.json()) as Record<string, { usdPrice: number } | undefined>;
      for (const address of addresses) {
        const entry = json[address];
        result.set(address, entry ? entry.usdPrice : null);
      }
      return result;
    } catch {
      return result;
    }
  }
}

export function createJupiterPriceClient(baseUrl: string): PriceClient {
  return new JupiterPriceClient(baseUrl);
}
