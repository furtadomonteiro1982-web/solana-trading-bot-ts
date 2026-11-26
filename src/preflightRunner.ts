import fs from 'node:fs';
import { loadConfig } from './config.js';
import { checkHost, checkNodeVersion, formatChecks, type CheckResult } from './preflight/checks.js';

// Vérifie qu'un serveur peut faire tourner le bot : version de Node, configuration, dossiers,
// accès réseau aux sources de données, Telegram. Ne modifie rien.
//
//   npm run verifier

async function main() {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  const results: CheckResult[] = [checkNodeVersion(process.version)];

  let config;
  try {
    config = loadConfig('config/config.json');
    results.push({ name: 'config/config.json', ok: true, required: true, detail: 'valide' });
  } catch (error) {
    results.push({ name: 'config/config.json', ok: false, required: true, detail: String(error) });
  }

  for (const dir of ['data', 'logs']) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      results.push({ name: `dossier ${dir}/`, ok: true, required: true, detail: 'accessible en écriture' });
    } catch (error) {
      results.push({ name: `dossier ${dir}/`, ok: false, required: true, detail: String(error) });
    }
  }

  const stopFile = config?.satellite.stopFile ?? 'STOP';
  results.push({
    name: 'interrupteur STOP',
    ok: !fs.existsSync(stopFile),
    required: false,
    detail: fs.existsSync(stopFile) ? `présent (${stopFile}) : le bot n'ouvrira aucune position` : 'absent',
  });
  results.push({
    name: 'clé privée de portefeuille',
    ok: !process.env.SOLANA_WALLET_PRIVATE_KEY,
    required: false,
    detail: process.env.SOLANA_WALLET_PRIVATE_KEY
      ? 'renseignée dans .env alors que le bot est en simulation : retirez-la'
      : 'absente (normal en simulation)',
  });

  if (config) {
    const hosts = [
      { name: 'GeckoTerminal (scanner)', url: `${config.geckoTerminal.baseUrl}/networks`, required: true },
      { name: 'Jupiter (prix)', url: `${config.jupiter.baseUrl}/price/v3?ids=So11111111111111111111111111111111111111112`, required: true },
      { name: 'PumpPortal (sniper)', url: 'https://pumpportal.fun', required: config.sniper.enabled },
      { name: 'Binance (cœur, Comptable)', url: `${config.core.binanceBaseUrl}/api/v3/ping`, required: true },
      { name: 'DefiLlama (grille)', url: 'https://api.llama.fi/protocols', required: false },
      { name: 'CoinGecko (grille)', url: 'https://api.coingecko.com/api/v3/ping', required: false },
    ];
    if (process.env.BIRDEYE_API_KEY) hosts.push({ name: 'Birdeye (secours)', url: config.birdeye.baseUrl, required: false });
    const fetchFn = globalThis.fetch as unknown as Parameters<typeof checkHost>[1];
    for (const host of hosts) results.push(await checkHost(host, fetchFn));
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (token && process.env.TELEGRAM_CHAT_ID) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      results.push({
        name: 'Telegram',
        ok: response.ok,
        required: false,
        detail: response.ok ? 'jeton valide' : `jeton refusé (HTTP ${response.status})`,
      });
    } catch (error) {
      results.push({ name: 'Telegram', ok: false, required: false, detail: `injoignable : ${String(error)}` });
    }
  } else {
    results.push({ name: 'Telegram', ok: true, required: false, detail: 'non configuré (facultatif)' });
  }

  const { text, blocking } = formatChecks(results);
  console.log(text);
  process.exit(blocking === 0 ? 0 : 1);
}

void main();
