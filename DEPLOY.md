# Déploiement sur un VPS

Fait tourner le bot 24/7 sans dépendre de votre PC. Testé pour un VPS Ubuntu/Debian (DigitalOcean,
Hetzner, OVH...) — un petit plan (1 vCPU, 1 Go de RAM) suffit largement.

## 1. Provisionner le serveur

Créez un VPS Ubuntu 22.04 (ou plus récent) chez le fournisseur de votre choix, puis connectez-vous :

```bash
ssh root@<IP_DU_VPS>
```

## 2. Installer Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # doit afficher v22.x ou plus
```

## 3. Créer un utilisateur dédié (recommandé)

Évitez de faire tourner le bot en root :

```bash
adduser botuser
usermod -aG sudo botuser
su - botuser
```

## 4. Récupérer le code

```bash
git clone https://github.com/furtadomonteiro1982-web/solana-trading-bot-ts.git
cd solana-trading-bot-ts
npm install
```

## 5. Configurer les secrets

```bash
cp .env.example .env
nano .env
```

Renseignez au minimum `BIRDEYE_API_KEY` (facultatif mais recommandé, voir README) et, si vous
voulez les notifications, `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — les mêmes valeurs que celles
déjà utilisées en local, ou de nouvelles si vous préférez séparer les deux.

Vérifiez aussi `config/config.json` (déjà dans le repo, pas besoin de le recréer) — ajustez-le si
besoin avant de lancer.

## 6. Installer PM2 et lancer le bot

[PM2](https://pm2.keymetrics.io/) garde le bot en vie en arrière-plan, le redémarre s'il plante, et
le relance automatiquement après un reboot du serveur.

```bash
sudo npm install -g pm2
mkdir -p logs
pm2 start ecosystem.config.cjs
```

Vérifiez que ça tourne :

```bash
pm2 status
pm2 logs solana-trading-bot
```

Vous devriez voir "Bot démarré (paper trading)..." et, si Telegram est configuré, recevoir la
notification de démarrage.

## 7. Survivre à un reboot du serveur

```bash
pm2 startup
```

Cette commande affiche une ligne à copier-coller (elle contient `sudo env PATH=...`) — exécutez-la
telle quelle, puis :

```bash
pm2 save
```

## Commandes utiles

| Action | Commande |
|---|---|
| Voir les logs en direct | `pm2 logs solana-trading-bot` |
| Arrêter le bot | `pm2 stop solana-trading-bot` |
| Redémarrer le bot | `pm2 restart solana-trading-bot` |
| Statut / uptime / mémoire | `pm2 status` |
| Retirer le bot de PM2 | `pm2 delete solana-trading-bot` |

## Mettre à jour le code

```bash
cd solana-trading-bot-ts
git pull
npm install
pm2 restart solana-trading-bot
```

`pm2 restart` envoie SIGINT (le bot termine son cycle en cours et ferme la base proprement avant de
s'arrêter — jusqu'à `scanIntervalSeconds` de délai, voir le README) puis relance avec le nouveau
code.

## Récupérer la base de données / les logs en local

Depuis votre machine :

```bash
scp botuser@<IP_DU_VPS>:~/solana-trading-bot-ts/data/bot.sqlite ./bot-vps.sqlite
```

## Sécurité de base

- Changez le port SSH par défaut et/ou désactivez l'authentification par mot de passe (clé SSH
  uniquement) si le VPS est exposé publiquement.
- `ufw enable` avec seulement le port SSH ouvert — le bot n'a besoin d'aucun port entrant, il ne
  fait que des requêtes sortantes (GeckoTerminal, Birdeye, Jupiter, Telegram).
- `.env` contient des secrets (clé Birdeye, token Telegram) : ne le committez jamais (déjà dans
  `.gitignore`), et gardez ses permissions restreintes (`chmod 600 .env`).
