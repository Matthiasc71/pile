# Pile

Banc d'essai **éducatif** : Claude fait du day trading tout seul sur un **compte paper Alpaca** (argent fictif) qui démarre à 50 €. Une PWA iPhone montre la courbe face aux 50 € de départ, au S&P 500 et à la « stratégie fantôme ».

> **Pas un conseil financier.** Les exécutions en paper sont plus favorables que la réalité. La Time Machine du skill qualifie elle-même son exemple phare de « proche d'un pile ou face » : le nom de l'app vient de là.

## Verrous

| Règle | Où elle est tenue |
|---|---|
| **Paper uniquement, pour toujours** | `worker/src/alpaca.ts` : hôte de trading en constante, chemins relatifs seulement, redirections refusées. `scripts/check_paper_lock.py` fait échouer la CI si l'hôte réel apparaît n'importe où. Une règle ESLint interdit tout hôte Alpaca hors des deux constantes. |
| **Le bon compte** | `worker/src/guard.ts`, à chaque minute avant tout ordre : préfixe paper, capital < 500 $, identifiant du compte épinglé au jour 0. En cas de doute, refus. |
| **Pas de clé dans le dépôt ni dans le chat** | Clés Alpaca uniquement dans les secrets du Worker Cloudflare. `.gitignore` couvre `.dev.vars`, `.env*`, `*.pem`. gitleaks scanne tout l'historique en CI. |
| **Skill intact** | `.claude/skills/TRADER_SHA256SUMS`, vérifié par `scripts/skill_integrity.py` en CI. `trader-broker` est présent mais jamais utilisé. |

## Contenu

```
.claude/skills/   day-trader-skill 3d0f4ef (11 × trader-*, MIT), impeccable, ui-ux-pro-max
worker/           le veilleur (Cloudflare Worker + D1)
app/              la PWA (jalon 3)
ops/              les 4 passages de Claude (jalon 4)
scripts/          garde-fous de la CI
design/           maquettes de référence
docs/plan.md      plan de construction
```

## Mise en route (depuis un navigateur, sans terminal)

1. **Jeton API Cloudflare.** Dans Cloudflare : *My Profile › API Tokens › Create Token*, modèle **Edit Cloudflare Workers**.
   - Ajoute la permission **Account › D1 › Edit**.
   - Limite *Account Resources* à ton compte.
2. **Identifiant de compte.** *Workers & Pages* : l'**Account ID** est affiché dans la colonne de droite.
3. **Secrets GitHub.** *GitHub › pile › Settings › Secrets and variables › Actions › New repository secret* :
   - `CLOUDFLARE_API_TOKEN` ;
   - `CLOUDFLARE_ACCOUNT_ID`.
4. **Déploiement.** Il part tout seul après chaque CI verte sur `main` (ou *Actions › Deploy › Run workflow*). Au premier passage, il :
   - crée la base D1 `pile` ;
   - applique les migrations ;
   - déploie le Worker ;
   - génère `TOKEN_PEPPER` sans jamais l'afficher.

   L'adresse du Worker (`https://pile.<sous-domaine>.workers.dev`) est dans le log de l'étape « Déploiement du Worker ».
5. **Compte paper Alpaca dédié.** Crée-le avec 50 € convertis au taux BCE du jour. Puis mets ses clés dans *Workers & Pages › pile › Settings › Variables and Secrets › Add*, de type **Secret** :
   - `ALPACA_KEY_ID` ;
   - `ALPACA_SECRET_KEY`.

   Les secrets survivent aux déploiements suivants.
6. **Premier appairage (jalon 3).** Crée de la même façon un secret `PAIR_BOOTSTRAP`, une phrase d'au moins 16 caractères (un mot de passe suggéré par l'iPhone convient). Tape-la une fois dans la PWA installée : elle ne fonctionnera plus jamais ensuite.

Le premier tick en séance avec les bonnes clés enregistre le **jour 0** : identifiant du compte (épinglé), capital en dollars, taux BCE et ligne de base de 50 €.

## Vérifier en local

```bash
npm ci
```

```bash
npm run check
```

```bash
python3 scripts/check_paper_lock.py && python3 scripts/skill_integrity.py verify
```

```bash
python3 scripts/run_skill_tests.py
```

## Passages de Claude (jalon 4)

Quatre tâches planifiées lisent `ops/passes/<passage>.md` et lancent `python3 ops/pile.py …`. Claude ne passe aucun ordre et n'a aucune clé Alpaca : il envoie des **plans** au veilleur.

- **9 h 15 NY, avant-ouverture** : scan de tout le marché et news, puis Claude choisit jusqu'à 6 actions à surveiller.
- **9 h 47 NY, cassures** : pour chaque action, plan adapté à l'indice de foule, Time Machine (10 000 rejeux, graine 19), filtre strict (verdict « Leans/Strongly toward the target » **et** R moyen positif après glissement, sur les rejeux comme sur l'historique), taille et `trader-risk` (`PASS`). Claude arme au plus 3 trades et écrit le pourquoi. Le fantôme (skill brut) est armé à côté.
- **12 h 00 NY, mi-séance** : news sur les plans armés, désarmement si besoin, nouveaux setups.
- **16 h 15 NY, bilan** : résultat du jour face au S&P et au fantôme, une leçon.

**Taille en fractions.** `trader-budget` ne dimensionne qu'en actions entières. Avec ~55 $, une action entière dépasse presque toujours 0,55 $ de risque. Pile calcule alors la fraction et écrit l'ordre au format de `trader-budget` ; `trader-risk` le juge tel quel (`PASS` + empreinte). Si au moins une action entière tient dans le risque, l'ordre est un bracket en actions entières.

Le veilleur refait toutes les règles à la réception (deuxième ligne) et refuse tout plan qui en enfreint une, avec une alerte.

## Licences

- `day-trader-skill` © Jake Schincariol, MIT (`.claude/skills/LICENSE-day-trader-skill`).
- Impeccable : Apache 2.0.
- Polices Martian Mono et Tilt Prism : SIL OFL (jalon 3).
