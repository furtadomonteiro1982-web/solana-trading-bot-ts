import type { Position, PositionStrategy } from '../types.js';
import type { ReportPeriod } from './period.js';

export interface StrategySummary {
  strategy: PositionStrategy;
  capitalUsd: number;
  /** Gains et pertes réalisés (nets des frais et du slippage simulés), en USD. */
  realizedBeforePeriodUsd: number;
  realizedInPeriodUsd: number;
  closedInPeriod: number;
  winsInPeriod: number;
  /** Positions encore ouvertes à la fin de la période, comptées à leur prix d'achat. */
  openAtEnd: number;
  openAtEndUsd: number;
  /** Valeur : capital + gains réalisés jusqu'à la date. */
  valueAtStartUsd: number;
  valueAtEndUsd: number;
}

/**
 * Résume une stratégie du satellite sur la période. Les positions encore ouvertes sont comptées à
 * leur prix d'achat : leur gain ou leur perte n'entre dans le compte qu'à leur fermeture.
 */
export function summarizeStrategy(
  positions: Position[],
  strategy: PositionStrategy,
  capitalUsd: number,
  period: ReportPeriod
): StrategySummary {
  const mine = positions.filter((position) => position.strategy === strategy);
  const dayOf = (date: Date) => date.toISOString().slice(0, 10);
  const closed = mine.filter((position) => position.status === 'CLOSED' && position.closedAt);

  const before = closed.filter((position) => dayOf(position.closedAt!) < period.start);
  const during = closed.filter((position) => {
    const day = dayOf(position.closedAt!);
    return day >= period.start && day <= period.end;
  });
  const openAtEnd = mine.filter(
    (position) =>
      dayOf(position.openedAt) <= period.end && (position.status === 'OPEN' || dayOf(position.closedAt!) > period.end)
  );
  const sum = (list: Position[]) => list.reduce((total, position) => total + (position.pnlUsd ?? 0), 0);
  const realizedBeforePeriodUsd = sum(before);
  const realizedInPeriodUsd = sum(during);

  return {
    strategy,
    capitalUsd,
    realizedBeforePeriodUsd,
    realizedInPeriodUsd,
    closedInPeriod: during.length,
    winsInPeriod: during.filter((position) => (position.pnlUsd ?? 0) > 0).length,
    openAtEnd: openAtEnd.length,
    openAtEndUsd: openAtEnd.reduce((total, position) => total + position.sizeUsd, 0),
    valueAtStartUsd: capitalUsd + realizedBeforePeriodUsd,
    valueAtEndUsd: capitalUsd + realizedBeforePeriodUsd + realizedInPeriodUsd,
  };
}
