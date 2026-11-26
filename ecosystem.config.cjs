// Config PM2 pour faire tourner le bot en continu sur un VPS.
// Usage : pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'solana-trading-bot',
      script: 'node_modules/.bin/tsx',
      args: 'src/main.ts',
      cwd: __dirname,
      // Le bot lit déjà .env lui-même (process.loadEnvFile) — inutile de dupliquer les secrets ici.
      env: {
        NODE_ENV: 'production',
      },
      // Redémarre automatiquement sur crash, mais pas en boucle si ça plante en continu (ex: config
      // invalide) — au-delà de 10 redémarrages en moins d'une minute, PM2 arrête de réessayer.
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      // Le bot gère déjà proprement SIGINT (fin du cycle en cours, fermeture DB) : on laisse PM2
      // utiliser le même signal plutôt que SIGKILL, avec une marge pour que ça se termine bien.
      kill_timeout: 10000,
      // Pas de watch : un redéploiement se fait via git pull + pm2 restart, pas par surveillance de
      // fichiers (qui redémarrerait le bot en pleine position ouverte à chaque édition de code).
      watch: false,
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      time: true,
    },
    // Tâches ponctuelles relancées par PM2 selon un calendrier (heures du serveur, en général UTC).
    // autorestart: false : le script s'exécute, se termine, et attend la prochaine date. PM2 le
    // lance aussi une première fois au `pm2 start`.
    {
      name: 'comptable',
      script: 'node_modules/.bin/tsx',
      // Le 1er du mois à 7 h 13 : rapport du mois précédent, terminé la veille.
      args: 'src/comptableRunner.ts --mois-precedent',
      cwd: __dirname,
      cron_restart: '13 7 1 * *',
      autorestart: false,
      watch: false,
      out_file: 'logs/comptable.log',
      error_file: 'logs/comptable-error.log',
      time: true,
    },
    {
      name: 'grille',
      script: 'node_modules/.bin/tsx',
      args: 'src/grilleRunner.ts',
      cwd: __dirname,
      // Le 1er de chaque trimestre à 6 h 47 : classement à relire avant la revue trimestrielle.
      cron_restart: '47 6 1 1,4,7,10 *',
      autorestart: false,
      watch: false,
      out_file: 'logs/grille.log',
      error_file: 'logs/grille-error.log',
      time: true,
    },
  ],
};
