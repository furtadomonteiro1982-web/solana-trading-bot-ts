# Sniper de nouveaux tokens pump.fun (paper trading)

Date : 2026-08-30
Statut : Approuvé pour passage en plan d'implémentation

## Contexte et objectif

Le bot actuel (voir `2026-08-27-solana-filter-bot-design.md`) suit une
stratégie horaire (RSI/SMA/momentum) sur des pools déjà établis, scannés
toutes les 120 secondes via GeckoTerminal. Le sniping avait été explicitement
reporté à une phase ultérieure dans la spec initiale — c'est cette phase qui
démarre ici.

Objectif : détecter en temps réel la création de nouveaux tokens sur
pump.fun et les acheter en paper trading dès leur lancement, avant même
qu'ils n'aient d'historique de prix exploitable par la stratégie existante.
C'est une stratégie fondamentalement différente (aucun indicateur technique
possible sur un token de quelques secondes) qui coexiste avec la stratégie
horaire actuelle, sans la remplacer.

## Contraintes

- **Paper trading uniquement** — aucun argent réel, aucune clé privée de
  wallet, cohérent avec le reste du projet à ce stade.
- **Détection événement de création** (pas la migration vers un DEX réel) —
  le point d'entrée le plus précoce, donc le plus proche de l'esprit
  "sniping", et le plus risqué (quasi-totalité des tokens pump.fun finissent
  à zéro ou sont des rugs).
- Reste dans l'esprit du projet : composants gratuits, sans clé API
  complexe, testables isolément.
- N'affecte pas la stratégie horaire existante : configuration, capital
  simulé et plafond de positions séparés.

## Choix technique : détection

**PumpPortal WebSocket** (`wss://pumpportal.fun/api/data`, gratuit pour
`subscribeNewToken`) plutôt que :
- le polling périodique de l'API pump.fun (revient au même modèle que
  l'existant, mais rate un événement "sniping" de plusieurs secondes à
  dizaines de secondes selon la fréquence — contraire à l'objectif) ;
- Helius Geyser/RPC (écarté dès la conception initiale du projet pour sa
  complexité et son coût — pertinent seulement si une exécution réelle à
  très faible latence était visée, ce qui n'est pas le cas ici).

La forme exacte des messages retournés par PumpPortal n'est pas documentée
publiquement de façon fiable au moment de cette spec — elle sera confirmée
empiriquement (connexion réelle au flux) au début de l'implémentation, avant
d'écrire le parseur définitif. Le reste de l'architecture ne dépend pas du
détail exact de ce format.

## Architecture

Un second flux, entièrement asynchrone, tourne en parallèle de la boucle
existante (même processus `main.ts`, pas un service séparé — inutile de
gérer deux process PM2 pour un paper trading à ce stade) :

```
PumpPortal WS -> Filtre anti-rug -> Dimensionnement -> Exécuteur (paper) -> Store (SQLite, partagé)
                                                                 |
                                                    Boucle de revue rapide (TP/SL/timeout)
```

### Composants

- **`pumpPortalClient.ts`** — connexion WebSocket persistante, s'abonne à
  `subscribeNewToken`, reconnexion automatique sur coupure. Expose une
  interface injectable (comme `MarketDataClient` pour le reste du bot) pour
  rester testable sans réseau réel. Émet un événement normalisé : adresse du
  token, symbole, créateur, liens sociaux présents, taille de l'achat initial
  du créateur.
- **`snipeFilter.ts`** — fonction pure `shouldSnipe(event, config)` :
  - rejette si aucun lien social (site/twitter/telegram) n'est présent ;
  - rejette si le nom/symbole matche un motif de la liste noire configurée
    (ex: "test", "scam", "rug") ;
  - rejette si l'achat initial du créateur dépasse un % configuré du supply
    (signe classique d'un rug préparé).
- **`sniperPipeline.ts`** — sur un événement qui passe le filtre : vérifie le
  plafond `maxOpenSnipes`, dimensionne la position (mise fixe `stakeUsd`,
  pas un % du capital comme la stratégie horaire — le taux d'échec attendu
  est trop élevé pour miser gros par position), exécute l'achat via
  `PaperExecutor`, enregistre dans la table `positions` existante (aucun
  changement de schéma — les colonnes actuelles suffisent), notifie.
- **Boucle de revue rapide** — reste `reviewOpenPositions` existant, appelé
  à un intervalle bien plus court que les 120s de la boucle actuelle (ex:
  8s, configurable), avec les prix Jupiter Price API par `baseTokenAddress`
  (réutilise directement le correctif appliqué plus tôt sur ce même
  mécanisme). Une nouvelle petite fonction, séparée, ajoute la sortie forcée
  par timeout (`openedAt + maxHoldMinutes < now`) sans modifier
  `reviewOpenPositions` lui-même — ni ses tests existants.

### Configuration

Nouveau bloc `sniper` dans `config/config.json`, séparé de `risk` (stratégie
horaire) :

```json
"sniper": {
  "enabled": true,
  "pumpPortalWsUrl": "wss://pumpportal.fun/api/data",
  "simulatedCapitalUsd": 20,
  "stakeUsd": 2,
  "maxOpenSnipes": 5,
  "stopLossPct": 40,
  "takeProfitPct": 100,
  "maxHoldMinutes": 15,
  "reviewIntervalSeconds": 8,
  "filters": {
    "requireSocialLink": true,
    "bannedNamePatterns": ["test", "scam", "rug"],
    "maxCreatorInitialBuyPct": 20
  }
}
```

`simulatedCapitalUsd` (20$) est une poche séparée des 100$ existants — les
deux P&L restent distincts pour l'analyse. `maxOpenSnipes` est indépendant de
`risk.maxOpenPositions` : les deux stratégies ont chacune leur propre budget
de positions simultanées, sans se bloquer l'une l'autre.

### Flux de données

1. `pumpPortalClient` reçoit un événement de création de token.
2. `snipeFilter.shouldSnipe` évalue l'événement → accepté ou rejeté (avec
   raison, journalisée comme le reste du pipeline via `decisionLog`).
3. Si accepté et `maxOpenSnipes` non atteint : achat paper trading immédiat,
   taille fixe `stakeUsd`, stop-loss/take-profit calculés depuis
   `sniper.stopLossPct`/`takeProfitPct`.
4. Notification Telegram à l'ouverture (même format que l'existant).
5. La boucle de revue rapide clôture la position sur TP, SL, ou timeout —
   selon ce qui arrive en premier.
6. Notification Telegram à la clôture, avec la raison (y compris `TIMEOUT`,
   une nouvelle valeur de `CloseReason`).

## Gestion des erreurs et résilience

- Coupure WebSocket : reconnexion automatique avec backoff, comme les
  clients HTTP existants (GeckoTerminal/Birdeye).
- Un événement mal formé ou un token sans les champs attendus : rejeté et
  journalisé, jamais une exception qui interromprait le flux pour les
  événements suivants.
- Le flux sniper et la boucle horaire existante sont indépendants : une
  panne de l'un (WebSocket down, ou GeckoTerminal rate-limité) n'affecte pas
  l'autre.
- Kill switch : le même signal d'arrêt propre (`SIGINT`) doit fermer aussi
  proprement la connexion WebSocket que la boucle actuelle ferme son cycle.

## Stratégie de test

1. **`snipeFilter.ts`** — tests tabulaires purs : lien social absent →
   rejeté, nom banni → rejeté, achat créateur excessif → rejeté, cas propre →
   accepté.
2. **`pumpPortalClient.ts`** — testé via l'interface injectable avec un faux
   client émettant des messages simulés (pas de connexion réseau réelle dans
   les tests, même approche que `MarketDataClient`).
3. **`sniperPipeline.ts`** — même style que `pipeline.test.ts` existant :
   événements simulés, executor/notifier mockés, vérifie ouverture/rejet
   selon le filtre, et clôture par TP/SL/timeout.
4. **Paper trading en direct** après les tests unitaires, pour observer le
   taux de réussite réel avant d'envisager quoi que ce soit d'autre.

## Hors scope (explicitement reporté)

- Exécution réelle on-chain (wallet, clé privée, Jupiter Swap API réel).
- Détection de la migration vers un DEX réel (`subscribeMigration`) — un
  point d'entrée différent, avec ses propres compromis, qui pourra faire
  l'objet d'une spec séparée si le sniping à la création s'avère
  intéressant.
- Analyse on-chain approfondie du wallet créateur (historique de rugs
  précédents) — plus fiable mais ajoute un appel API par token détecté, donc
  plus lent ; à réévaluer selon les résultats des filtres de base.
- Partage du capital/plafond de positions avec la stratégie horaire
  existante — restent volontairement séparés.
