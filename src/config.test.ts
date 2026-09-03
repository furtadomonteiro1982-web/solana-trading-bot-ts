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
  timeframe: 'hour',
  ohlcvLimit: 100,
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
  },
  birdeye: {
    baseUrl: 'https://public-api.birdeye.so',
  },
  jupiter: {
    baseUrl: 'https://lite-api.jup.ag',
  },
};

describe('loadConfig', () => {
  it('loads a valid config file', () => {
    const filePath = writeTempConfig(validConfig);
    const config = loadConfig(filePath);
    expect(config.scanIntervalSeconds).toBe(60);
    expect(config.risk.simulatedCapitalUsd).toBe(100);
    expect(config.ohlcvCacheTtlMs).toBe(600_000); // valeur par défaut, absente de validConfig
  });

  it('throws a clear error when a required field is missing', () => {
    const { risk, ...withoutRisk } = validConfig;
    const filePath = writeTempConfig(withoutRisk);
    expect(() => loadConfig(filePath)).toThrow(/Config invalide/);
  });

  it('throws a French error when the config file does not exist', () => {
    const missingPath = path.join(os.tmpdir(), 'bot-config-inexistant', 'config.json');
    expect(() => loadConfig(missingPath)).toThrow(/Impossible de lire ou parser la config/);
  });

  it('throws a French error when the config file contains malformed JSON', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-config-'));
    const filePath = path.join(dir, 'config.json');
    fs.writeFileSync(filePath, '{ invalid json');

    expect(() => loadConfig(filePath)).toThrow(/Impossible de lire ou parser la config/);
  });

  it('defaults every sniper field when the sniper block is empty', () => {
    const filePath = writeTempConfig({ ...validConfig, sniper: {} });
    const config = loadConfig(filePath);
    expect(config.sniper.enabled).toBe(true);
    expect(config.sniper.pumpPortalWsUrl).toBe('wss://pumpportal.fun/api/data');
    expect(config.sniper.stakeUsd).toBe(2);
    expect(config.sniper.maxOpenSnipes).toBe(5);
    expect(config.sniper.takeProfitPct).toBe(100);
    expect(config.sniper.filters.bannedNamePatterns).toEqual([
      'test',
      'scam',
      'rug',
      'airdrop',
      'giveaway',
      'presale',
      'whitelist',
      '1000x',
    ]);
    expect(config.sniper.filters.minCreatorInitialBuyPct).toBe(1);
    expect(config.sniper.filters.maxCreatorInitialBuyPct).toBe(10);
  });
});
