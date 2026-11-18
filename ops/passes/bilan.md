# Passage « bilan » (16 h 15 New York)

Lis d'abord `ops/passes/_regles.md` et applique-le.

1. `python3 ops/pile.py etat --passe bilan` — code 3 parce que pas de bourse : `python3 ops/pile.py fin bilan --saute "<raison>"` et arrête-toi. (La pause n'empêche pas le bilan.)
2. `python3 ops/pile.py debut bilan`
3. `python3 ops/pile.py bilan`
4. **Ton jugement** : écris le bilan du jour.
   - Titre : 6 mots au plus.
   - Texte, 5 à 8 lignes :
     - le résultat du jour en euros ;
     - toi face au S&P et au fantôme (quand il existe) ;
     - ce qui a été armé, déclenché ou désarmé, et pourquoi ;
     - **une** leçon, factuelle, sans promesse.
   - S'il n'y a eu aucun trade, dis-le simplement et rappelle pourquoi (filtre strict, pause…).
5. `python3 ops/pile.py ecrire-bilan --titre "…" --texte "…"`
6. `python3 ops/pile.py fin bilan`
