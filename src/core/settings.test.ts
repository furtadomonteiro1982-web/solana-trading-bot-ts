import { describe, expect, it } from 'vitest';
import { BotConfigSchema } from '../config.js';
import { coreBacktestConfig, reservePct } from './settings.js';

const config = BotConfigSchema.parse(JSON.parse(await (await import('node:fs/promises')).readFile('config/config.json', 'utf-8')));

describe('coreBacktestConfig', () => {
  it('sans les projets, garde 20 % en USDC', () => {
    const core = coreBacktestConfig(config, { withProjects: false });

    expect(core.targets).toEqual({ BTC: 50, ETH: 15, SOL: 10, BNB: 5 });
    expect(reservePct(core)).toBe(20);
  });

  it('avec les projets de la grille, investit les 100 %', () => {
    const core = coreBacktestConfig(config, { withProjects: true });

    expect(core.targets).toEqual({ BTC: 50, ETH: 15, SOL: 10, BNB: 5, LDO: 5, CAKE: 5, SYRUP: 5, CVX: 5 });
    expect(reservePct(core)).toBe(0);
  });

  it('refuse un actif présent dans les deux listes', () => {
    const both = { ...config, core: { ...config.core, projectTargets: { BTC: 5 } } };

    expect(() => coreBacktestConfig(both, { withProjects: true })).toThrow(/à la fois/);
  });
});
