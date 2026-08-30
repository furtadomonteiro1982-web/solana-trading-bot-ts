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
