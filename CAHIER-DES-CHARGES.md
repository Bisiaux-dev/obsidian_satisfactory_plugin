---
date: 2026-06-08
type: idea
status: ouverte
tags: [obsidian, plugin, satisfactory, open-source, perso]
---

# Plugin Obsidian open-source pour Satisfactory

## L'idée
Créer un **plugin Obsidian open-source dédié à Satisfactory**, pour documenter, **vérifier** et visualiser des chaînes de production directement dans le vault. Usage **perso** au départ.

## Pourquoi (constat 2026-06-08)
Aucun plugin Obsidian dédié à Satisfactory n'est abouti (le seul sur GitHub, `thekyeZ/obsidian-satisfactory-planner`, est le template d'exemple renommé : vide). → créneau libre. Aujourd'hui : notes génériques (Dataview/Excalidraw/Canvas) + outils externes ([SCIM](https://satisfactory-calculator.com/), [Satisfactory Tools](https://satisfactorytools.com/)).

---

# CAHIER DES CHARGES (fonctionnel)

> Décrit **quoi** : features voulues, problèmes, solutions, ce qu'il faut prendre en compte. **Le "comment" (technique) viendra après** — on évaluera alors ce qui est possible ou non.

## 1. Nature de l'outil
- Outil pour **documenter, visualiser et VÉRIFIER** des chaînes de production.
- **Vérificateur, pas générateur** : l'utilisateur conçoit sa chaîne lui-même ; l'outil sert à **valider qu'elle est fonctionnelle avant la mise en place in-game**.
- **Le calcul assiste le raisonnement humain**, il ne l'automatise pas et ne crée pas la chaîne à la place du joueur.

## 2. Features voulues
- **F1 — Tout en `.md`, source de vérité plain-texte** : tout (DB + chaînes + positions + calques) est créable et éditable à 100% en Markdown. **Objectif explicite : qu'une IA puisse lire ET écrire l'ensemble directement** (ex. détecter un sous-produit orphelin et corriger la chaîne en éditant le texte). La source de vérité est le `.md` plain-texte — jamais un format binaire ni un `.canvas` JSON.
- **F2 — Base de données des crafts** : tous les crafts du jeu, avec pour chacun ses intrants, ses extrants (**produit principal + sous-produits**), ses **recettes alternatives**, et la **machine** associée.
- **F3 — Aide au besoin** : « je veux **X** » → quelles **ressources de base** et quelles **étapes intermédiaires** sont nécessaires.
- **F4 — Vérification d'une chaîne** : analyser une chaîne conçue par l'utilisateur et **signaler les problèmes** (voir §4).
- **F5 — Visualisation (identité visuelle — VALIDÉE 2026-06-08).** Graphe de flux gauche→droite, nœuds reliés (style planner SCIM). Référence visuelle : `2026-06-08-satisfactory-mockup.html`. **Deux couches de lecture indépendantes :**
- **Le NŒUD porte l'optimisation** : bordure + badge coloré → 🟢 OK · 🟡 sous-utilisé / sur-sous-production · 🔴 bloqué. Contenu du nœud : icône + produit, recette (badge si alternative), machine + nombre/cadence, débit.
- **La FLÈCHE porte la matière et son flux** :
  - **Couleur = le produit** (sa teinte moyenne réelle, une couleur par item).
  - **Trait = état physique** : plein = solide · pointillé = liquide/gaz.
  - **Bout = sens + état** : flèche directionnelle **toujours visible** · ♻ réinjecté (rétro-utilisation/boucle) · ⛔ orphelin (sans débouché → bloque).
  - **Label** : nom du produit + débit.
- **Calques (modularité)** : groupes nommés avec **icône** encadrant une portion de chaîne ; la sortie d'un calque **s'injecte dans un autre** (ex. calque Lingots → calque Plaques).

**F7 — Gestion des éléments visuels ET de leurs interactions.** Le plugin gère les éléments (nœuds, arêtes, calques, positions, icônes) **et les relations entre eux** : relier deux nœuds, mettre un nœud dans un calque, replier/imbriquer un calque, injecter un calque dans un autre, **router un sous-produit** (vers un nœud / une boucle / un Sink). Point clé : **ces liens visuels encodent les décisions de routage** (surtout le débouché de chaque sous-produit) → ils sont à la fois **visuels et sémantiques**, et c'est ce que lit le diagnostic (F4) pour repérer les orphelins. **Tout (éléments + relations + état replié/imbriqué) est décrit dans le `.md`** → pilotable par l'humain (souris) comme par l'IA (texte).

> **Détails liés à la mise en place (différés)** : nœuds déplaçables (✔ prototypé), calque **repliable** en un nœud-module, **imbrication** de calques, déplacement d'un calque entier. → à trancher à l'implémentation.
- **F6 — Icônes des ressources** : afficher les **images des ressources du jeu** dans la visualisation.

## 3. Problèmes à prendre en compte
- **Sous-produits = blocage n°1.** Un co-produit **sans débouché** fait remplir le buffer de la machine → la machine **s'arrête** → **toute la chaîne se bloque** (ex. typique : l'eau non consommée). C'est souvent ce qui empêche l'optimisation totale d'une usine avancée.
- **Recettes alternatives** : le choix d'une recette alternative **change toute la chaîne** (intrants, machines, sous-produits).
- **Débit réel ≠ débit théorique** : le débit effectif est plafonné par le maillon le plus contraint, **y compris l'évacuation des sous-produits**.
- **Respect des mécaniques du jeu** : débits par machine, ratios des recettes.

## 4. Solutions attendues (ce que l'outil doit faire face aux problèmes)
- **Chaque sous-produit doit avoir un débouché identifié** (consommé en aval / ré-injecté / envoyé au Sink) ; l'outil **signale les sous-produits orphelins comme bloquants**.
- L'outil **diagnostique** la chaîne et remonte :
  - **Problèmes moyens** : sous-utilisation d'une machine, surproduction, sous-production, déséquilibres de débit.
  - **Problèmes majeurs** : tout ce qui **arrête la chaîne entière** (sous-produit orphelin / backup en tête de liste).
- Prise en charge explicite des **recettes alternatives** (dans la DB et dans la vérification).

## 5. Contraintes / à prendre en compte
- **100% Markdown / Obsidian-natif.**
- **Open-source — licence AGPL-3.0** (validée 2026-06-08) : copyleft, garantit que le plugin **et tous ses forks restent ouverts pour tous** (l'objectif de Pierre). Usage + modification perso libres sous toute licence FOSS ; seule la **redistribution d'une version modifiée** doit rester ouverte.
- **Icônes du jeu (Coffee Stain)** : utilisées dans le plugin — risque de licence des assets **accepté** (précédents nombreux + plugin gratuit). *(Tranché 2026-06-08, plus un point ouvert.)*
- L'outil reste un **vérificateur en amont** de la construction in-game, pas un générateur de chaîne.

## 6. Périmètre v1 (proposition, à valider)
DB des crafts (`.md`) + vérification F4 sur une chaîne simple, avec gestion des sous-produits. Visualisation avancée et recettes alternatives complètes dans un second temps.

---

# Mise en place — architecture (logique, sur `.md`)

**Principe** : séparer **le savoir** (DB du jeu, statique) de **l'usine** (conception de l'utilisateur, variable).
- **DB consolidée** : 1-2 fichiers `.md` (`items` + `recipes`) avec un bloc structuré — **PAS une note par entité** (éviterait ~300 fichiers). Générable une fois depuis les données du jeu, éditable à la main.
- **Chaîne** : une note `.md` par usine, contenant un **bloc ```satisfactory** = une **scène déclarative complète** : `noeuds` (recette, machines, position, calque), `liens` (interactions entre éléments = routage : injection / rétro / sink), `calques` (icône, replié, imbrication). Le bloc décrit donc à la fois la **production** et le **modèle visuel + ses relations** (cf. F7) — tout en texte éditable IA.

**Scénario retenu = bloc de code custom rendu par le plugin** (source de vérité = le `.md` plain-texte ; le graphe interactif est un *rendu* du bloc ; le drag/calque **réécrit** le bloc).

Comparatif des pistes étudiées (2026-06-08) :

| # | Solution | 100% `.md` / IA | Interactif | Identité visuelle | Effort | Verdict |
|---|---|:---:|:---:|:---:|:---:|---|
| **1** | **Bloc code custom dans `.md`** | ✅ | ✅ | ✅ total | 🟡→🔴 | **RETENU** — seul à tout cocher |
| 2 | Vue dédiée (ItemView) | ✅ | ✅✅ | ✅ | 🔴 | variante (visu en panneau séparé, pas inline) |
| 3 | Obsidian Canvas (`.canvas`) | ❌ JSON | ✅✅ natif | ❌ styling limité | 🟢→🟡 | écarté (pas `.md`, visuel dégradé) |
| 4 | DataviewJS + Mermaid | ✅ | ❌ | ⚠️ statique | 🟢 | utile pour **prototyper la logique** seulement |
| 5 | Hybride bloc → `.canvas` | ⚠️ | ✅ natif | ❌ | 🔴 | écarté (duplication/synchro) |

**Risque d'ingénierie principal** (#1) : la **réécriture du bloc à chaque drag** (sérialiser positions/calques) + le piège Obsidian (DOM du bloc retiré hors écran → re-render à gérer). Parade : **schéma texte clair et stable** dans le bloc (YAML-ish) pour que IA + humain + plugin lisent/écrivent sans ambiguïté.

## Points à trancher — révélés par simulation mentale (2026-06-08)
Dry-run du système retenu (5 scénarios). Ce qui tient ✅ et ce qui reste à décider :
1. **Diagnostic lisible en TEXTE** — ✅ **TRANCHÉ (2026-06-08)** : le diagnostic est une **fonction pure de `(bloc + DB)`** → **l'IA le RECALCULE depuis le `.md`** (option B canonique). Toujours frais même sans plugin (cas headless), note propre (zéro contenu généré). Calcul trivial vu le schéma : *sortie sans `lien` qui la consomme = orphelin* ; *débit sortie vs somme des liens demandeurs = sur/sous-prod*. **Pré-requis : documenter les règles de diagnostic** (dans la DB ou un README) pour que plugin (visuel) et IA (texte) donnent le même résultat. **Option A** (le plugin écrit un résumé de diagnostic en texte) = **confort optionnel uniquement**, balisé « généré le \<date\>, ne pas éditer », traité comme potentiellement périmé — jamais source de vérité. Renforce F7 : routage explicite ⇒ diagnostic lisible en 2 lignes.
2. **UI d'ajout de nœud** + sélecteur de recettes (lecture DB) pour l'humain (l'IA, elle, écrit le texte).
3. **Auto-layout** des nœuds créés sans `pos`.
4. **Validation/élagage des `liens`** quand une recette change (ports disparus → liens invalides à nettoyer + signaler).
5. **Ports agrégés** d'un calque replié (ce qui entre/sort net du groupe) — confirme que « repliable » est non-trivial.
6. **Fallback DB** si une recette pointe un item absent (gris + warning, complétable par IA).
7. **Persistance** : écrire **au drop** (pas à chaque pixel) ; **toujours reconstruire depuis le texte** (source de vérité) → robuste au DOM retiré hors-écran et à l'édition concurrente IA/humain.

> Ce qui tient déjà : la boucle « bloc `.md` = source de vérité → rendu → drag/édition réécrit le bloc » est validée, y compris la **correction d'un orphelin par une IA** en ajoutant une ligne `liens`.

# Mise en place technique (plan, 2026-06-08)

> Note honnête : les plugins **communautaires** (Dataview, Excalidraw, Templater…) ne sont **pas des bases-code** (AGPL = interdiction de copier ; Excalidraw = outil de dessin, pas un moteur de graphe). Les vraies briques = **librairies JS open-source + exporteurs de données du jeu**.

## Stack (composant → FOSS → licence → rôle)
- **Squelette** : obsidian-sample-plugin + esbuild + TypeScript (MIT).
- **Intégration Obsidian** : API native — `registerMarkdownCodeBlockProcessor`, **`parseYaml`/`stringifyYaml`** (parsing du bloc sans dépendance), Vault/Editor (lire la DB, **réécrire le bloc**).
- **Modèle + diagnostic** : TS pur (option `@dagrejs/graphlib`, MIT) — DAG, cycles, **diagnostic = fonction pure** (cf. point #1).
- **Auto-layout** : `dagre` (MIT) pour les nœuds sans `pos`.
- **Rendu interactif** : **React Flow (xyflow, MIT core)** — nœuds/arêtes custom (identité visuelle), drag/pan/zoom, **groupes repliables**, handles pour relier. Coût : embarque React/ReactDOM (~150 Ko gz). *(Repli lean = SVG vanilla comme la maquette, zéro dépendance mais pan/zoom/groupes à recoder.)*
- **Données du jeu** : SatisfactoryTools / WikiDataExporter (open-source) → générer `items.md` + `recipes.md` une fois.
- **Prototypage** : DataviewJS (MIT) pour valider BOM/diagnostic avant le plugin (pas une dépendance du produit final).

## Décision rendu : **React Flow** retenu (meilleur ROI pour drag + calques repliables + relier + identité custom). Vanilla SVG = repli ultra-léger.

## Ordre de construction
1. Générer la DB (`items.md`/`recipes.md`) via WikiDataExporter.
2. Module **modèle + diagnostic** (TS pur, testable) — sert au plugin ET documenté comme spec pour l'IA.
3. Parser/sérialiseur du bloc (`parseYaml`/`stringifyYaml`).
4. Rendu React Flow (identité visuelle validée).
5. Write-back au drop (`stringifyYaml` → remplace le bloc).
6. Overlay diagnostic (couleurs nœuds) depuis le module pur.
7. Calques (groupes React Flow) + repli + routage des `liens`.
8. Finitions : auto-layout (dagre), fallback DB, sélecteur de recettes, icônes.

## Plugins/libs de référence (cherchés 2026-06-08)
- **`ldomaradzki/obsidian-kanban-block`** (MIT) ✅ **base-able** — LE pattern dur : rendu interactif depuis un **code block** + **écriture back via Vault API même en mode lecture**. À réutiliser pour notre write-back (risque n°1).
- **`LincZero/obsidian-node-flow`** (AGPL) ✅ **réutilisable** (notre plugin est AGPL → plus de restriction de copie) — le plus proche : graphe de nœuds **depuis un code block** (style ComfyUI), nœuds déplaçables, format JSON. ⚠️ **mais c'est du Vue (Vue Flow)** → soit on réutilise son code **en adoptant Vue Flow**, soit on garde **React Flow** et on réutilise sa **logique/format** (pas son UI Vue).
- **`mgmeyers/obsidian-kanban`** (GPL-3.0) ✅ **réutilisable** (GPL compatible dans un projet AGPL) — markdown-backed mature, robustesse du back-write.
- **React Flow / xyflow** (MIT) ✅ moteur de rendu retenu. *(Vue Flow = alternative, prouvée par node-flow — à reconsidérer si on réutilise son code.)*
- **`obsidian-community/obsidian-react-starter`** (MIT) ✅ scaffold React si on part React Flow.

→ **Combinaison** : scaffold React (MIT) + React Flow (MIT) + write-back de **kanban-block** (MIT) + format/logique de **node-flow** (AGPL, désormais réutilisable). ⚠️ Choix tech à trancher au build : **React Flow** (réécrire la partie nœuds en réutilisant la logique node-flow) **ou** **Vue Flow** (réutiliser node-flow tel quel) — la licence ne bloque plus, c'est une décision de stack.

## Licence
- **Plugin = AGPL-3.0** (validé 2026-06-08). Objectif : rester open source pour tous (le copyleft le garantit).
- **Réutilisation de code : LIBRE pour AGPL + GPL-3.0 + MIT** (tous compatibles dans un projet AGPL) → node-flow (AGPL), kanban (GPL), kanban-block / React Flow / react-starter (MIT) **tous réutilisables**. (La contrainte « inspiration seulement » est levée.)
- Conséquence AGPL pour les utilisateurs : usage + modif perso **libres** ; qui **redistribue** une version modifiée doit la garder open source. Clause réseau §13 **inerte** pour un plugin local.
- **Icônes du jeu (Coffee Stain)** : **utilisées dans le plugin** — risque de licence des assets **accepté** (nombreux précédents : SatisfactoryTools, SCIM, wiki… + plugin gratuit/non commercial). La couleur des solides en est extraite automatiquement.

## Points à éclaircir — audit final (2026-06-08)

**✅ Vérifié / tranché :**
- **Données du jeu disponibles** (vérifié) : **état physique** via `mForm` (RF_SOLID/LIQUID/GAS) → pilote plein/pointillé ; **sous-produits**, **machine** (`producedIn`), **recettes alternatives** présents dans `Docs.json` **et** dans `greeny/SatisfactoryTools/data/data.json` (déjà structuré, inclut aussi `color` + `icon`). → **Source DB recommandée : le `data.json` de SatisfactoryTools** (plus simple que `Docs.json` brut).
- **Couleur des items** : fluides = couleur via VisualKit ; solides = **extraite automatiquement de l'icône** (décision Pierre). `data.json` SatisfactoryTools fournit possiblement déjà un `color`.
- **Icônes** : on utilise les icônes du jeu. Risque licence (Coffee Stain) **accepté** — nombreux précédents (SatisfactoryTools, SCIM, wiki) + plugin gratuit. (Icône = couche rendu ; pour l'IA = nom+couleur+état en texte.)
- **Définition de chaîne = LES DEUX sens** : poser des machines (avant) **ET** objectif « X/min » → déduire les machines (arrière).

**🟡 À adapter pendant le dev (non tranché, selon difficultés) :**
- Schéma/grammaire exacte du bloc ```satisfactory (clés, ports, `SINK`…) — 1er livrable du build.
- Spec écrite des règles de diagnostic (orphelin, sur/sous-prod, débit réel).
- React Flow vs Vue Flow (le second permet de réutiliser node-flow tel quel).
- Rendu inline (bloc) vs vue dédiée (ItemView).
- Modularité inter-notes (module réutilisable dans plusieurs usines).

## Atouts de Pierre
A déjà développé un plugin Obsidian ([[projects/obsidian-lore-graph]]) → connaît scaffolding, build et publication au store.
