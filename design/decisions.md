# Décisions de design

## Jalon 3 (2026-11-18)

- **Polices auto-hébergées, sous-ensembles maison.** Le sous-ensemble « latin » de Google Fonts ne contient pas `→` (historique « 16:02 → 17:18 »). Martian Mono est découpée depuis le fichier officiel (latin + € − → · … ≈ ≤ ≥ ×) : 37 Ko. Tilt Prism ne garde que « PILEF » : 17 Ko. Licences OFL dans `app/public/fonts/`.
- **Échelle verticale en €/div.** Comme les volts/div d'un oscilloscope : des pas ronds (0,05 · 0,1 · 0,2 · 0,25 · 0,5 · 1 · 2…), la ligne des 50 € toujours à l'écran, et l'échelle affichée en haut à gauche (« 0,10 €/div »). Ajout par rapport à la maquette : sans elle, la grille ne mesure rien.
- **Axe horizontal par point, pas par heure.** Les nuits et les week-ends ne laissent pas de longs plateaux vides sur 1S, 1M et Tout.
- **Courbe monotone (Fritsch–Carlson).** La courbe ne dépasse jamais une valeur réellement atteinte : un lissage classique inventerait des pics.
- **Curseur.** La lecture du curseur remplace la légende sous l'oscilloscope au lieu d'une bulle sur la courbe : rien ne cache le tracé sous le doigt.
- **Sélecteur 1J · 1S · 1M · Tout** au-dessus de l'écran, aligné à droite, en texte (cibles de 48 px).
- **Halo phosphore conservé.** `impeccable detect` signale le `text-shadow` coloré (règle `dark-glow`). C'est la direction choisie (cahier des charges §9.1, maquettes) : exception limitée à `app/src/styles.css` dans `.impeccable/config.json`. Le scan d'une page rendue (CSS minifié, sans nom de fichier) la signale encore ; la CI applique le contrôle demandé (`detect app/src`).
- **Notifications.** Les trois interrupteurs sont affichés désactivés avec « Bientôt » jusqu'au jalon 7, plutôt que cachés : l'écran Système est fini, la fonction ne l'est pas encore.
- **Rapports visuels.** Captures Playwright à 390 × 844 (@2x) dans `design/rapports/jalon-3/`, à côté des maquettes rendues dans les mêmes conditions.
