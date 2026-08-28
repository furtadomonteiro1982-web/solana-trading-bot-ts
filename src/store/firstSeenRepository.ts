import type Database from 'better-sqlite3';

export class FirstSeenRepository {
  constructor(private db: Database.Database) {}

  /**
   * Renvoie la date de première détection connue de ce pool. Si c'est la première fois qu'on le
   * voit, enregistre `now` comme référence et la renvoie telle quelle.
   *
   * Approximation assumée : faute d'accès à la vraie date de création on-chain sur le plan
   * gratuit Birdeye, `minPoolAgeMinutes` mesure en réalité « depuis combien de temps ce bot suit
   * ce token », pas son âge réel. Un token déjà ancien qui apparaît pour la première fois dans le
   * scan sera donc traité comme tout juste créé.
   */
  getOrRecordFirstSeen(poolAddress: string, now: Date): Date {
    const existing = this.db
      .prepare('SELECT first_seen_at FROM first_seen WHERE pool_address = ?')
      .get(poolAddress) as { first_seen_at: string } | undefined;
    if (existing) return new Date(existing.first_seen_at);

    this.db
      .prepare('INSERT INTO first_seen (pool_address, first_seen_at) VALUES (?, ?)')
      .run(poolAddress, now.toISOString());
    return now;
  }
}
