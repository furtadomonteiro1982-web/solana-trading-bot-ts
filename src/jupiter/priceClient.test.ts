import { describe, expect, it, vi } from 'vitest';
import { createJupiterPriceClient } from './priceClient.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body };
}

describe('JupiterPriceClient', () => {
  it('fetches prices for multiple addresses in a single batched request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ADDR1: { usdPrice: 0.5 },
        ADDR2: { usdPrice: 1.25 },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createJupiterPriceClient('https://lite-api.jup.ag');

    const prices = await client.fetchPrices(['ADDR1', 'ADDR2']);

    expect(prices.get('ADDR1')).toBe(0.5);
    expect(prices.get('ADDR2')).toBe(1.25);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://lite-api.jup.ag/price/v3?ids=ADDR1,ADDR2');
  });

  it('maps a missing address in the response to null instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ADDR1: { usdPrice: 0.5 } })));
    const client = createJupiterPriceClient('https://lite-api.jup.ag');

    const prices = await client.fetchPrices(['ADDR1', 'ADDR_INCONNUE']);

    expect(prices.get('ADDR1')).toBe(0.5);
    expect(prices.get('ADDR_INCONNUE')).toBeNull();
  });

  it('returns an empty map without calling the API when given no addresses', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = createJupiterPriceClient('https://lite-api.jup.ag');

    const prices = await client.fetchPrices([]);

    expect(prices.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps every requested address to null instead of throwing when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)));
    const client = createJupiterPriceClient('https://lite-api.jup.ag');

    const prices = await client.fetchPrices(['ADDR1', 'ADDR2']);

    expect(prices.get('ADDR1')).toBeNull();
    expect(prices.get('ADDR2')).toBeNull();
  });
});
