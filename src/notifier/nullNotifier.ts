import type { Notifier } from './notifier.js';

/** Utilisé quand Telegram n'est pas configuré : le bot fonctionne normalement, sans notifier personne. */
export class NullNotifier implements Notifier {
  async notify(_message: string): Promise<void> {}
}
