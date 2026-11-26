import type { BotConfig } from '../config.js';
import type { CoreBacktestConfig } from './types.js';

/**
 * Réglages du moteur du cœur à partir de la config. Avec `withProjects`, les projets retenus par
 * la grille (`core.projectTargets`) s'ajoutent aux quatre majeurs ; sinon leur part reste en USDC.
 */
export function coreBacktestConfig(config: BotConfig, options: { withProjects: boolean }): CoreBacktestConfig {
  const core = config.core;
  const targets = options.withProjects ? { ...core.targets, ...core.projectTargets } : { ...core.targets };
  for (const asset of Object.keys(core.projectTargets)) {
    if (options.withProjects && asset in core.targets) {
      throw new Error(`${asset} est à la fois dans core.targets et core.projectTargets.`);
    }
  }
  return {
    capitalUsd: core.capitalUsd,
    targets,
    dcaWeeks: core.dcaWeeks,
    rebalanceThresholdPts: core.rebalanceThresholdPts,
    feePct: core.feePct,
    slippagePct: core.slippagePct,
  };
}

/** Part du cœur gardée en USDC : ce que les parts cibles ne couvrent pas. */
export function reservePct(config: CoreBacktestConfig): number {
  return Math.max(0, 100 - Object.values(config.targets).reduce((sum, pct) => sum + pct, 0));
}
