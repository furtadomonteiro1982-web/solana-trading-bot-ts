// Vérifications avant lancement sur un serveur (`npm run verifier`, voir DEPLOY.md).

export interface CheckResult {
  name: string;
  ok: boolean;
  /** Vrai si l'échec empêche le bot de fonctionner ; faux pour un simple avertissement. */
  required: boolean;
  detail: string;
}

/** `process.loadEnvFile`, utilisé pour lire .env, existe depuis Node 20.12. */
export function checkNodeVersion(version: string): CheckResult {
  const [major = 0, minor = 0] = version.replace(/^v/, '').split('.').map(Number);
  const ok = major > 20 || (major === 20 && minor >= 12);
  return { name: 'Node.js', ok, required: true, detail: ok ? version : `${version} : il faut Node 20.12 ou plus récent` };
}

export interface HostCheck {
  name: string;
  url: string;
  required: boolean;
}

type FetchLike = (url: string, init?: { signal?: AbortSignal; method?: string }) => Promise<{ status: number }>;

/**
 * Le serveur répond-il ? Toute réponse HTTP compte comme joignable (même 404 ou 405 : la page
 * importe peu, seul le réseau est vérifié) ; une panne réseau ou un délai dépassé, non.
 */
export async function checkHost(host: HostCheck, fetchFn: FetchLike, timeoutMs = 10_000): Promise<CheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(host.url, { signal: controller.signal, method: 'GET' });
    return { name: host.name, ok: true, required: host.required, detail: `joignable (HTTP ${response.status})` };
  } catch (error) {
    const cause = error instanceof Error && error.cause ? ` (${String(error.cause)})` : '';
    const reason = controller.signal.aborted ? `pas de réponse en ${timeoutMs / 1000} s` : `${String(error)}${cause}`;
    return { name: host.name, ok: false, required: host.required, detail: `injoignable : ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

export function formatChecks(results: CheckResult[]): { text: string; blocking: number } {
  const lines = results.map((r) => `${r.ok ? '✔' : r.required ? '✖' : '⚠'} ${r.name.padEnd(28)} ${r.detail}`);
  const blocking = results.filter((r) => !r.ok && r.required).length;
  lines.push('');
  lines.push(blocking === 0 ? 'Tout est prêt.' : `${blocking} problème(s) bloquant(s) à corriger avant de lancer le bot.`);
  return { text: lines.join('\n'), blocking };
}
