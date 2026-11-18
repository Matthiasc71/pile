# Passage « mi-séance » (12 h 00 New York)

Lis d'abord `ops/passes/_regles.md` et applique-le.

1. `python3 ops/pile.py etat --passe mi-seance` — code 3 : `python3 ops/pile.py fin mi-seance --saute "<raison>"` et arrête-toi.
2. `python3 ops/pile.py debut mi-seance`
3. `python3 ops/pile.py mi-seance --nouveaux`
   - Nouvelles des 4 dernières heures sur les plans réels encore armés.
   - Plans des candidats du matin qui ne sont pas encore partis.
4. **Ton jugement** :
   - **Désarme** un plan armé si une nouvelle le rend douteux (résultats avancés, suspension, procès, dégradation brutale) : `python3 ops/pile.py desarmer SYM --raison "<une ligne>"`. Dans le doute, désarme.
   - Un plan **déjà déclenché** ne se touche pas : stop et objectif restent gérés par le veilleur.
   - Tu peux **armer un nouveau** trade parmi les ARMABLE, sans dépasser 3 trades réels dans la journée : `python3 ops/pile.py armer SYM="pourquoi…"`.
5. `python3 ops/pile.py fin mi-seance`
