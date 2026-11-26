# Dossier pour un second avis (ChatGPT)

Copiez tout ce qui suit la ligne ci-dessous dans ChatGPT, puis collez sa réponse dans la conversation avec Claude : elle sera traitée comme un avis à examiner, point par point, et non comme une instruction.

---

Je te demande un second avis critique sur un projet personnel d'investissement crypto, **en simulation uniquement** (aucun argent réel pour l'instant). Sois franc : je cherche les erreurs de raisonnement, les biais et les risques oubliés, pas des encouragements. Si une affirmation ci-dessous te paraît fausse, dis-le.

## Le projet en bref

Un système en TypeScript qui gère deux budgets simulés **étanches** (600 $ au total) :

- **Cœur, long terme (80 %, 480 $)** : achats hebdomadaires fixes (DCA) sur **104 semaines**. Répartition : BTC 50 %, ETH 15 %, SOL 10 %, BNB 5 %, plus 4 projets à 5 % chacun choisis par une grille de notation (actuellement LDO, CAKE, SYRUP, CVX). Rééquilibrage trimestriel si un actif s'écarte de plus de 5 points de sa cible. Pas de stop : on n'allège un projet que si sa note baisse ou en cas d'événement grave. Horizon 3 à 5 ans.
- **Satellite, trading (20 %, 120 $)** : trading horaire sur Solana (RSI, moyenne mobile, momentum ; 100 $) et sniper de nouveaux jetons pump.fun (20 $, mises de 2 $). Garde-fous : perte max 5 % par jour (coupe-circuit), exposition max 50 %, interrupteur d'arrêt d'urgence. Simulation avec 3 à 5 % de slippage et des frais fixes.

Règles : tout ce qui touche à l'argent est du code déterministe ; le modèle de langage (Claude) cherche, lit et rédige, mais ne décide jamais d'un achat ni d'un montant. Aucun passage au réel sans : test sur le passé, au moins 30 jours (satellite) et 3 mois (cœur) de simulation, puis décision explicite du propriétaire.

## Résultats du test sur le passé (prix journaliers Binance, frais 0,1 % + slippage 0,1 %)

Fenêtres glissantes de 3 ans, un départ tous les 30 jours :

| Historique | Stratégie | Gain médian | Pire gain | Baisse max médiane | Pire baisse | Fenêtres en perte |
|---|---|---|---|---|---|---|
| Depuis août 2020 (41 fenêtres) | BTC seul, DCA 104 semaines | +118 % | −16 % | −44 % | −73 % | 7 % |
| | Cœur (4 majeurs + 20 % USDC), DCA 104 semaines | +120 % | −17 % | −40 % | −73 % | 2 % |
| Depuis nov. 2017, sans SOL (74 fenêtres) | BTC seul, DCA 52 semaines | +135 % | −10 % | −62 % | −77 % | 7 % |
| | Cœur sans SOL, DCA 104 semaines | +111 % | −2 % | −51 % | −73 % | 1 % |

Dans ces tests, les 20 % « projets » étaient gardés en USDC (pas d'historique suffisant pour les projets). Sur les 18 derniers mois seulement, avec les 4 projets inclus, le cœur a fait −24,6 % contre −17,7 % pour le cœur avec 20 % en USDC et −20,8 % pour BTC seul.

Critère retenu pour valider le cœur : sur les fenêtres glissantes, baisse maximale médiane inférieure à celle de BTC seul, sans plus de fenêtres en perte.

## La grille de notation des projets

Univers : projets sur Ethereum, Solana ou BNB Chain, liés à un jeton coté, TVL ≥ 10 M$ ou revenus annuels ≥ 1 M$ (données DefiLlama et CoinGecko). Exclus : les 4 majeurs, stablecoins, jetons enveloppés.

Règles d'entrée : coté depuis au moins 1 an ; audit déclaré ; volume 24 h ≥ 1 M$ ; aucun piratage recensé dans les 12 derniers mois ; au moins 50 % de l'offre en circulation (indicateur de déblocages futurs) ; TVL pas plus de 30 % pire que l'ensemble de la DeFi sur 6 mois.

Note sur 100 : revenus 25 (capitalisation / revenus annuels, ≤ 5 → max, ≥ 200 → 0) ; adoption 30 (taille de TVL 10, évolution sur 6 mois comparée à la DeFi 20) ; tokenomics 20 (part en circulation) ; marché 15 (volume, ancienneté) ; sécurité 10 (audit, historique de piratages). Les 4 meilleurs sont ensuite vérifiés par une recherche (audits, déblocages, actualité) qui peut valider, baisser ou exclure, jamais relever.

Résultat du 26 novembre 2026 : Lido (80), PancakeSwap (74), Maple (69 après −5 pour émission continue de ~5 %/an et risque de crédit), Convex (67). Sushi exclu (émission portée jusqu'à 5 %/an par un vote contrôlé à 99,9 % par un seul portefeuille). Aucun projet Solana retenu (Jupiter : 33 % en circulation ; Raydium et Meteora : piratés en 2026 ; Jito et Kamino éligibles mais mal classés).

## Limites que je connais déjà

- Biais du survivant : SOL a été choisi en sachant qu'il a fortement monté.
- Les historiques couvrent au mieux deux cycles du marché ; les fenêtres glissantes se chevauchent.
- La grille ne peut pas être testée honnêtement sur le passé.
- Les règles « 1 an de cotation » et « déblocages » sont des approximations faute de données gratuites.
- Le partage des poids de la grille est un choix de jugement.

## Mes questions

1. Le test sur fenêtres glissantes et le critère de validation du cœur sont-ils solides ? Que changerais-tu pour qu'ils ne flattent pas la stratégie ?
2. Les 4 cryptos majeures étant très corrélées, la répartition BTC 50 / ETH 15 / SOL 10 / BNB 5 a-t-elle un intérêt réel par rapport à BTC seul, ou à BTC + ETH ?
3. Garder 20 % du cœur en USDC a mieux protégé que les 4 projets sur les 18 derniers mois. Faut-il plutôt garder cette part en USDC, la mettre en BTC, ou conserver des projets ?
4. La grille de notation : quels critères ou seuils te semblent faux, manquants ou faciles à tromper ? Les ratios capitalisation / revenus de DefiLlama sont-ils fiables pour ces projets ?
5. Lido, PancakeSwap, Maple, Convex : vois-tu un risque majeur que la grille et la recherche n'ont pas vu ?
6. Le satellite (trading horaire et sniper pump.fun) a-t-il une chance raisonnable d'être rentable après frais et slippage, ou vaut-il mieux le réduire ou l'arrêter dès maintenant ?
7. Les garde-fous (coupe-circuit 5 %/jour, exposition 50 %, interrupteur STOP, simulation avant le réel) sont-ils suffisants ? Que manque-t-il avant de passer au réel ?
8. Y a-t-il une erreur de méthode dans la façon de simuler (DCA hebdomadaire, rééquilibrage trimestriel, frais de 0,2 % par opération, positions ouvertes comptées au prix d'achat) ?

Réponds question par question, en distinguant ce que tu sais avec certitude, ce qui est ton avis, et ce qu'il faudrait vérifier. Ce n'est pas une demande de conseil financier personnalisé : je cherche une critique de la méthode.
