# Pile — plan de construction

Statut : **proposition, en attente de ton feu vert.** Rien n'est codé au-delà de l'installation des skills.

---

## 0. Ce qui est déjà fait (section 1 du cahier des charges)

| Skill | Version | Où | Vérifications |
|---|---|---|---|
| `day-trader-skill` (11 × `trader-*`) | commit `3d0f4ef` (20/10/2026), v2.0.0, **aucune version plus récente** | `.claude/skills/trader-*`, `LICENSE-day-trader-skill`, `TRADER_VERSION` | 312/315 tests OK. Les 3 échecs viennent tous de `test_repo.py`, qui vérifie la disposition du dépôt **amont** (README, `.claude-plugin/` à la racine) : c'est normal une fois copié. La CI exclura ce seul fichier. |
| Impeccable | npm `4.9.2` (skills livrées avec le moteur `0.1.24`) | `.claude/skills/impeccable`, `.claude/agents/impeccable-*.md` | Installation **projet**. Les hooks sont arrivés dans `.claude/settings.local.json` (non commité) : voir question 2. |
| UI UX Pro Max | `ui-ux-pro-max-cli 2.15.0` | `.claude/skills/ui-ux-pro-max` (+ 6 skills sœurs, voir question 3) | Installation à partir des fichiers fournis dans le paquet (aucun téléchargement), `search.py` répond. |
| Maquettes | — | `design/maquettes/*.html` | — |

### Audit réseau et scripts

**day-trader-skill** : Python avec la seule bibliothèque standard, `urllib` uniquement, aucun hook, aucune lecture de clé.
- Domaines contactés, exactement ta liste : `query1/query2.finance.yahoo.com`, `feeds.finance.yahoo.com`, `www.sec.gov`, `data.sec.gov`, `disclosures-clerk.house.gov`, `www.nasdaqtrader.com`, `stooq.com` (repli de `trader-alerts`, seulement avec `--source stooq`), `www.nyse.com` (cité en commentaire, jamais contacté).
- `github.com` apparaît seulement dans l'en-tête User-Agent.
- Seul `subprocess` : `pdftotext` en local (`trader-pelosi`, optionnel).
- `efdsearch.senate.gov` et `api.ibkr.com` apparaissent dans la doc, pas dans le code.

**Impeccable**, à signaler :
- Le lanceur télécharge son moteur depuis `github.com/pbakaus/impeccable/releases` et vérifie son SHA-256. Il est mis en cache dans `~/.impeccable`, hors du dépôt, et sera donc retéléchargé à chaque session cloud.
- Le moteur contient une **télémétrie anonyme** (« roll API », `api.impeccable.style`), une vérification de mise à jour et une connexion optionnelle (`impeccable login`).
- Je propose de couper télémétrie et mise à jour (`impeccable telemetry off`, plus les variables d'environnement équivalentes dans `.claude/settings.json`).
- `detect` fonctionne hors ligne.

**UI UX Pro Max** :
- `search.py` est local (CSV).
- La commande `uipro` peut interroger `api.github.com` (pas en mode modèle, celui qu'on a utilisé).
- Les **6 skills sœurs** (`banner-design`, `brand`, `design`, `design-system`, `slides`, `ui-styling`) ne servent pas à Pile. `design/scripts/*/generate.py` **lit des fichiers `.env`** (dans le dossier du skill et `~/.claude/`) et appelle Gemini. `ui-styling` lance `npx shadcn`. `design-system` pointe vers Pexels.

---

## 1. Ce que j'ai vérifié et qui change le cahier des charges

1. **GitHub Pages depuis un dépôt privé exige GitHub Pro** (payant). Sur l'offre gratuite, Pages ne publie que les dépôts publics. → Question 1.
2. **Lighthouse n'a plus de catégorie « PWA »** depuis la v12. Je la remplace dans la CI par :
   - des tests Playwright : manifeste valide, service worker actif, hors ligne, icônes, `display: standalone` ;
   - Lighthouse pour la performance et l'accessibilité.
3. **Cloudflare gratuit** confirmé :
   - 10 ms de CPU par exécution (cron compris) ;
   - 50 sous-requêtes externes, plus 1 000 vers les services Cloudflare (D1) ;
   - 5 crons par compte, 100 000 requêtes par jour.
4. **Fractions chez Alpaca** : marché, limite, stop et stop-limite, en `time_in_force: day` uniquement, achat seulement, actif `fractionable`. Rien de clair sur les brackets fractionnaires : je le revérifierai dans la référence des ordres et par un essai en paper au jalon 5.
5. **Tu n'as pas de terminal** (Claude Code sur navigateur), donc pas de `wrangler secret put` ni de `npm run pair` chez toi. Je remplace :
   - **Clés Alpaca** : tu les colles toi-même dans le tableau de bord Cloudflare (Worker › Settings › Variables and Secrets › *Secret*). Ça marche depuis un navigateur, même sur iPhone.
   - **Clés VAPID et sel des jetons** : une GitHub Action manuelle `setup-secrets` les génère et les pousse directement en secrets du Worker. Elles ne sont jamais affichées, ni dans le chat ni dans les logs.
   - **Premier appairage** : une GitHub Action manuelle `pair` crée un code à usage unique valable 10 min et l'affiche dans le résumé du job (visible seulement par toi, dépôt privé). Les appareils suivants s'appairent depuis l'écran Système d'un appareil déjà appairé.
   - **Déploiement** : uniquement par la CI. Tu ajoutes un secret GitHub `CLOUDFLARE_API_TOKEN` aux droits restreints (Workers + D1 de ton compte).
6. **Jeton de Claude encore mieux protégé** : au lieu d'une variable d'environnement `PILE_API_TOKEN` lisible par la session, l'environnement Claude Code peut enregistrer le jeton comme **secret réseau**. Le proxy l'injecte alors dans l'en-tête `Authorization` des requêtes vers le domaine du veilleur, et Claude ne le voit jamais. `SEC_USER_AGENT` reste une variable d'environnement (ce n'est pas un jeton).
7. **Repli si Yahoo bloque** : Claude n'a pas de clé Alpaca (règle 0.2). Le veilleur expose donc `GET /api/bars` (portée claude, symboles et plage bornés) : il relaie les barres IEX avec ses propres clés. Les outils du skill qui lisent un fichier de barres (Time Machine, entrée, sortie) reçoivent ces données converties au format qu'ils attendent. Le passage le signale dans le journal et dans le « pourquoi ».
8. **Empreinte `PASS`** : `trader-risk` calcule l'empreinte de l'ordre **exact** qu'il a vérifié. Or le veilleur recalcule la taille sur le prix réel, donc l'empreinte ne peut pas correspondre à l'ordre final. Je propose :
   - le veilleur exige une empreinte présente et bien formée, liée au plan (hachage du plan sans le champ `risk_pass`) ;
   - puis il refait **toutes** les règles sur l'ordre réel. C'est ce second contrôle qui fait foi.

---

## 2. Architecture

```
 Tâches planifiées Claude Code (4/jour, env. réseau dédié)       Worker Cloudflare « pile » (un seul)
 ┌──────────────────────────────────────┐   HTTPS + jeton    ┌───────────────────────────────────────┐
 │ ops/passes/*.md  → ops/*.py          │ ── injecté par ──▶ │ fetch : /api/*  +  PWA (assets) *     │
 │ trader-scanner/news/entry/exit/TM/   │    le proxy        │ scheduled (* * * * *) : veilleur      │
 │ budget/risk (skill intact)           │ ◀───── état ────── │ D1 · Web Push (WebCrypto)             │
 └──────────────────────────────────────┘                    └──────────────┬────────────────────────┘
                                                                            │ PAPER_BASE (constante)
                                     iPhone (PWA installée) ◀─▶ /api/*      ▼ + data.alpaca (IEX)
                                                                        Alpaca paper · Frankfurter
 * ou GitHub Pages si tu préfères (question 1)
```

### Le veilleur, minute par minute, dans 10 ms de CPU
- **Sortie immédiate** hors de 9 h 25 – 16 h 10 New York. L'horloge Alpaca est en cache dans `kv_state`, rafraîchie une fois par séance plus aux bornes. C'est presque toujours 0 sous-requête et environ 1 ms.
- **En séance** :
  - 1 appel `account` (avec le contrôle du préfixe `PA` du numéro de compte et du capital < 500 $), 1 `positions`, 1 `orders?status=open` ;
  - **1 seul appel** `/v2/stocks/bars` multi-symboles (SPY + symboles armés, 1 min, IEX, depuis 9 h 30 seulement), plus les ordres éventuels.
  - Au total, moins de 10 sous-requêtes par minute. Les écritures D1 sont groupées en un seul `batch()`.
- **Travail lourd réparti** : les médianes de volume à la même heure (indice de foule, composante 3) sont calculées par Claude au passage « Cassures » et envoyées dans le plan, pas par le veilleur.
- **Mesure** : `wrangler tail` (champ `cpuTime`) pendant le rejeu et la première séance, plus un test qui échoue si un tick simulé dépasse un budget d'opérations.

### Le cerveau (Claude)
- Chaque passage lit son `ops/passes/<passage>.md`.
- Des scripts déterministes `ops/*.py` (bibliothèque standard) appellent les outils du skill **sans les modifier** (sous-processus `python3 .claude/skills/trader-*/…`), dans un dossier de travail temporaire `trader/`, non commité.
- Claude garde le jugement : choisir parmi les candidats, rédiger le « pourquoi », le bilan.
- Les erreurs de données mènent à `POST /api/alerts` et à « pas de trade aujourd'hui ».

### Le fantôme et le S&P
- Calculés par le veilleur à partir des **mêmes** barres que celles déjà récupérées : aucune sous-requête en plus.
- Le fantôme suit les plans `kind: "fantome"` envoyés par Claude.

---

## 3. Modèle de données (D1, migrations `worker/migrations/0001_…sql`)

| Table | Contenu principal |
|---|---|
| `config` | jour 0 (capital $, taux, 50 €), réglages anti-foule, glissement plancher, version du schéma |
| `kv_state` | pause (et motif, jusqu'à quand), horloge en cache, dernier tick, dernier passage Claude, verrous |
| `devices` | jetons **hachés** (sel en secret), portée `app`/`claude`, nom, créé, vu |
| `pair_codes` | code haché, expiration 10 min, usage unique |
| `plans` | plan JSON validé, `kind` réel/fantôme, statut armé → déclenché → exécuté/désarmé/expiré, hachage |
| `orders` | `client_order_id` déterministe (unique), rôle (entrée/stop/objectif/clôture/urgence), statut Alpaca, prix |
| `trades` | entrée/sortie, quantité, stop, objectif, R, prix du signal vs exécuté (glissement), raison de sortie, foule à l'entrée, adaptations |
| `equity_points` | ts, capital $, taux, € (1 min, réduits à 15 min après 30 j) |
| `fx_rates` | date BCE, EUR pour 1 USD |
| `spy_points` | ts, prix SPY, valeur € de l'enveloppe |
| `ghost_trades` · `ghost_points` | le fantôme, même forme |
| `bars_1m` | barres IEX 1 min des symboles armés et de SPY, enregistrées au passage : sert au **rejeu** de n'importe quelle séance passée |
| `crowd_daily` | étoiles et forks du skill, composantes, score |
| `journal` | bilans et notes des passages |
| `alerts` | niveau, message, acquittée |
| `push_subs` | abonnements Web Push par appareil, préférences des 3 types |

---

## 4. Arborescence

```
pile/
├─ .claude/
│  ├─ skills/            trader-* (intacts), tests/, impeccable/, ui-ux-pro-max/, TRADER_VERSION
│  ├─ agents/            impeccable-*
│  └─ settings.json      env (télémétrie Impeccable coupée) [+ hooks, question 2]
├─ .github/workflows/    ci.yml · deploy.yml · setup-secrets.yml · pair.yml
├─ app/                  PWA : Vite + TypeScript + Preact
│  ├─ public/            manifest, icônes, fonts/*.woff2 (Martian Mono, Tilt Prism, OFL.txt)
│  └─ src/               screens/ (lancement, tableau, historique, trade, systeme) · scope/ (oscilloscope SVG)
│                        api.ts · sw.ts · fx.ts · time.ts (Europe/Paris via Intl)
├─ worker/
│  ├─ src/               index.ts (fetch + scheduled) · alpaca.ts (PAPER_BASE en dur) · guard.ts (verrous paper)
│  │                     risk.ts (portage de trader-risk) · trigger.ts · orders.ts · ghost.ts · spy.ts · fx.ts
│  │                     crowd.ts · push.ts · api/*.ts · schema.ts (zod)
│  ├─ migrations/        0001_init.sql …
│  ├─ test/              Vitest + vecteurs de parité risk, rejeu de séance
│  └─ wrangler.toml      un cron « * * * * * », binding D1, assets (si question 1 = Cloudflare)
├─ ops/
│  ├─ passes/            avant-ouverture.md · cassures.md · mi-seance.md · bilan.md
│  ├─ pile_ops/          client API, appels du skill, config 50 €, filtre Time Machine strict, foule, glissement
│  ├─ foule.json         poids de l'indice
│  └─ tests/             pytest
├─ scripts/              check_paper_lock.py (garde CI), export_risk_vectors.py
├─ design/               maquettes/ · decisions.md · rapports/
├─ docs/                 plan.md · exploitation.md
├─ DESIGN.md · PRODUCT.md · README.md
└─ .gitignore            .dev.vars, .env*, *.pem, node_modules, trader/, .claude/settings.local.json
```

### Parité du contrôle de risque
- `scripts/export_risk_vectors.py` exécute `trader-risk/check.py` (sans le modifier) sur les cas de ses propres tests et sur des cas propres à Pile (50 €, fractions), puis écrit `worker/test/risk-vectors.json`.
- Vitest vérifie que `risk.ts` rend exactement les mêmes `PASS`/`BLOCK` et motifs. La CI régénère le fichier et échoue s'il diffère.

---

## 5. Jalons

| # | Contenu | Ce que je te montre |
|---|---|---|
| **1. Socle** | dépôt, `.gitignore`, CI (lint, types, tests skill + Pile, gitleaks, garde `api.alpaca.markets` sans `paper-`, `impeccable detect`), constante `PAPER_BASE`, contrôles paper (préfixe `PA`, capital < 500 $) testés | CI verte, tests de garde qui échouent quand on viole un verrou |
| **2. Veilleur, lecture seule** | D1 + migrations, horloge, points de capital, Frankfurter (format revérifié), SPY, `state`/`series`, appairage, jetons hachés, `bars_1m` | une séance réelle enregistrée, réponses `state`/`series`, mesure CPU |
| **3. App** | lancement animé, tableau de bord oscilloscope sur vraies données, historique et système vides mais finis, PWA installable ; boucle Impeccable (`shape` → `distill`/`quieter` → `critique`/`audit` → P0/P1 → `polish`) | captures Playwright **côte à côte avec les maquettes**, rapport Impeccable |
| **4. Cerveau** | `ops/`, 4 passages **à la main**, Time Machine stricte, foule, `POST /api/plans` ; puis environnement réseau + 4 tâches planifiées créés avec toi | journaux des passages, plans reçus, aucun ordre |
| **5. Exécution paper** | déclencheur, risque côté veilleur, bracket ou fraction + stop, objectif, 15 h 55, perte du jour, pause, tout couper ; **rejeu** (fixtures TSLA du skill + `bars_1m`) puis une séance réelle | rejeu de bout en bout, puis séance paper en direct |
| **6. Fantôme et foule** | simulation, comparaison, adaptations anti-foule, mesure après coup | les 3 courbes |
| **7. Notifications et polish** | Web Push VAPID (bibliothèque vérifiée ou RFC 8291 en WebCrypto), bilan du soir, audit final, `docs/exploitation.md` | notification reçue sur ton iPhone |

---

## 6. Ce que tu fais (au bon moment, je te guiderai)
- **Maintenant** : créer le dépôt GitHub `pile` (privé, vide). Je m'y connecte et je pousse le socle.
- **Jalon 1** : jeton API Cloudflare restreint, à mettre en secret GitHub `CLOUDFLARE_API_TOKEN` (avec `CLOUDFLARE_ACCOUNT_ID`).
- **Jalon 2** :
  - le compte paper Alpaca (montant exact en dollars donné le jour J) ;
  - ses clés, collées dans le tableau de bord Cloudflare ;
  - lancer l'Action `setup-secrets` ;
  - créer la base D1, ou laisser la CI la créer.
- **Jalon 3** : ajouter la PWA à l'écran d'accueil, puis lancer l'Action `pair` et taper le code.
- **Jalon 4** : approuver l'environnement réseau et le secret réseau du jeton Claude, définir `SEC_USER_AGENT`.
- **Jalon 7** : autoriser les notifications sur l'iPhone.
