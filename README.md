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

## Lancer le bot en direct

```bash
npm start
```

Le bot tourne en boucle : à chaque cycle il scanne les pools, journalise ses décisions et
vérifie les positions ouvertes (stop-loss, take-profit, trailing stop).

Le délai entre deux cycles est réglé par `scanIntervalSeconds` dans `config/config.json`
(60 = un cycle par minute). Les autres réglages du même fichier contrôlent les filtres
(`filters`), les indicateurs (`indicators`) et la gestion du risque (`risk` : capital simulé,
taille de position, nombre max de positions, seuils de sortie).

Pour arrêter le bot : **Ctrl+C**. Le cycle en cours se termine d'abord, puis la base de données
est refermée proprement — l'arrêt peut donc prendre quelques secondes.

Si `config/config.json` contient une faute de frappe (virgule en trop, accolade manquante),
le bot s'arrête immédiatement avec un message expliquant le problème.

## Tester une stratégie sur l'historique (backtest)

```bash
npm run backtest -- <poolAddress>
```

L'adresse à fournir est celle du **pool** (pas celle du token). Pour la trouver : ouvrez une
paire sur [GeckoTerminal](https://www.geckoterminal.com/solana) ou
[DexScreener](https://dexscreener.com/solana), l'adresse du pool apparaît dans l'URL de la page
et sur la fiche de la paire. N'importe quel pool Solana fonctionne, pas seulement ceux qui sont
populaires en ce moment.

Si l'adresse est introuvable, le bot le signale et s'arrête — vérifiez alors que vous avez bien
copié l'adresse du pool et non celle du token.

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
