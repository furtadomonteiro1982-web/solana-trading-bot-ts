# Bot de trading Solana — Phase 1 (filtrage + indicateurs, simulation)

Date : 2026-08-27
Statut : Approuvé pour passage en plan d'implémentation

## Contexte et objectif

Construire un bot de trading pour des tokens on-chain sur Solana, piloté par
la stratégie propre de l'utilisateur : combinaison de filtrage par critères
(liquidité, âge du pool), momentum (volume, variation de prix) et indicateurs
techniques classiques (RSI, moyennes mobiles).

Le sniping de nouveaux tokens (achat en millisecondes dès le lancement) fait
partie de l'ambition à terme mais est explicitement reporté à une phase
ultérieure : c'est la partie la plus risquée (compétition avec des bots MEV,
scams/rug pulls fréquents, exigences de latence extrême) et elle bénéficiera
d'une architecture déjà validée par cette phase 1.

Un projet similaire existe déjà (`Projets/solana_memecoin_bot` et
`Projets/solona scanne`, en Python) mais l'utilisateur a choisi de repartir de
zéro plutôt que de le reprendre.

## Contraintes

- Utilisateur expérimenté en trading, débutant en programmation → code lisible,
  bien structuré, commenté aux endroits non triviaux, pas de sur-ingénierie.
- Capital réel visé, à terme : très faible (< 100$), donc garde-fous stricts
  attendus avant tout passage en argent réel.
- Aucune exécution réelle dans cette phase : uniquement simulation (paper
  trading) et backtesting sur données historiques.
- Aucun wallet ni accès RPC configuré à ce stade — pas nécessaire pour cette
  phase (l'exécution réelle via Jupiter est hors scope, prévue en phase 2).

## Choix technique : langage et données

- **Langage : TypeScript** (Node.js). Écosystème Solana (Jupiter, Raydium SDK,
  @solana/web3.js) plus mature et adapté à l'exécution on-chain que Python,
  ce qui compte pour la phase 2. Choisi malgré le profil débutant en code de
  l'utilisateur, en échange d'un code structuré et bien documenté.
- **Source de données : API GeckoTerminal** (publique, gratuite, documentée
  officiellement). Couvre les mêmes pools Solana que DexScreener et fournit de
  vraies bougies OHLCV historiques, indispensables pour le backtesting.
  DexScreener reste l'outil de suivi visuel préféré de l'utilisateur, mais son
  API publique n'est pas documentée pour un usage bot fiable.

## Architecture

Pipeline cyclique, un cycle toutes les N secondes (N configurable) :

```
Scanner -> Filtre -> Signal -> Gestion du risque -> Exécuteur -> Store (SQLite)
```

Chaque étape est un module TypeScript indépendant, avec une interface d'entrée
et de sortie typée, testable isolément. L'Exécuteur est conçu derrière une
interface commune (`execute(order): Fill`) pour pouvoir passer d'un
`PaperExecutor` (phase 1) à un `JupiterExecutor` (phase 2) sans modifier le
reste du pipeline.

### Composants

- **Scanner** — interroge l'API GeckoTerminal à intervalle régulier pour la
  liste des pools Solana actifs (prix, volume, liquidité, âge du pool).
- **Filtre** — rejette les pools sous les seuils minimums (liquidité, âge du
  pool). Seuils définis dans un fichier de config, pas codés en dur.
- **Signal** — sur les pools retenus, calcule RSI, moyennes mobiles et
  momentum sur l'historique de prix récent (bougies OHLCV) ; produit une
  décision `BUY` / `HOLD` / `SKIP` accompagnée du raisonnement.
- **Gestion du risque** — calcule la taille de position (limitée par le
  capital configuré et un % max par trade), fixe stop-loss, take-profit et
  trailing stop. A le dernier mot : peut rejeter un `BUY` du Signal si les
  règles de risque ne sont pas respectées.
- **Exécuteur** — `PaperExecutor` en phase 1 : simule le fill au prix courant
  et enregistre la position. `JupiterExecutor` en phase 2 (hors scope de cette
  spec).
- **Store (SQLite)** — historique des trades, positions ouvertes, logs de
  décision (y compris les rejets, pour analyse ultérieure).
- **Config** — fichier unique (JSON) centralisant tous les seuils : liquidité
  min, âge min du pool, paramètres RSI/MA, % SL/TP/trailing, taille max de
  position, capital simulé, intervalle de scan.

### Flux de données (un cycle)

1. Scanner interroge GeckoTerminal → liste de pools avec métriques.
2. Filtre élimine les pools sous les seuils → réduit le nombre de pools à
   analyser en détail.
3. Signal calcule les indicateurs sur les pools restants → décision + raison.
4. Si `BUY` : Gestion du risque valide (capital dispo, taille de position,
   niveaux SL/TP/trailing) ou rejette.
5. Si validé : Exécuteur simule le fill, Store enregistre la position ouverte.
6. À chaque cycle, les positions déjà ouvertes sont réévaluées : clôture
   simulée si SL, TP ou trailing stop atteint.
7. Toute décision (achat, vente, rejet, erreur) est loggée.

## Gestion des erreurs et sécurité

- Résilience API : erreur/timeout GeckoTerminal → log + cycle suivant sans
  planter ; retry avec backoff léger.
- Données incomplètes ou aberrantes (prix nul, historique trop court pour le
  RSI) → pool automatiquement écarté.
- Kill switch : arrêt propre du bot à tout moment (termine le cycle en cours,
  n'entre pas de nouvelle position).
- Garde-fous futurs (phase 2, hors scope ici mais à anticiper dans le design) :
  limites strictes de montant par trade et de nombre de positions ouvertes,
  codées en dur en plus de la config.
- Clé privée du wallet : non applicable en phase 1 (pas d'exécution réelle) ;
  quand elle sera introduite en phase 2, elle sera chargée depuis `.env`
  (jamais commit), jamais en dur dans le code.
- Logs d'audit : chaque décision tracée avec son raisonnement.

## Stratégie de test

1. **Tests unitaires** par module (indicateurs sur séries de prix connues,
   filtre sur seuils, calcul de taille de position par la gestion du risque).
2. **Backtesting** sur bougies OHLCV historiques (GeckoTerminal) pour mesurer
   la performance de la stratégie avant tout run en direct.
3. **Paper trading en direct** : le bot tourne en simulation sur données de
   marché réelles en temps réel, sans exécution réelle, pendant une période
   d'observation.
4. Le passage en argent réel (phase 2, capital < 100$, `JupiterExecutor`) ne
   sera envisagé qu'après ces trois étapes concluantes — fera l'objet d'une
   spec séparée.

## Hors scope (explicitement reporté)

- Exécution réelle on-chain (Jupiter Swap API, wallet, clé privée active).
- Sniping de nouveaux tokens / scanner temps réel par websocket ou RPC.
- Notifications (Telegram/Discord) — pourra être ajouté après validation du
  paper trading si utile.
