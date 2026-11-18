# Passage « avant-ouverture » (9 h 15 New York)

Lis d'abord `ops/passes/_regles.md` et applique-le.

1. `python3 ops/pile.py etat --passe avant-ouverture`
   - Code 3 (pas de bourse ou pause) : `python3 ops/pile.py fin avant-ouverture --saute "<raison affichée>"`, puis arrête-toi.
   - Si l'état montre que le **bilan d'hier manque** (dernier bilan plus ancien que le dernier jour de bourse), lance `python3 ops/pile.py erreur avant-ouverture "bilan d'hier absent"` mais continue quand même le passage.
2. `python3 ops/pile.py debut avant-ouverture`
3. `python3 ops/pile.py avant-ouverture` (scan de tout le marché, ~3 min, puis news des 20 premiers).
4. **Ton jugement** : choisis **de 1 à 6** actions à surveiller pour la cassure d'ouverture.
   - Écarte toute ligne marquée `ÉCARTER` (résultats, suspension, risque, restatement).
   - Préfère des prix entre 5 $ et 300 $ : au-delà, une fraction d'action seulement tient dans 0,55 $ de risque, ce qui reste possible mais grossit le glissement relatif.
   - Les setups « breakout_20d », « bull_flag » et « reclaim_ma20 » vont avec une cassure haussière ; « oversold » seul, moins.
   - Les trades du Congrès et les résultats trimestriels ne sont **que du contexte**, jamais une raison.
   - S'il n'y a rien de propre : choisis quand même les 1 ou 2 meilleurs, le filtre strict de 9 h 47 tranchera.
5. `python3 ops/pile.py surveiller SYM1,SYM2,… --note "<2 lignes : pourquoi ceux-là>"`
6. `python3 ops/pile.py fin avant-ouverture`
