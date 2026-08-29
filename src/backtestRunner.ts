import fs from 'node:fs';
import { loadConfig } from './config.js';
import { createGeckoTerminalClient } from './geckoterminal/client.js';
import { createBirdeyeClient } from './birdeye/client.js';
import { createFallbackClient, type MarketDataClient } from './marketdata/client.js';
import { runBacktest } from './backtest.js';

async function main() {
  if (fs.existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  const config = loadConfig('config/config.json');
  const geckoTerminalClient = createGeckoTerminalClient(
    config.geckoTerminal.baseUrl,
    config.geckoTerminal.minIntervalMs
  );

  // Contrairement au bot en direct, GeckoTerminal seul suffit ici (gratuit, sans clé) : Birdeye
  // n'est qu'un secours optionnel si vous en avez déjà une.
  const birdeyeApiKey = process.env.BIRDEYE_API_KEY;
  let client: MarketDataClient = geckoTerminalClient;
  if (birdeyeApiKey) {
    const birdeyeClient = createBirdeyeClient(
      config.birdeye.baseUrl,
      birdeyeApiKey,
      config.birdeye.minIntervalMs
    );
    client = createFallbackClient(geckoTerminalClient, birdeyeClient);
  } else {
    console.log(
      'BIRDEYE_API_KEY absent de .env : pas de secours si GeckoTerminal échoue (facultatif, voir .env.example).'
    );
  }

  const poolAddress = process.argv[2];

  if (!poolAddress) {
    console.error('Usage : npm run backtest -- <poolAddress>');
    console.error('Trouvez une poolAddress sur https://www.geckoterminal.com/solana ou https://dexscreener.com/solana');
    process.exit(1);
  }

  const pool = await client.fetchPool(config.network, poolAddress);
  if (!pool) {
    console.error(`Pool ${poolAddress} introuvable sur le réseau ${config.network}.`);
    console.error("Vérifiez l'adresse du pool et votre connexion réseau.");
    process.exit(1);
  }

  const candleLimit = Math.max(config.ohlcvLimit, 500);
  if (candleLimit > config.ohlcvLimit) {
    console.log(
      `Récupération de ${candleLimit} bougies pour le backtest ` +
        `(plus que les ${config.ohlcvLimit} configurées pour le scan en direct, ` +
        `afin d'avoir assez d'historique).`
    );
  } else {
    console.log(`Récupération de ${candleLimit} bougies pour le backtest.`);
  }

  const candles = await client.fetchOhlcv(config.network, poolAddress, config.timeframe, candleLimit);

  const report = runBacktest(pool, candles, config);

  console.log(`\nRésultats du backtest pour ${pool.baseTokenSymbol} (${poolAddress})`);
  console.log(`Nombre de trades : ${report.totalTrades}`);
  console.log(`Gagnants / Perdants : ${report.wins} / ${report.losses}`);
  console.log(`Taux de réussite : ${report.winRatePct.toFixed(1)}%`);
  console.log(`PnL total simulé : ${report.totalPnlUsd.toFixed(2)}$`);
  for (const trade of report.trades) {
    console.log(
      `  ${trade.entryAt.toISOString()} -> ${trade.exitAt.toISOString()} | ${trade.exitReason} | ` +
        `PnL: ${trade.pnlUsd.toFixed(2)}$ (${trade.pnlPct.toFixed(1)}%)`
    );
  }
}

main().catch((error) => {
  console.error('Erreur lors du backtest :', error);
  process.exit(1);
});
