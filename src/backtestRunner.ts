import fs from 'node:fs';
import { loadConfig } from './config.js';
import { createBirdeyeClient } from './birdeye/client.js';
import { runBacktest } from './backtest.js';

async function main() {
  if (fs.existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const birdeyeApiKey = process.env.BIRDEYE_API_KEY;
  if (!birdeyeApiKey) {
    console.error(
      "Erreur : BIRDEYE_API_KEY absent de .env. Créez une clé gratuite sur https://birdeye.so et ajoutez-la à .env (voir .env.example)."
    );
    process.exit(1);
  }

  const config = loadConfig('config/config.json');
  const client = createBirdeyeClient(config.birdeye.baseUrl, birdeyeApiKey, config.birdeye.minIntervalMs);
  const poolAddress = process.argv[2];

  if (!poolAddress) {
    console.error('Usage : npm run backtest -- <poolAddress>');
    console.error("Trouvez l'adresse d'un token sur https://birdeye.so/?chain=solana ou https://dexscreener.com/solana");
    process.exit(1);
  }

  const pool = await client.fetchPool(config.network, poolAddress);
  if (!pool) {
    console.error(`Token ${poolAddress} introuvable sur le réseau ${config.network}.`);
    console.error("Vérifiez l'adresse du token (mint Solana) et votre connexion réseau.");
    process.exit(1);
  }

  const candleLimit = Math.max(config.birdeye.ohlcvLimit, 500);
  if (candleLimit > config.birdeye.ohlcvLimit) {
    console.log(
      `Récupération de ${candleLimit} bougies pour le backtest ` +
        `(plus que les ${config.birdeye.ohlcvLimit} configurées pour le scan en direct, ` +
        `afin d'avoir assez d'historique).`
    );
  } else {
    console.log(`Récupération de ${candleLimit} bougies pour le backtest.`);
  }

  const candles = await client.fetchOhlcv(
    config.network,
    poolAddress,
    config.birdeye.timeframe,
    candleLimit
  );

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
