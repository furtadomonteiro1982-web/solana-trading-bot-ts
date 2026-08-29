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

Le bot utilise trois APIs :

- **[GeckoTerminal](https://www.geckoterminal.com/)** — source principale pour le scanner (pools
  trending), l'historique OHLCV et le backtest. **Gratuite, sans clé API, pas de quota mensuel**
  (juste une limite de débit qui se régénère en continu). Rien à configurer.
- **[Birdeye](https://birdeye.so)** — secours automatique : si GeckoTerminal échoue (panne, limite
  de débit persistante), le bot bascule dessus pour l'appel concerné, le temps que GeckoTerminal
  se rétablisse. **Facultatif.** Pour l'activer :
  1. Créez un compte sur [birdeye.so](https://birdeye.so), puis générez une clé dans l'onglet
     "Security" du tableau de bord.
  2. Copiez `.env.example` en `.env` et renseignez `BIRDEYE_API_KEY` :
     ```bash
     cp .env.example .env
     ```
  3. Sans cette clé, le bot fonctionne quand même — juste sans filet de sécurité si GeckoTerminal
     tombe en panne. Le plan gratuit Birdeye a un quota mensuel de 30 000 Compute Units, donc même
     activé, il n'est utile que pour dépanner ponctuellement, pas pour remplacer GeckoTerminal en
     continu.
- **[Jupiter Price API](https://station.jup.ag)** — prix des positions ouvertes, gratuite, sans
  clé, un seul appel par cycle pour toutes les positions à la fois.

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

**Limite de débit de l'API.** `geckoTerminal.minIntervalMs` (1100ms par défaut) espace toutes les
requêtes vers la source principale (le client attend automatiquement, pas besoin de délai côté
pipeline) ; `birdeye.minIntervalMs` fait de même pour le secours, dont le plan gratuit est limité
à 1 requête/seconde et 30 000 Compute Units par mois. `maxPoolsPerCycle` (5 par défaut) plafonne
le nombre de pools réellement évalués par cycle — les pools filtrés au-delà de cette limite sont
journalisés (`THROTTLE`) et repris au cycle suivant. Sur un 429, le client ne retente qu'une seule
fois (en respectant l'en-tête `Retry-After` si présent) au lieu de marteler l'API pendant une
fenêtre déjà saturée ; sur un 400/401/403 (requête invalide, quota épuisé, clé non autorisée), il
n'insiste pas du tout, ces erreurs ne se résolvant jamais toutes seules. Si GeckoTerminal échoue,
le bot bascule sur Birdeye pour l'appel concerné (`console.warn` visible dans les logs) ; si les
deux échouent, l'erreur est journalisée (`ERROR` dans `decision_logs`) mais ne fait jamais planter
le bot — le cycle se termine avec des compteurs à 0 et le suivant reprend normalement.

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
npm run backtest -- <poolAddress>
```

L'adresse à fournir est celle du **pool** (pas celle du token) — GeckoTerminal travaille au niveau
du pool. Pour la trouver : ouvrez une paire sur
[GeckoTerminal](https://www.geckoterminal.com/solana) ou [DexScreener](https://dexscreener.com/solana),
l'adresse du pool apparaît dans l'URL de la page et sur la fiche de la paire. N'importe quel pool
Solana fonctionne, pas seulement ceux qui sont trending en ce moment.

Si l'adresse est introuvable, le bot le signale et s'arrête — vérifiez alors que vous avez bien
copié l'adresse du pool et non celle du token.

Le backtest rejoue la stratégie sur les bougies passées et affiche le nombre de trades, le taux
de réussite et le PnL simulé. Les résultats sont une **approximation** : l'entrée se fait à la
clôture de la bougie historique alors que le bot en direct entre au prix spot du pool (voir les
commentaires en tête de `src/backtest.ts`).

## Où sont stockés les résultats

Tout est dans une base SQLite locale : `data/bot.sqlite`. Trois tables :

- **`positions`** — une ligne par position simulée : pool, symbole, prix et date d'entrée,
  taille, niveaux de stop-loss / take-profit, statut (`OPEN` ou `CLOSED`) et, une fois fermée,
  le prix de sortie, la raison (`TAKE_PROFIT`, `STOP_LOSS`, `TRAILING_STOP`) et le PnL.
- **`decision_logs`** — la trace de chaque décision, y compris les refus : à quelle étape
  (`FILTER`, `SIGNAL`, `RISK`, `THROTTLE`, `ERROR`), pour quel pool et surtout **pourquoi**. C'est
  ici qu'on regarde pour comprendre l'inaction du bot.
- **`first_seen`** — la date à laquelle ce bot a vu chaque pool pour la première fois. Sert
  d'approximation à l'âge réel du pool (voir la limite ci-dessous) et persiste entre les
  redémarrages.

**À propos de l'âge des pools.** GeckoTerminal (source principale) fournit la vraie date de
création on-chain, utilisée directement. Si le secours Birdeye prend le relais pour un pool
(panne GeckoTerminal), sa vraie date de création n'est pas disponible sur le plan gratuit
(`token_creation_info` renvoie 401) : le filtre `minPoolAgeMinutes` retombe alors sur *depuis
combien de temps ce bot suit ce pool* (table `first_seen`) — un pool déjà ancien mais jamais
croisé par le bot serait traité comme tout juste créé la première fois qu'il apparaît dans le
scan. C'est plus conservateur que la vraie date, jamais moins protecteur pour le garde-fou
anti-rug-pull. Dès que GeckoTerminal répond à nouveau pour ce pool, sa vraie date prend le relais.

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
