# Bot de trading Solana — phase 1 (papier)

Bot qui surveille les pools Solana les plus actifs, applique des filtres et des indicateurs
techniques (RSI, moyenne mobile, momentum), puis simule des achats et des ventes.

**Aucun argent réel n'est engagé.** Il n'y a ni portefeuille, ni clé privée, ni transaction
on-chain : toutes les positions sont simulées et enregistrées en base locale. C'est un outil
d'observation et d'apprentissage, pas un conseil en investissement.

## Installation

Il faut Node.js (version 20 ou plus récente) installé sur la machine.

```bash
npm install
```

## Sources de données

Le bot utilise deux APIs :

- **[Birdeye](https://birdeye.so)** pour le scanner (tokens trending), l'historique OHLCV et le
  backtest. **Nécessite une clé API gratuite** :
  1. Créez un compte sur [birdeye.so](https://birdeye.so), puis générez une clé dans l'onglet
     "Security" du tableau de bord.
  2. Copiez `.env.example` en `.env` et renseignez `BIRDEYE_API_KEY` :
     ```bash
     cp .env.example .env
     ```
  3. Sans cette clé, le bot refuse de démarrer (`npm start` et `npm run backtest` affichent un
     message clair).
- **[Jupiter Price API](https://station.jup.ag)** pour le prix des positions ouvertes — gratuite,
  sans clé, un seul appel par cycle pour toutes les positions à la fois.

## Lancer le bot en direct

```bash
npm start
```

Le bot tourne en boucle : à chaque cycle il scanne les pools, journalise ses décisions et
vérifie les positions ouvertes (stop-loss, take-profit, trailing stop).

Le délai entre deux cycles est réglé par `scanIntervalSeconds` dans `config/config.json`
(120 par défaut = un cycle toutes les deux minutes). Les autres réglages du même fichier
contrôlent les filtres (`filters`), les indicateurs (`indicators`) et la gestion du risque
(`risk` : capital simulé, taille de position, nombre max de positions, seuils de sortie).

**Limite de débit de l'API.** Le plan gratuit Birdeye limite à 1 requête/seconde et 30 000
Compute Units (CU). Trois réglages limitent la consommation de quota par cycle :
`birdeye.minIntervalMs` (1100ms par défaut) espace toutes les requêtes Birdeye (le client
attend automatiquement, pas besoin de délai côté pipeline), `maxPoolsPerCycle` (5 par défaut)
plafonne le nombre de pools réellement évalués par cycle — les pools filtrés au-delà de cette
limite sont journalisés (`THROTTLE`) et repris au cycle suivant — et la date de création de
chaque token (40 CU par adresse) n'est récupérée qu'une seule fois par token pour la durée de vie
du processus, jamais à chaque cycle. Sur un 429, le client ne retente qu'une seule fois (en
respectant l'en-tête `Retry-After` si présent) au lieu de marteler l'API pendant une fenêtre déjà
saturée. Si le bot se fait quand même limiter souvent (visible via des lignes `ERROR` dans
`decision_logs`, ou `0 pools scannés` dans un cycle), augmentez `scanIntervalSeconds`, réduisez
`maxPoolsPerCycle` et/ou augmentez `birdeye.minIntervalMs`. Une erreur d'API ne fait jamais
planter le bot : le cycle se termine avec des compteurs à 0 et le suivant reprend normalement.

### Notifications Telegram (facultatif)

Le bot peut vous avertir sur Telegram à l'ouverture d'une position, à sa clôture (avec le PnL) et
si des erreurs persistent sur plusieurs cycles d'affilée. Sans configuration, il fonctionne
normalement sans rien envoyer.

1. Parlez à [@BotFather](https://t.me/BotFather) sur Telegram, envoyez `/newbot` et suivez les
   instructions — il vous donne un **token** (`TELEGRAM_BOT_TOKEN`).
2. Envoyez n'importe quel message à votre nouveau bot (obligatoire pour l'étape suivante).
3. Ouvrez `https://api.telegram.org/bot<TOKEN>/getUpdates` dans un navigateur (remplacez
   `<TOKEN>` par le vôtre) — le champ `chat.id` de la réponse est votre **`TELEGRAM_CHAT_ID`**.
4. Copiez `.env.example` en `.env` et renseignez les deux valeurs :
   ```bash
   cp .env.example .env
   ```
5. Relancez `npm start` — le message "Notifications Telegram activées." confirme que c'est pris
   en compte.

Pour arrêter le bot : **Ctrl+C**. Le cycle en cours se termine d'abord, puis la base de données
est refermée proprement. Si l'arrêt arrive pendant l'attente entre deux cycles, il peut prendre
jusqu'à `scanIntervalSeconds` (l'attente en cours n'est pas interrompue immédiatement) — donc
jusqu'à deux minutes avec les réglages par défaut, pas juste quelques secondes.

Si `config/config.json` contient une faute de frappe (virgule en trop, accolade manquante),
le bot s'arrête immédiatement avec un message expliquant le problème.

## Tester une stratégie sur l'historique (backtest)

```bash
npm run backtest -- <adresse du token>
```

L'adresse à fournir est celle du **token** (mint Solana), pas celle d'un pool spécifique — Birdeye
travaille au niveau du token. Pour la trouver : ouvrez une page token sur
[Birdeye](https://birdeye.so/?chain=solana) ou [DexScreener](https://dexscreener.com/solana),
l'adresse apparaît dans l'URL et sur la fiche. N'importe quel token Solana fonctionne, pas
seulement ceux qui sont trending en ce moment.

Si l'adresse est introuvable, le bot le signale et s'arrête — vérifiez alors que vous avez bien
copié l'adresse du token et votre connexion réseau.

Le backtest rejoue la stratégie sur les bougies passées et affiche le nombre de trades, le taux
de réussite et le PnL simulé. Les résultats sont une **approximation** : l'entrée se fait à la
clôture de la bougie historique alors que le bot en direct entre au prix spot du pool (voir les
commentaires en tête de `src/backtest.ts`).

## Où sont stockés les résultats

Tout est dans une base SQLite locale : `data/bot.sqlite`. Deux tables :

- **`positions`** — une ligne par position simulée : pool, symbole, prix et date d'entrée,
  taille, niveaux de stop-loss / take-profit, statut (`OPEN` ou `CLOSED`) et, une fois fermée,
  le prix de sortie, la raison (`TAKE_PROFIT`, `STOP_LOSS`, `TRAILING_STOP`) et le PnL.
- **`decision_logs`** — la trace de chaque décision, y compris les refus : à quelle étape
  (`FILTER`, `SIGNAL`, `RISK`, `ERROR`), pour quel pool et surtout **pourquoi**. C'est ici qu'on
  regarde pour comprendre l'inaction du bot.

Le fichier se lit avec n'importe quel outil SQLite (par exemple
[DB Browser for SQLite](https://sqlitebrowser.org/)).

## Lancer les tests

```bash
npm test
```

Pour vérifier les types TypeScript :

```bash
npm run typecheck
```
