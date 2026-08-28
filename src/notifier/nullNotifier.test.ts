import { describe, expect, it } from 'vitest';
import { NullNotifier } from './nullNotifier.js';

describe('NullNotifier', () => {
  it('resolves without doing anything', async () => {
    const notifier = new NullNotifier();

    await expect(notifier.notify('anything')).resolves.toBeUndefined();
  });
});
