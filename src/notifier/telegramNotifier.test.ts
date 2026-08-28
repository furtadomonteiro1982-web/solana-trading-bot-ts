import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramNotifier } from './telegramNotifier.js';

describe('TelegramNotifier', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the message to the Telegram sendMessage endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const notifier = new TelegramNotifier('BOT_TOKEN', 'CHAT_ID');

    await notifier.notify('Position ouverte : FOO');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/botBOT_TOKEN/sendMessage',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ chat_id: 'CHAT_ID', text: 'Position ouverte : FOO' }),
      })
    );
  });

  it('does not throw when Telegram responds with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const notifier = new TelegramNotifier('BAD_TOKEN', 'CHAT_ID');

    await expect(notifier.notify('test')).resolves.toBeUndefined();
  });

  it('does not throw when the network request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const notifier = new TelegramNotifier('BOT_TOKEN', 'CHAT_ID');

    await expect(notifier.notify('test')).resolves.toBeUndefined();
  });
});
