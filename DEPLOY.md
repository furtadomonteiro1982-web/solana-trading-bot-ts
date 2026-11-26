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

**Ne renseignez pas `SOLANA_WALLET_PRIVATE_KEY`.** Le bot est en simulation : il n'a besoin d'aucun
portefeuille ni d'aucune clé privée. Le passage au réel est une étape séparée, après validation de la
simulation (voir `docs/agents.md`).

## 5 bis. Vérifier le serveur

```bash
npm run verifier
```

Le script contrôle la version de Node.js, la configuration, les dossiers `data/` et `logs/`, l'accès
réseau à chaque source de données (GeckoTerminal, Jupiter, PumpPortal, Binance, DefiLlama,
CoinGecko) et, s'il est configuré, le jeton Telegram. Il ne modifie rien. Corrigez chaque ligne
marquée ✖ avant de continuer ; les lignes ⚠ sont de simples avertissements.

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

`pm2 start` lance trois tâches :

| Tâche | Ce qu'elle fait | Quand |
|---|---|---|
| `solana-trading-bot` | le satellite : trading horaire et sniper, en simulation | en continu |
| `comptable` | rapport du mois précédent (`data/comptable/`, et Telegram si configuré) | le 1er de chaque mois à 7 h 13 |
| `grille` | classement des projets pour la revue trimestrielle (`data/grille/`) | le 1er janvier, avril, juillet et octobre à 6 h 47 |

Les heures sont celles du serveur (souvent UTC : `timedatectl` pour vérifier). Les deux tâches
planifiées s'exécutent aussi une fois au `pm2 start`, puis s'arrêtent : dans `pm2 status`, elles
apparaissent « stopped » entre deux exécutions, c'est normal. Avant le premier mois complet de
simulation, le Comptable écrit seulement « Pas encore de rapport ».

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
| Bloquer toute nouvelle position (arrêt d'urgence) | `touch ~/solana-trading-bot-ts/STOP` |
| Reprendre | `rm ~/solana-trading-bot-ts/STOP` |
| Rapport du mois en cours, à la demande | `npm run comptable` |
| Voir le dernier rapport | `ls data/comptable/` puis `cat data/comptable/AAAA-MM.txt` |

L'interrupteur `STOP` agit sans redémarrage : le bot le vérifie avant chaque ouverture et continue
de fermer les positions déjà ouvertes à leur stop, leur objectif ou leur délai.

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
scp -r botuser@<IP_DU_VPS>:~/solana-trading-bot-ts/data/comptable ./rapports
```

## Les 30 jours de simulation

La fiche `docs/agents.md` demande au moins 30 jours de simulation avant d'envisager le réel. Pour le
satellite, les critères sont : au moins 30 trades, un gain positif après frais, aucune journée avec
une perte de plus de 5 %. Le rapport du Comptable donne ces chiffres chaque mois ; le passage au
réel reste une décision du propriétaire, jamais automatique.

## Sécurité de base

- Changez le port SSH par défaut et/ou désactivez l'authentification par mot de passe (clé SSH
  uniquement) si le VPS est exposé publiquement.
- `ufw enable` avec seulement le port SSH ouvert — le bot n'a besoin d'aucun port entrant, il ne
  fait que des requêtes sortantes (GeckoTerminal, Birdeye, Jupiter, PumpPortal, Binance, DefiLlama,
  CoinGecko, Telegram).
- `.env` contient des secrets (clé Birdeye, token Telegram) : ne le committez jamais (déjà dans
  `.gitignore`), et gardez ses permissions restreintes (`chmod 600 .env`).
