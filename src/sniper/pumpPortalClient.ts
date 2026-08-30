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
      // onclose fires right after a real network error: reconnection is already
      // handled there, no need to duplicate it here.
    };
  }

  async function handleMessage(raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // malformed message, ignored
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
      return; // not a complete token-creation event, ignored
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
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Erreur dans un listener pumpPortalClient :', error);
      }
    }
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
    // Metadata unreachable: treated as "no social link" -- the filter decides based on
    // requireSocialLink, rather than crashing the whole stream over one token.
    return false;
  }
}
