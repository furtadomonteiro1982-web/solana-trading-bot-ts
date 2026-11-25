# Système de trading à 6 agents + 1 Veilleur

Fiche de référence des rôles. Statut : **rôles définis, rien n'est encore codé.**

## Périmètre

- **Phase 1 : Solana uniquement.**
  - Jetons suivis : les 20 jetons les plus liquides (recalculés chaque semaine, sans stablecoins), plus les pépites repérées par le Chasseur.
  - Monnaie de base : USDC.
  - DEX : Jupiter (agrégateur), Raydium, Orca.
  - Nouveaux lancements : pump.fun et nouveaux pools Raydium.
  - Explorateur : Solscan.
- **Phase 2 : Ethereum et BNB Chain**, une fois la phase 1 validée en réel. Les règles prévues pour eux restent dans cette fiche, marquées *(phase 2)*.

| Phase 2 | Ethereum | BNB Chain |
|---|---|---|
| DEX principaux | Uniswap, Curve (agrégateur : 1inch) | PancakeSwap |
| Explorateur | Etherscan | BscScan |
| Coût d'une transaction | élevé | faible |

## Règles communes à tous les agents

- **Arrêt d'urgence :** chaque agent vérifie l'interrupteur `STOP` avant toute action. S'il est activé, plus rien ne s'exécute. Seul le propriétaire peut le désactiver.
- **Seul le propriétaire change les règles.** Les agents peuvent suggérer, jamais modifier.
- **Chaque décision est enregistrée** avec sa raison et ses sources.

---

## 1. Éclaireur — veille des marchés

- **Rôle :** collecter chaque matin les faits sur Solana.
- **Ce qu'il collecte :**
  - prix, volume sur 24 h et liquidité de chaque jeton suivi ;
  - activité on-chain : gros transferts, entrées et sorties des plateformes d'échange, nouveaux pools importants ;
  - contexte général : tendance du marché, dominance de BTC, événements du jour.
- **Il produit :** un rapport de marché daté, avec ses sources.
- **Interdits :** donner une opinion, passer un ordre.

## 2. Chasseur de pépites — web et X

- **Rôle :** repérer les jetons Solana qui démarrent et ceux dont on parle de plus en plus.
- **Où il cherche :** X, actualités crypto, DexScreener, Birdeye, pump.fun.
- **Il produit :** des candidats, avec pour chacun :
  - l'adresse vérifiée du jeton (*mint*) et son âge ;
  - la raison du buzz et les liens vers les sources ;
  - une note de bruit social.
- **Interdits :**
  - recommander un achat ;
  - transmettre un jeton sans son adresse ;
  - s'appuyer sur une seule source ;
  - scraper X en violation de ses conditions d'utilisation.

## 3. Analyste — stratégie

- **Rôle :** croiser les faits de l'Éclaireur et les candidats du Chasseur, puis appliquer les stratégies.
- **Il produit :** des propositions de trades. Pour chacune :
  - jeton, sens (achat ou vente) ;
  - prix d'entrée, stop, objectif ;
  - justification et niveau de confiance ;
  - catégorie : **majeur** ou **pépite**.
- **Interdits :** choisir la taille de position, exécuter, proposer un jeton sans liquidité suffisante.
- **Condition :** seules les stratégies **validées par le test sur le passé** peuvent être utilisées (voir « Avant le réel »).

## 4. Gardien — risque, avec droit de veto

- **Rôle :** accepter, réduire ou refuser chaque proposition.
- **Règles générales :**
  - perte maximale par trade et par jour *(à définir)* ;
  - exposition maximale totale et par jeton *(à définir)* ;
  - liquidité minimale ;
  - liste de jetons interdits ;
  - coupe-circuit quotidien.
- **Contrôles de sécurité Solana :**
  - *mint authority* et *freeze authority* révoquées ;
  - liquidité verrouillée ou brûlée ;
  - concentration des plus gros portefeuilles ;
  - âge minimum du pool.
- **Contrôles Ethereum et BNB Chain *(phase 2)* :**
  - vérifier que le jeton n'est pas un *honeypot* (achetable mais pas revendable) ;
  - vérifier les taxes à l'achat et à la vente ;
  - vérifier la propriété du contrat : abandonnée, ou non ;
  - repérer les fonctions de blocage (*blacklist*), de pause ou de création de jetons (*mint*) ;
  - vérifier si le contrat est modifiable (*proxy*) ;
  - Ethereum : taille minimale de trade, pour que les frais ne mangent pas le gain.
- **Règle particulière :** pour les pépites, la taille de position est réduite à 10 à 20 % de la taille normale.
- **Il produit :** une décision et sa raison pour chaque proposition.
- **Interdits :** créer des trades, assouplir une règle.

## 5. Exécutant — ordres

- **Rôle :** exécuter uniquement les ordres validés, par Jupiter.
- **Ce qu'il gère :** slippage, frais, confirmation de la transaction.
- **Il enregistre aussi** le stop et l'objectif de chaque position, pour que le Veilleur puisse les surveiller.
- **Protection MEV :** les transactions passent par **Jito**, avec un slippage maximal strict. *(Phase 2 : Ethereum par un RPC privé, comme Flashbots Protect.)*
- **Portefeuille dédié :**
  - un portefeuille réservé au bot, jamais le portefeuille principal ;
  - il ne contient que le montant que l'on accepte de perdre ;
  - la clé privée est un secret hors du code, et seul l'Exécutant y a accès ;
  - *(phase 2)* sur Ethereum et BNB Chain, autorisations (*approvals*) limitées et révoquées régulièrement.
- **Mode :** **simulation par défaut**. Le passage au réel est un réglage que seul le propriétaire modifie.
- **Il produit :** le journal des ordres : signature de transaction, prix obtenu, frais, écart avec le prix prévu.
- **Interdits :** modifier un ordre, trader sans validation, exposer la clé.

## 6. Comptable — rapport et audit

- **Rôle :** clôturer la journée.
- **Il produit :**
  - le P&L total et par catégorie (majeur ou pépite) ;
  - les positions ouvertes ;
  - la comparaison entre prévu et réalisé ;
  - les frais payés ;
  - les erreurs et refus de chaque agent ;
  - les déclenchements du Veilleur ;
  - des suggestions pour le lendemain.
- **Interdits :** changer les règles ou les stratégies.

## 7. Veilleur — surveillance en continu

C'est un **programme simple**, pas un agent qui raisonne. Il tourne en permanence, 24 h/24.

- **Rôle :** surveiller toutes les positions ouvertes, toutes les minutes.
- **Il déclenche :**
  - les **stops** et les **objectifs**, en envoyant un ordre de vente à l'Exécutant ;
  - le **coupe-circuit** quand la perte maximale du jour est atteinte ;
  - l'**arrêt d'urgence** en cas d'anomalie : prix incohérent, réseau indisponible, perte soudaine.
- **Interdits :** ouvrir une position, modifier un stop.

---

## Cycle quotidien

```
           ┌──────────── Veilleur (24 h/24 : stops, coupe-circuit) ────────────┐
           │                                                                  │
Matin   Éclaireur (faits)  +  Chasseur (pépites)                              │
          └──────────┬──────────┘                                             │
Midi             Analyste ──▶ Gardien ──▶ Exécutant ◀─────────────────────────┘
                                              │
Soir                                      Comptable ──▶ rapport

Partout : interrupteur STOP vérifié avant chaque action
```

## Avant le réel : les trois étapes

| Étape | Durée | Condition pour passer à la suivante |
|---|---|---|
| **1. Test sur le passé** | plusieurs mois de données passées | gain positif après frais, perte maximale sous la limite fixée |
| **2. Simulation** | au moins 30 jours | mêmes critères, et l'écart entre prévu et réalisé reste acceptable |
| **3. Réel, petit montant** | portefeuille dédié avec peu de fonds | décision explicite du propriétaire, après les rapports du Comptable |

Les critères chiffrés (gain minimum, perte maximale, nombre minimum de trades) sont à fixer avant de commencer.

## Décisions prises

- **Simulation d'abord.** Aucun portefeuille réel ni aucune clé tant que les étapes 1 et 2 ne sont pas validées.
- **Pas d'API X.** Le Chasseur s'appuie sur la recherche web (qui trouve une partie des tweets) et sur les agrégateurs (DexScreener, Birdeye, pump.fun).
- **Un mélange TypeScript et Claude**, avec une règle : **tout ce qui touche à l'argent est du code TypeScript déterministe.** Claude cherche, résume et rédige ; il ne décide jamais d'un trade, d'une taille ou d'un stop. Cela permet aussi de tester les stratégies sur le passé : un raisonnement de Claude ne se rejoue pas de façon fiable sur des données anciennes.

## Qui fait quoi : TypeScript ou Claude

| Agent | TypeScript | Claude | Code déjà présent dans le dépôt |
|---|---|---|---|
| **Éclaireur** | prix, volumes, liquidité, pools | résumé du contexte du jour (actualités) | `src/scanner.ts`, `src/geckoterminal/`, `src/birdeye/`, `src/marketdata/` |
| **Chasseur** | flux pump.fun, filtres de base | recherche web, note de bruit social, sources | `src/sniper/pumpPortalClient.ts`, `src/sniper/snipeFilter.ts` |
| **Analyste** | stratégies et indicateurs (seuls à produire des propositions) | note qualitative sur les pépites, qui ne peut que **réduire** la confiance | `src/signal.ts`, `src/indicators/`, `src/sniper/momentumFilter.ts` |
| **Gardien** | 100 % | — | `src/risk.ts`, `src/sniper/snipeRisk.ts`, `src/filter.ts` |
| **Exécutant** | 100 % (simulation) | — | `src/executor/paperExecutor.ts` |
| **Veilleur** | 100 % | — | `src/positionManager.ts`, `src/sniper/timeoutManager.ts` |
| **Comptable** | calcul du P&L, des frais et des statistiques | rédaction du rapport du soir | `src/store/`, `src/notifier/telegramNotifier.ts`, `src/backtest.ts` |

## Encore à définir avant de coder

1. Les limites de risque : perte maximale par trade et par jour, exposition maximale totale.
2. Les critères chiffrés de passage entre les étapes (test sur le passé, simulation, réel).

> Mise en garde : la plupart des bots de trading perdent de l'argent, surtout sur les pépites. Ce système sert d'abord à limiter les pertes et à mesurer si une stratégie fonctionne. Il ne garantit aucun gain.
