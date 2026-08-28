import { loadConfig } from './config.js';
import { createGeckoTerminalClient } from './geckoterminal/client.js';
import { runBacktest } from './backtest.js';

async function main() {
  const config = loadConfig('config/config.json');
  const client = createGeckoTerminalClient(config.geckoTerminal.baseUrl);
  const poolAddress = process.argv[2];

  if (!poolAddress) {
    console.error('Usage : npm run backtest -- <poolAddress>');
    console.error('Trouvez une poolAddress sur https://www.geckoterminal.com/solana ou https://dexscreener.com/solana');
    process.exit(1);
  }

  const pools = await client.fetchTrendingPools(config.network);
  const pool = pools.find((p) => p.poolAddress === poolAddress);
  if (!pool) {
    console.error(`Pool ${poolAddress} introuvable parmi les pools trending actuels.`);
    process.exit(1);
  }

  const candles = await client.fetchOhlcv(
    config.network,
    poolAddress,
    config.geckoTerminal.timeframe,
    Math.max(config.geckoTerminal.ohlcvLimit, 500)
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
