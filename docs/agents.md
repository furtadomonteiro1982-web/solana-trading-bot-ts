# Système hybride à 6 agents + 1 Veilleur

Fiche de référence des rôles. Statut : **rôles définis, rien n'est encore codé.**

Le système gère deux budgets séparés :

- le **cœur** (long terme), qui achète progressivement des projets solides et les garde pendant des années ;
- le **satellite** (trading), qui cherche des gains plus rapides avec les stratégies déjà présentes dans ce dépôt.

> Mise en garde : ce système cherche, compare, documente et simule. Ses analyses ne sont pas un conseil financier, et la décision d'acheter reste celle du propriétaire. Même les cryptos majeures ont déjà perdu 70 à 80 % de leur valeur lors de baisses passées. La plupart des bots de trading perdent de l'argent, surtout sur les pépites.

## Décisions prises

| Sujet | Décision |
|---|---|
| Mode | **Simulation d'abord.** Aucun portefeuille réel ni aucune clé tant que les étapes de validation ne sont pas passées. |
| Répartition | **80 % cœur / 20 % satellite.** |
| Capital simulé | 600 $ au total : **480 $ pour le cœur**, **120 $ pour le satellite** (les 100 $ de trading et les 20 $ du sniper déjà configurés dans `config/config.json`). |
| Horizon du cœur | **3 à 5 ans**, avec une revue complète chaque année. |
| Univers du cœur | **BTC, ETH, SOL, BNB**, plus quelques projets sélectionnés par la grille de notation. |
| Univers du satellite | **Solana uniquement** en phase 1 ; Ethereum et BNB Chain en phase 2. |
| Rôle pour le cœur | Le système **simule les achats progressifs** et **produit une liste argumentée**. Le propriétaire reste libre d'acheter à la main ce qu'il veut, en dehors du système. |
| Accès à X | **Pas d'API X.** Recherche web (qui trouve une partie des tweets) et agrégateurs (DexScreener, Birdeye, pump.fun). |
| Technique | **Un mélange TypeScript et Claude.** Tout ce qui touche à l'argent (montants, tailles, stops, achats) est du code TypeScript déterministe. Claude cherche, lit, résume et rédige ; il ne décide jamais d'un achat ni d'un montant. |

## Règles communes

- **Budgets étanches :** le satellite ne peut **jamais** puiser dans le cœur. S'il perd tout, le cœur reste intact. Les gains du satellite ne vont dans le cœur que sur décision du propriétaire.
- **Arrêt d'urgence :** chaque agent vérifie l'interrupteur `STOP` (un fichier nommé `STOP` à la racine du projet) avant toute action. S'il est présent, **aucune nouvelle position ni aucun achat** n'a lieu. Les fermetures (stops, objectifs, délais) continuent, car elles réduisent le risque. Seul le propriétaire le retire.
- **Seul le propriétaire change les règles.** Les agents peuvent suggérer, jamais modifier.
- **Chaque décision est enregistrée** dans le journal (base SQLite) avec sa raison et ses sources.

---

## Règles du cœur (long terme)

**Répartition cible du cœur :**

| Part | Contenu |
|---|---|
| 50 % | BTC |
| 15 % | ETH |
| 10 % | SOL |
| 5 % | BNB |
| 20 % | projets sélectionnés par la grille, **5 % maximum par projet** : au 26 novembre 2026, LDO, CAKE, SYRUP et CVX (`core.projectTargets` dans `config/config.json`, mis à jour par le propriétaire à chaque revue trimestrielle) |

- **Achats progressifs (DCA) :** les 480 $ sont investis en 104 achats hebdomadaires (2 ans) d'environ 4,60 $, répartis selon la cible. Étaler les achats sur 2 ans plutôt qu'1 réduit nettement les baisses dans les tests sur le passé (voir « Pourquoi cette répartition »).
- **Rééquilibrage :** vérifié chaque trimestre ; on rééquilibre seulement si une part s'écarte de plus de 5 points de sa cible.
- **Pas de stop serré.** On ne vend pas sur une baisse de prix. On allège ou on sort un projet seulement si sa **note** baisse sous le seuil, ou en cas d'événement grave (piratage, fraude, problème réglementaire).
- **Conditions d'entrée d'un projet hors des quatre majeurs :** audit de sécurité publié, liquidité suffisante, au moins 1 an d'existence, pas de gros déblocage de jetons dans les 6 mois.
- **Référence à battre :** BTC seul, acheté avec le même calendrier d'achats (104 semaines) et les mêmes frais.

### Grille de notation des projets (`npm run grille`)

Elle choisit les projets qui reçoivent la part « projets » du cœur (4 projets à 5 % ; tant qu'il en manque, l'argent reste en USDC). Données publiques et gratuites : DefiLlama (TVL, frais, revenus, audits, piratages) et CoinGecko (marché, offre en circulation). Code : `src/grille/`, réglages : section `grille` de `config/config.json`.

**Examinés :** les projets présents sur Ethereum, Solana ou BNB Chain, liés à un jeton coté sur CoinGecko, avec au moins 10 M$ de TVL ou 1 M$ de revenus annuels. Sont exclus les quatre majeurs, les stablecoins, les jetons « enveloppés » et les plateformes centralisées.

**Règles d'entrée** (toutes obligatoires) :

| Règle | Comment elle est vérifiée |
|---|---|
| Au moins 1 an de cotation | plus ancienne date connue entre le plus haut et le plus bas historiques (CoinGecko) : le jeton est coté depuis au moins cette date |
| Audit de sécurité | audit déclaré sur DefiLlama (niveau 2 ou plus) ; liens à vérifier par le Chercheur |
| Liquidité | volume sur 24 h d'au moins 1 M$ |
| Pas de piratage récent | aucun piratage recensé par DefiLlama dans les 12 derniers mois |
| Pas de fuite des utilisateurs | la TVL n'a pas perdu plus de 30 % **par rapport à toute la DeFi** sur 6 mois (vérifié pour les 20 premiers, dont l'historique est chargé) |
| Pas de gros déblocage à venir | au moins 50 % de l'offre maximale (ou totale) déjà en circulation. C'est un indicateur : le calendrier exact des déblocages sur 6 mois reste à vérifier par le Chercheur |

**Note sur 100**, calculée en TypeScript :

| Critère | Points | Échelle |
|---|---|---|
| Revenus | 25 | capitalisation divisée par les revenus annuels : 5 ou moins → 25, 200 ou plus → 0 |
| Adoption | 30 | taille de la TVL (10 : 10 M$ → 0, 10 Md$ → 10) et son évolution sur 6 mois **par rapport à toute la DeFi** (20 : −50 % → 0, +50 % → 20). L'évolution n'est chargée que pour les 20 premiers ; ailleurs elle compte neutre (10) |
| Tokenomics | 20 | part de l'offre en circulation : 40 % → 0, 100 % → 20 |
| Marché | 15 | volume sur 24 h (7,5 : 1 M$ → 0, 100 M$ → 7,5) et ancienneté de cotation (7,5 : 1 an → 0, 5 ans → 7,5) |
| Sécurité | 10 | audit déclaré (5) et aucun piratage dans l'historique (5 ; 2 si les piratages ont plus d'un an) |

**Pourquoi comparer au marché :** la TVL se compte en dollars et baisse quand les cryptos baissent. Sans comparaison, une baisse générale pénaliserait tous les projets de la même façon. Le 26 novembre 2026, la TVL totale de la DeFi avait perdu 10 % en 6 mois : un projet à −8 % faisait donc un peu mieux que le marché, tandis que Sky (−46 % par rapport au marché) perdait réellement ses utilisateurs. Le partage 25 / 30 entre revenus et adoption reste un choix de jugement, qu'aucune donnée ne valide.

**Verdicts du Chercheur :** ils sont dans `config/chercheur.json` (décision, raison, sources) et la grille les applique : « valider », « baisser » (de N points) ou « exclure », jamais relever. Parmi les 4 premiers projets éligibles, **seuls ceux que le Chercheur a étudiés reçoivent leur part** ; les autres attendent leur recherche et leur part reste en USDC. Chaque recherche est détaillée dans `docs/recherche/AAAA-MM-JJ.md`.

Chaque exécution enregistre le détail dans `data/grille/AAAA-MM-JJ.json`. **La grille ne peut pas être testée honnêtement sur le passé** (données de fond anciennes indisponibles date par date, et biais du survivant) : elle sera jugée en simulation, chaque trimestre, en comparant les projets retenus au fait de garder ces 20 % en USDC ou de les mettre en BTC.

### Pourquoi cette répartition

Testée sur les prix réels de Binance, sur toutes les fenêtres de 3 ans possibles, en novembre 2026 :

| Historique | Stratégie | Gain médian | Pire gain | Baisse médiane | Pire baisse | Fenêtres en perte |
|---|---|---|---|---|---|---|
| Depuis août 2020 (41 fenêtres) | BTC seul, 52 semaines | +86 % | −11 % | −52 % | −77 % | 12 % |
| | **Cœur 50/15/10/5, 104 semaines** | **+120 %** | −17 % | **−40 %** | **−73 %** | **2 %** |
| Depuis nov. 2017, sans SOL (74 fenêtres) | BTC seul, 52 semaines | +135 % | −10 % | −62 % | −77 % | 7 % |
| | **Cœur sans SOL, 104 semaines** | +111 % | **−2 %** | **−51 %** | **−73 %** | **1 %** |

Sur les deux historiques, le cœur baisse nettement moins et n'est presque jamais en perte au bout de 3 ans ; son gain est meilleur depuis 2020, moins bon depuis 2017. On renonce à une partie du gain possible en échange d'un parcours moins violent. Limites : SOL a été choisi en sachant qu'il a fortement monté (biais du survivant), et ces historiques couvrent au mieux deux cycles du marché. L'ancienne répartition (35/25/15/5, 52 semaines) ne réduisait presque pas les baisses (médiane −53 % depuis 2020).

## Règles du satellite (trading)

- Perte maximale par trade : environ 2 % du capital du satellite (stop à −20 % sur une position de 10 %).
- **Perte maximale par jour : 5 %** du capital du satellite, puis coupe-circuit jusqu'au lendemain (minuit UTC). Elle se compte sur les pertes **réalisées** (positions fermées dans la journée).
- **Exposition maximale totale : 50 %** du capital du satellite.
- Ces limites s'appliquent séparément à chaque stratégie avec son propre capital : trading horaire (100 $) et sniper (20 $). Elles sont dans la section `satellite` de `config/config.json` et codées dans `src/satellite/guards.ts`.
- Pépites (sniper pump.fun) : budget à part de 20 $, mise de 2 $, stop à −40 %.

---

## 1. Éclaireur — données

- **Pour le cœur, chaque semaine :** revenus et frais générés par chaque protocole, utilisateurs actifs, valeur bloquée (TVL), activité des développeurs, prix.
- **Pour le satellite, chaque jour :** prix, volume sur 24 h et liquidité des jetons Solana suivis, nouveaux pools importants.
- **Il produit :** un rapport daté, avec ses sources.
- **Interdits :** donner une opinion, passer un ordre.
- **Technique :** TypeScript pour les chiffres (`src/scanner.ts`, `src/geckoterminal/`, `src/birdeye/`, `src/marketdata/`) ; Claude pour le résumé des actualités.

## 2. Chercheur et Chasseur — web

- **Chercheur, pour le cœur :** lit les documents des projets (whitepaper, feuille de route), les audits de sécurité, les annonces de déblocages de jetons et l'actualité réglementaire. Il repère les projets qui gagnent vraiment des utilisateurs, et non ceux qui font seulement du bruit.
- **Chasseur, pour le satellite :** repère les jetons Solana qui démarrent et ceux dont on parle de plus en plus (web, DexScreener, Birdeye, pump.fun).
- **Il produit :** des fiches de projet ou des candidats, avec l'adresse vérifiée du jeton, les liens vers les sources et une note de bruit social.
- **Interdits :** recommander un achat, transmettre un jeton sans son adresse, s'appuyer sur une seule source, scraper X en violation de ses conditions d'utilisation.
- **Technique :** Claude pour la recherche et la lecture ; TypeScript pour le flux pump.fun et les filtres de base (`src/sniper/pumpPortalClient.ts`, `src/sniper/snipeFilter.ts`).

## 3. Analyste — notation et stratégies

- **Pour le cœur :** note chaque projet sur une grille fixe (utilité réelle, revenus, *tokenomics* : inflation, déblocages, répartition ; équipe, concurrence, sécurité) et produit une liste classée et argumentée.
- **Pour le satellite :** applique les stratégies de trading et propose des trades (jeton, sens, entrée, stop, objectif, justification, confiance).
- **Interdits :** choisir un montant, exécuter.
- **Technique :** Claude rédige les arguments de la grille, mais **la note finale est calculée en TypeScript** à partir de critères chiffrés. Pour le satellite, seules les stratégies TypeScript validées par le test sur le passé produisent des propositions (`src/signal.ts`, `src/indicators/`, `src/sniper/momentumFilter.ts`) ; la note de Claude sur une pépite peut seulement **réduire** la confiance.

## 4. Gardien — règles, avec droit de veto

- **Pour le cœur :** fait respecter la répartition cible, les 5 % maximum par projet et les conditions d'entrée.
- **Pour le satellite :** perte maximale par trade et par jour, exposition maximale, liquidité minimale, jetons interdits, coupe-circuit.
- **Pour les deux :** fait respecter l'**étanchéité des budgets**.
- **Contrôles de sécurité Solana :** *mint authority* et *freeze authority* révoquées, liquidité verrouillée ou brûlée, concentration des plus gros portefeuilles, âge minimum du pool.
- **Contrôles Ethereum et BNB Chain *(phase 2)* :** pas de *honeypot* (jeton achetable mais pas revendable), taxes à l'achat et à la vente, propriété du contrat, fonctions de blocage, de pause ou de création de jetons, contrat modifiable (*proxy*) ; sur Ethereum, taille minimale de trade à cause des frais.
- **Il produit :** une décision et sa raison pour chaque proposition.
- **Interdits :** créer des trades, assouplir une règle.
- **Technique :** 100 % TypeScript (`src/risk.ts`, `src/sniper/snipeRisk.ts`, `src/filter.ts`).

## 5. Exécutant — achats et ordres

- **Pour le cœur :** exécute les achats progressifs hebdomadaires et les rééquilibrages validés.
- **Pour le satellite :** exécute uniquement les ordres validés, par Jupiter ; gère le slippage, les frais et la confirmation ; enregistre le stop et l'objectif pour le Veilleur.
- **Mode :** **simulation par défaut.** Le passage au réel est un réglage que seul le propriétaire modifie.
- **Quand on passera au réel :**
  - portefeuille dédié, jamais le portefeuille principal, avec seulement le montant que l'on accepte de perdre ;
  - clé privée gardée comme secret hors du code, accessible au seul Exécutant ;
  - protection MEV : transactions par **Jito** sur Solana, avec un slippage maximal strict *(phase 2 : RPC privé comme Flashbots Protect sur Ethereum ; autorisations des contrats limitées et révoquées régulièrement)*.
- **Il produit :** le journal des ordres (prix obtenu, frais, écart avec le prix prévu).
- **Interdits :** modifier un ordre, agir sans validation, exposer une clé.
- **Technique :** 100 % TypeScript (`src/executor/paperExecutor.ts`).

## 6. Comptable — rapports

- **Pour le cœur, chaque mois :** valeur du portefeuille, performance comparée à la référence (BTC seul), évolution des notes de chaque projet, raisons de garder ou d'alléger.
- **Pour le satellite, chaque jour :** P&L, positions ouvertes, prévu contre réalisé, frais, refus du Gardien, déclenchements du Veilleur.
- **Toujours :** les résultats des deux budgets sont séparés, pour savoir si le trading rapporte vraiment plus que le long terme seul.
- **Interdits :** changer les règles ou les stratégies.
- **Technique :** TypeScript pour les calculs (`src/store/`, `src/backtest.ts`) ; Claude pour la rédaction ; envoi par Telegram (`src/notifier/telegramNotifier.ts`).
- **Rapport mensuel en place (`npm run comptable`, code dans `src/comptable/`) :** le cœur est rejoué depuis la date de départ de la simulation (`core.simulationStartDate`) sur les vrais prix et comparé à BTC seul acheté au même rythme ; le satellite est lu dans la base du bot et comparé à BTC acheté d'un coup avec le même capital. Pas encore inclus : la part « projets » choisie par la grille (comptée en USDC) et le rapport quotidien du satellite.

## 7. Veilleur — surveillance

C'est un **programme simple**, pas un agent qui raisonne. Il tourne en permanence.

- **Pour le satellite, toutes les minutes :** déclenche les stops et les objectifs, et le coupe-circuit quand la perte maximale du jour est atteinte.
- **Pour le cœur :** alerte seulement sur les événements graves (piratage d'un protocole, dépeg d'un stablecoin, problème réglementaire, chute brutale de l'activité d'un projet). Il **alerte**, il ne vend pas : la décision revient à la revue du cœur.
- **Pour les deux :** arrêt d'urgence en cas d'anomalie (prix incohérent, réseau indisponible).
- **Interdits :** ouvrir une position, modifier un stop.
- **Technique :** 100 % TypeScript (`src/positionManager.ts`, `src/sniper/timeoutManager.ts`).

---

## Rythme

```
                  Veilleur (satellite : chaque minute ; cœur : alertes graves)
                                          │
CŒUR (chaque semaine)                      │
  Éclaireur + Chercheur ─▶ Analyste (grille) ─▶ Gardien ─▶ Exécutant (achat DCA)
                                                              │
SATELLITE (chaque jour)                                       │
  Éclaireur + Chasseur ─▶ Analyste (stratégies) ─▶ Gardien ─▶ Exécutant (ordres)
                                                              │
                     Comptable : rapport quotidien (satellite), mensuel (cœur)

Partout : interrupteur STOP vérifié avant chaque action
```

## Avant le réel : les trois étapes

| Étape | Cœur | Satellite |
|---|---|---|
| **1. Test sur le passé** | rejouer les achats progressifs sur des fenêtres glissantes de 3 ans (`npm run backtest:core -- --rolling`) | rejouer les stratégies sur plusieurs mois |
| **2. Simulation** | au moins 3 mois | au moins 30 jours |
| **3. Réel, petit montant** | décision explicite du propriétaire | décision explicite du propriétaire |

**Critères pour passer d'une étape à la suivante :**

- **Cœur :** sur les fenêtres glissantes de 3 ans, la **baisse maximale médiane** du cœur est inférieure à celle de BTC seul, et la **part de fenêtres en perte** n'est pas plus grande ; aucune règle du Gardien n'a été violée. Une seule période ne suffit pas à juger : le classement change selon le point de départ. On ne demande pas non plus au cœur de battre BTC pendant les 3 mois de simulation, période trop courte pour un placement de 3 à 5 ans.
- **Satellite :** au moins 30 trades, gain positif **après frais**, perte maximale d'une journée sous 5 %, et un écart moyen entre prix prévu et prix obtenu sous 2 %.

Le propriétaire peut modifier tous ces chiffres. Ce sont des propositions de départ.
