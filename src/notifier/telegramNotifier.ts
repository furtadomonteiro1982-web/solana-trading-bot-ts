import type { Notifier } from './notifier.js';

export class TelegramNotifier implements Notifier {
  constructor(
    private botToken: string,
    private chatId: string
  ) {}

  async notify(message: string): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text: message }),
      });
      if (!response.ok) {
        console.warn(
          `Avertissement : échec de l'envoi de la notification Telegram (statut ${response.status})`
        );
      }
    } catch (error) {
      // Une notification ratée ne doit jamais faire planter le bot — on trace et on continue.
      console.warn(`Avertissement : échec de l'envoi de la notification Telegram : ${String(error)}`);
    }
  }
}
