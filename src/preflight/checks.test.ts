import { describe, expect, it, vi } from 'vitest';
import { checkHost, checkNodeVersion, formatChecks } from './checks.js';

describe('checkNodeVersion', () => {
  it('accepte Node 20.12 et plus récent', () => {
    expect(checkNodeVersion('v20.12.0').ok).toBe(true);
    expect(checkNodeVersion('v22.3.1').ok).toBe(true);
  });

  it('refuse une version trop ancienne', () => {
    expect(checkNodeVersion('v20.11.1')).toMatchObject({ ok: false, detail: expect.stringMatching(/20\.12/) });
    expect(checkNodeVersion('v18.19.0').ok).toBe(false);
  });
});

describe('checkHost', () => {
  const host = { name: 'Test', url: 'https://exemple.test', required: true };

  it('considère toute réponse HTTP comme joignable', async () => {
    const result = await checkHost(host, async () => ({ status: 404 }));

    expect(result).toMatchObject({ ok: true, detail: 'joignable (HTTP 404)' });
  });

  it('signale une panne réseau', async () => {
    const result = await checkHost(host, async () => {
      throw new TypeError('fetch failed');
    });

    expect(result).toMatchObject({ ok: false, detail: expect.stringMatching(/injoignable/) });
  });

  it('abandonne après le délai', async () => {
    const neverAnswers = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<{ status: number }>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    );

    const result = await checkHost(host, neverAnswers, 10);

    expect(result.detail).toContain('pas de réponse');
  });
});

describe('formatChecks', () => {
  it('compte seulement les échecs bloquants', () => {
    const { text, blocking } = formatChecks([
      { name: 'A', ok: true, required: true, detail: 'ok' },
      { name: 'B', ok: false, required: false, detail: 'avertissement' },
      { name: 'C', ok: false, required: true, detail: 'cassé' },
    ]);

    expect(blocking).toBe(1);
    expect(text).toContain('⚠ B');
    expect(text).toContain('✖ C');
    expect(text).toContain('1 problème(s) bloquant(s)');
  });
});
