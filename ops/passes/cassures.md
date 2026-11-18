# Passage « cassures » (9 h 47 New York)

Lis d'abord `ops/passes/_regles.md` et applique-le.

1. `python3 ops/pile.py etat --passe cassures` — code 3 : `python3 ops/pile.py fin cassures --saute "<raison>"` et arrête-toi.
2. `python3 ops/pile.py debut cassures`
3. `python3 ops/pile.py cassures`
   - Pour chaque action surveillée : fourchette 9 h 30 – 9 h 45, indice de foule, plan adapté, Time Machine (10 000 rejeux, graine 19), filtre strict, taille, `trader-risk`.
   - Chaque ligne dit **ARMABLE** ou **non armable** avec la raison.
4. **Ton jugement** : arme **au plus 3** trades, **uniquement** parmi les lignes ARMABLE. Zéro est une réponse normale.
   - Départage par : R moyen après glissement (rejeux **et** historique), verdict le plus net, indice de foule le plus bas, nouvelle catalysante dans le dossier du matin.
   - Pour chacun, écris le **pourquoi** : 3 lignes au plus, en français simple, avec un fait vérifiable du dossier (verdict, chiffre, nouvelle). Pas de promesse.
5. `python3 ops/pile.py armer SYM1="pourquoi…" SYM2="pourquoi…"`
   - Sans aucun SYM : `python3 ops/pile.py armer` (le fantôme est quand même armé).
   - Si le veilleur refuse un plan, ne le force pas : note-le dans `fin`.
6. `python3 ops/pile.py fin cassures`
