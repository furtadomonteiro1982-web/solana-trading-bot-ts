import type Database from 'better-sqlite3';

export class FirstSeenRepository {
  constructor(private db: Database.Database) {}

  /**
   * Renvoie la date de première détection connue de ce pool, en retenant toujours la plus
   * ancienne des dates candidates vues au fil des cycles (jamais la plus récente).
   *
   * Approximation assumée : le client de secours (Birdeye) ne connaît pas la vraie date de
   * création on-chain et passe "maintenant" comme candidat ; le client principal (GeckoTerminal)
   * passe la vraie date. En ne retenant que le minimum, une date réelle plus ancienne obtenue plus
   * tard prend le relais définitivement sur un placeholder "maintenant" enregistré plus tôt — mais
   * une date plus récente ne peut jamais rajeunir un pool déjà connu comme plus vieux. Résultat :
   * `minPoolAgeMinutes` ne peut que sous-estimer l'âge réel, jamais le surestimer.
   */
  getOrRecordFirstSeen(poolAddress: string, candidate: Date): Date {
    const existing = this.db
      .prepare('SELECT first_seen_at FROM first_seen WHERE pool_address = ?')
      .get(poolAddress) as { first_seen_at: string } | undefined;

    if (!existing) {
      this.db
        .prepare('INSERT INTO first_seen (pool_address, first_seen_at) VALUES (?, ?)')
        .run(poolAddress, candidate.toISOString());
      return candidate;
    }

    const existingDate = new Date(existing.first_seen_at);
    if (candidate.getTime() < existingDate.getTime()) {
      this.db
        .prepare('UPDATE first_seen SET first_seen_at = ? WHERE pool_address = ?')
        .run(candidate.toISOString(), poolAddress);
      return candidate;
    }
    return existingDate;
  }
}
