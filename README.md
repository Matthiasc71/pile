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

## Licences

- `day-trader-skill` © Jake Schincariol, MIT (`.claude/skills/LICENSE-day-trader-skill`).
- Impeccable : Apache 2.0.
- Polices Martian Mono et Tilt Prism : SIL OFL (jalon 3).
