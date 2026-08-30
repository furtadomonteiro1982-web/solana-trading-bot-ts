export interface NewTokenEvent {
  tokenAddress: string;
  symbol: string;
  name: string;
  creatorAddress: string;
  hasSocialLink: boolean;
  creatorInitialBuyPct: number;
}

export interface SnipeFilterConfig {
  requireSocialLink: boolean;
  bannedNamePatterns: string[];
  maxCreatorInitialBuyPct: number;
}

export interface SnipeFilterResult {
  passed: boolean;
  reason: string;
}

export function shouldSnipe(event: NewTokenEvent, config: SnipeFilterConfig): SnipeFilterResult {
  if (config.requireSocialLink && !event.hasSocialLink) {
    return { passed: false, reason: 'Aucun lien social (site/twitter/telegram)' };
  }

  const nameAndSymbol = `${event.name} ${event.symbol}`.toLowerCase();
  const bannedMatch = config.bannedNamePatterns.find((pattern) =>
    nameAndSymbol.includes(pattern.toLowerCase())
  );
  if (bannedMatch) {
    return { passed: false, reason: `Nom/symbole contient un motif banni : "${bannedMatch}"` };
  }

  if (event.creatorInitialBuyPct > config.maxCreatorInitialBuyPct) {
    return {
      passed: false,
      reason: `Achat initial du créateur trop élevé (${event.creatorInitialBuyPct.toFixed(1)}% > ${config.maxCreatorInitialBuyPct}%)`,
    };
  }

  return { passed: true, reason: 'Accepté' };
}
