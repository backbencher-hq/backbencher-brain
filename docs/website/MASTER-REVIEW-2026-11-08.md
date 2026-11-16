# Website master review — 2026-11-08

**Status:** review complete; read-only (no website source changed). Fix plan (§8) awaiting owner go-ahead.
**Tree:** `cd2949eee` — Website: restore the Evidence Atlas homepage (+ uncommitted cobalt CSS edits that render nothing; see §2.4)
**Served build:** production `next build` at HEAD, `BUILD_ID zugDhT0jQIvuhOWwPWhhO`, served at `:3012`
**Live site:** https://backbencher.cc — a *different, 20.7-day-old build* (§2.2). Nothing in this tree has ever shipped.
**Lanes:** Lead (visual/design, IA, interaction, own measurements) + four read-only lanes: `content-truth`, `a11y-audit`, `responsive-audit`, `perf-arch`.
**Evidence:** `.tmp-web-review/review/` — metrics, 68 screenshots, interaction probes, and one report per lane under `lanes/<lane>/REPORT.md`; lane screenshots under their own dirs.

---

## 0. Verdict in five sentences

1. **The UI is not ugly because it is careless — it is ugly because it is aimed at the wrong reader.** Every part is carefully made, and the whole is a beautifully typeset internal audit report with a product section missing.
2. **The site never shows the product.** Across 11 rendered routes there are **zero images**, zero terminal captures, zero editor captures, zero tool input/output examples. The only visuals are two hand-drawn SVG data-art plates depicting **bb's own source directories** (home) and **its own analyzer bands** (night register) — a self-portrait of the engineering team, not the product.
3. **The content is an evidence dossier published in public.** `/editors` is the worst: two side-by-side claim ladders, an eleven-column matrix whose Evidence cells literally read `M29 precision ledger + M29 precision ledger`, `blocked — no pinned run on this machine`, and `This is a functional defect tracked in task-4 for the vscode-client lane`. The marketing page for the editor product is the team's QA ledger.
4. **The skin is a costume, and the costume is the only thing that changed.** In six hours (17:19→23:39 on 2026-11-07) the repo produced three visual worlds (live warm-dark → Evidence Atlas paper → "precision instrument" → Cobalt blue-porcelain → back to Atlas) plus **839 lines of dead CSS, 130 lines of dead components, 128–210 KB of unused font downloads per page**, and a `DESIGN.md` that describes a design the tree does not render. No redesign touched the content problem, so every new skin made the same dossier look expensive.
5. **What should happen next is not a fifth skin.** Keep the paper/ink/ember world (it is the only one that survived, and it is not AI slop), demote it from art direction to a disciplined document system, and spend the entire design budget on **one real product artefact** and **a rewritten page set** — then fix the objective defects (mobile `/editors` reflow, the tablet nav dead zone, 4 factual contradictions, the audit copy) and deploy.

**The single sentence a visitor should get in 5 seconds, and does not:** *"bb indexes your code locally into a graph your agents can interrogate — every answer carries its file:line evidence."* The home H1 is **"Evidence is the answer."** — a thesis about epistemology that never names the product.

---

## 1. What was reviewed and how

- **Tree at HEAD**, built with `npm run build` (PASS, 65 prerendered routes) and served as a production build. All captures are of the real build, not dev.
- **Rendered surfaces:** `/`, `/install`, `/docs`, `/tools`, `/languages`, `/languages/<slug>` (all 50), `/editors`, `/support`, `/privacy`, `/terms`, 404, plus `/sitemap.xml`, `/robots.txt`, the four legacy redirects (`/faq`, `/contact`, `/troubleshooting`, `/demos`). Content lane read the full text of every principal page; responsive lane swept 11 routes × 14 widths (320→2560 = 154 live loads); a11y lane ran real key/mouse events at 1440/390 with reduced-motion and JS-off variants; perf lane measured bytes/requests/LCP/CLS/DOM on 8 routes with cache disabled and read the build + source.
- **Live site** fetched and screenshotted for delta.
- **Source read** in full for the design system: `src/app/globals.css` (880 lines), `layout.tsx`, `src/components/atlas/*`, `Navigation.tsx`, `InstallTabs.tsx`, `ProvenancePlate.tsx`, `FamilyRail.tsx`, page files, generated data, `tailwind.config.ts`, `next.config.mjs`, `package.json`, docs (`docs/website/DESIGN.md`, prior review + fix log).
- **Assumption recorded:** the review judges the **tree** as what will ship, and the **live site** as what users see today; both are reported separately (§2.2). It does not assume the owner's taste; where a finding is taste rather than measurement it is labelled **[judgment]**.

---

## 2. Facts about the site as it exists

### 2.1 Inventory

- **63 public URLs**: home + 8 surfaces + 50 language detail pages (`/languages/<slug>`), 4 legacy redirects (`/faq`, `/contact`, `/troubleshooting`, `/demos`), 404.
- `sitemap.xml` lists all 59 required URLs correctly (home + 8 surfaces + 50 language pages; content lane verified 59/59 `<loc>`; robots fine; no broken internal links or anchors across 11 routes; JSON-LD parses; one `<h1>` per page; canonical on 10/11 — `/install` missing).
- **Every route is a static prerender** (`x-nextjs-cache: HIT`), CLS 0.000 on all 8 measured routes, LCP 152–304 ms unthrottled, security headers present.
- **Zero images** rendered on any route (no `<img>`, no `next/image`), and **2,607 characters of main text on the home page / 50,293 on `/docs`**.

### 2.2 The live site is a different, older site — and that is a defect in itself

| | Live `backbencher.cc` | Tree at HEAD |
|---|---|---|
| Identity | warm-dark editorial ("Your codebase, understood locally.") | Evidence Atlas, cream paper |
| Age | `age: 1791195s` ≈ **20.7 days** | never deployed |
| Home HTML | **597,453 B** | 107,142 B |
| Claimed numbers | **49 languages / 46 parsers / 16 tools / 15 tables** | 53 / 53 / 16 / 16 / 14 relationship types |
| Hero CTA | "Install bb" + "Browse the 16 tools" (terminal panel) | "Install bb →" + "See the register ↓" (a renamed section link) |

Consequences: (a) the public site states four numbers that are wrong against the current engine, plus a "40+ languages" CLI string that is stale at the source; (b) the owner may be reviewing the *old* design online while this tree contains a different one; (c) the deploy gate has been effectively broken for three weeks while **18 website commits** landed (and 2,035 repo-wide). **Nothing in this review ships until the site is deployed.**

### 2.3 The site's own design document contradicts the tree

`docs/website/DESIGN.md` is **v3, Cobalt** (blue-porcelain, Familjen/Plex, character field), says "the homepage is built in this world; the remaining routes are being ported onto it", and lists a migration order. In the tree:

- the homepage is **Evidence Atlas** (Fraunces/Hanken/JBMono, cream paper), not Cobalt;
- `cobalt-tokens.css`, `cobalt-base.css`, `cobalt-home.css` are **imported by nothing**; `src/components/cobalt/*` is **imported by nothing**;
- `src/app/site.css` (447 lines, an older `.site` identity) is **imported by nothing**;
- `src/app/install/page.tsx.s1bak` (89 lines) is a stray backup inside the router directory;
- the working tree carries **uncommitted** edits to `cobalt-home.css`/`cobalt-tokens.css` (+58/−24) that cannot render because nothing imports those files.

So the documentation describes a design that was built, then abandoned in the working tree, while the reviewed tree renders the design the doc calls superseded. This is not a documentation nit; it is the reason a third party cannot tell what the site is supposed to be.

### 2.4 Three visual worlds in one repository

| World | Where it lives | Status |
|---|---|---|
| Warm-dark editorial (M41.D1) | `globals.css` lines 4–420 (~417 lines), `components/Navigation.tsx`, Tailwind dark utilities in `/docs`, `/editors`, `/terms` markup | **Dead as a chrome** (nav returns `null` on all public routes) but its tokens/utilities and `.atlas-legacy` bridge still paint `/editors` and `/terms`; ~147 lines of it are dead |
| **Evidence Atlas (current)** | `globals.css` 421–710 + 758–880, `components/atlas/*`, inline atlas CSS for the two consoles | **Live on every route** |
| Cobalt / "precision instrument" | `cobalt-*.css` (392 lines), `components/cobalt/*` (130 lines), unused fonts | **Dead code + dead font downloads** |

The headline cost is not only hygiene: **9 font files (354 KB gzip) are preloaded on every page for three identities; only 3–4 faces render** (Fraunces, Fraunces italic, Hanken, JetBrains Mono). **127 KB every page / up to 210 KB is for faces no page uses** (Archivo → dead `site.css`; Familjen + 3× Plex → dead Cobalt). That alone is 38% of the home page's first load.

---

## 3. Why it reads as "disgusting" — the six structural problems

### P1 — It is an internal audit dossier published in public **[Blocker]**

The site's copy is written by people proving their own correctness to each other. It is not lying; it is worse — it is *litigating*. Evidence:

- `/editors` renders **two claim ladders side by side** (I0–I5 twice), an **11-column matrix** where every Evidence cell says `M29 precision ledger + M29 precision ledger`, rows saying `not recorded in the ledger` / `no wave-1 row`, and status cards reading `blocked — no pinned run on this machine`, `darwin — blocked`, `win32 — blocked`. The page's own text: *"Everything below is either recorded or shown as not recorded. Nothing on this page is a mock-up."*
- `/editors` contains **M29 ×13, M25 ×8, "ledger" ×16, "contract §" ×7** occurrences; one sentence on the page says *"This is a functional defect tracked in task-4 for the vscode-client lane."*
- `/tools` meta line: *"16 MCP tools · 29,362 words of generated contract · 4.0× between the largest entry (bb_graph) and the smallest (bb_security)"*. The page's opening argument is about **how long the documentation is**.
- `/docs` meta line: *"14 commands · generated against the real bb CLI · verified by CI"*.
- `/languages`: *"47 of 50 families carry an authored note. A family without one still prints its audited facts and says so rather than borrowing a template sentence."*
- `/support` lead: *"Straight answers first — including the ones that are easier to dodge."*
- Body copy: *"Nothing here is written to make a tool look capable."* — a sentence no confident product says.

The project's honesty culture is genuinely rare and is the best raw material on the site. But **honesty is the product's behaviour, not its marketing voice**. A visitor does not want to see the QA process; they want to see an answer they can trust because the evidence is attached.

### P2 — The product never appears **[Blocker]**

- **0 images on 11 routes**; the only evidence of the product is text and SVG.
- Home hero sells a thesis; the right margin shows one good thing — a rename question with `35 dependents, 21 files, 4 hops` and two `file:line + tier` rows — then the fold is handed to a **~1240×380 SVG constellation** of bb's own `src/` directories labelled `SETUP, UTIL, SECURITY, STORAGE, PROJECT, PROVIDER, MCP, LSP, CLI, BUS, CONTRACTS, AST, TOOL, BRAIN, INTELLIGENCE, CONFIG`. A first-time visitor has no idea what those words are, and they are **the vendor's directories**, not theirs.
- The night plate is a second abstract chart ("50 analyzers, drawn once") with 9.5–11 px labels and a 10 px caption.
- `/editors` — the page for the editor/LSP product — **contains no editor**. The four captured session frames were deliberately removed ("this is a reading surface, not a screenshot gallery"), leaving four rows of monospace metadata.
- `/tools` — the biggest product surface — never shows a single real request or response; it shows **word counts of its own contracts**.
- `/install` is the only page with a command above the fold.
- There is **no pricing or licence statement on any marketing page** (free/proprietary surfaces only inside FAQ Q3/Q4 and `/terms`), **no changelog**, **no comparison**, **no benchmark headline** (the good numbers live inside tool contracts and FAQ Q21), **no editor logos**, **no GitHub link in the header** (footer only).

### P3 — Every page is the same page with different words **[High]**

Measured at 1440: every interior route opens with an identical 12-column page-head — `h1` at **80.64px/78.22px** starting at **(x=116, y=150)** with a 733px box, a 625px-max lead at 18px, then a 10px uppercase mono meta line. Only the strings change. The h1s are slogans, while the nav labels are nouns:

| nav label | page h1 |
|---|---|
| Tools | *Every tool, and what it refuses.* |
| Languages | *Languages & analyzers* (close) |
| Docs | *Backbencher guide* |
| Editors | *Your editor, answering from the same index.* |
| Support | *Support* |

There is **no `aria-current` anywhere**, the nav renders **Install twice** (nav item + CTA), and — measured — **between 760 and 900 px the nav has no section links and no menu at all** (links hidden ≤900; the `<details>` menu appears only ≤759). Every tablet and small laptop in that range gets a logo and an Install link, nothing else. `nav` landmark is also missing on desktop (`<header><ul>`).

### P4 — Hierarchy is inverted: the largest type is decorative, the smallest type is the content **[High]**

Typography census, home at 1440: **19 distinct font sizes from 9.5px to 109.44px**. Fraunces 109.44px for the slogan; **9.5–11px uppercase mono for 72 of ~249 text nodes** (captions, legends, evidence rows, footer). `/editors` has **147 visible nodes under 12px (min 9.5)**; `/languages` 80; `/tools` 78; `/docs` 66. The text that explains the charts is smaller than the chart frame; the nav labels are 14px while the H1 next to them is 8× larger.

This is not a taste complaint only — it is a reading-cost defect: the *least* important element (the slogan) wins every page, and the *most* important elements (numbers, contracts, evidence rows) are set at caption size with wide tracking.

### P5 — The visual language is a costume: literary journal, not developer instrument **[judgment, but load-bearing]**

The Evidence Atlas world is: cream paper (`#F1EADF`), near-black ink, one ember (`#B33A22`), Fraunces serif display, hairline rules, wide-tracked uppercase mono labels, roman numerals (*Plate I*, *Plate II*), and **one italic ember word in every headline** (`answer.`, `known.`, `refuses.`, `once.`, `evidence.`). It is coherent, unmistakably not AI slop, and craftsmanlike.

It is also the wrong register for this audience. Developers evaluating a CLI/MCP/LSP tool read serif display + art-book captions + museum labels as *academic research artifact* or *design portfolio*, not as engineering confidence. The "evidence" thesis would justify a **technical instrument** aesthetic (precision tables, dark data surfaces, real captures), not an editorial one. Two further consequences:

- Colour stops signalling: the single ember is used for **every** italic accent word, every inline code token, every link in the `/docs` sidebar (all links are ember, so the sidebar reads as a column of errors), every FAQ numeral, and the map's "reached" nodes.
- The art direction consumes attention that the product needs: two abstract plates + legend + caption + margin note ≈ 1,500px of home before the visitor learns what bb does for them.

**[judgment]** This is the part of the review the owner must decide: keep the world or not. My recommendation (§8) is to keep it, because (a) it is the only world that survived the day, (b) it is not generic, and (c) the failure mode of the last four attempts was changing the world instead of the content. But it must be *pared back to a document system*, not used as a poster.

### P6 — The site is missing the things that convert, and includes the things that repel **[High]**

Missing: product screenshots/trace, install in the hero, pricing/licence, changelog, comparison/why-not, editor setup, a real docs shell (search, prev/next, split pages), benchmark headline, GitHub in nav, proof of speed, and a reason to trust the author.

Included instead: word-count meta copy, claim ladders, blocked-run cards, internal file paths, `M25/M29` codes, audit verbs ("re-verified", "gated", "declared drift"), 50k characters on the docs page, 12,976 characters on the editors page, two data-art charts, "Plate I/II" captions, a hero whose only CTA pair is *Install* and *See the register*.

---

## 4. Consolidated defect ledger (ranked)

Severity: **Blocker** = must fix before shipping; **High** = badly degrades comprehension/trust/access; **Medium** = visible defect or measurable cost; **Low** = hygiene/polish. `[lane]` = primary evidence source.

### Blockers

| id | route | defect | evidence |
|---|---|---|---|
| B1 | `/editors` | **Page does not reflow** — document is **1044 px wide at 390** (724 px overflow at 320, 654 at 390, 289 at 768, 44 at 1023). Cause: `#install > div.grid.gap-4.lg:grid-cols-2` cards with no zero-min base track; the 982 px `<pre>` install line sets a 1024 px min-content. Falls under WCAG 1.4.10. | [responsive], a11y, Lead |
| B2 | all routes | **Primary-nav dead zone 760–900 px inclusive**: `.atlas .nav ul` hidden at ≤900, mobile `<details>` menu only ≤759 → **no section links and no menu** on tablets/small laptops. Visible links = 1 (Install CTA). | [responsive], Lead CDP probe at 768/834/900/901 |
| B3 | `/editors` | **Public audit dossier**: two side-by-side claim ladders, 11-column matrix with duplicated `M29 precision ledger + M29 precision ledger` cells, `blocked` status cards, `tracked in task-4 for the vscode-client lane`. Product marketing surface is a QA ledger. | [content] |
| B4 | home | **H1 never names the product** ("Evidence is the answer."); product definition is paragraph 2; hero CTA is "See the register ↓"; captions are `Plate I.` / `digest 6bdc7241bfed…`. | [content], Lead |
| B5 | site-wide | **No product proof anywhere**: 0 images on 11 routes; no terminal capture, no tool payload, no editor capture; the two SVG plates depict bb's own directories/analyzers. | Lead, [perf], [a11y] |

### High

| id | route | defect | evidence |
|---|---|---|---|
| H1 | multiple | **4 factual contradictions in public copy** (see §5): "two families / ten relationship types" vs 5/14; "53 of the 53 supported families … remaining families" (unit mix); "12-point" vs "14 checks" integrity; VS Code "activates on 7 languages" refuted by its own cited `package.json` (14). | [content] |
| H2 | all | **Audit/jargon voice on marketing pages**: `/tools` "gate evidence of the three verifiers", "AUDIT.md, LATENCY.json, probes"; `/docs` CLI help carries `(M40.A8)`; `/languages` "script/m14/ontology-coverage-gate.ts fails the build"; `/support` "Read tools were re-verified". | [content] |
| H3 | all | **Inverted/illegible type hierarchy**: 19 sizes on home; 9.5–11 px mono carries captions/legends/evidence; `/editors` 147 nodes <12 px; `/languages` 80; `/tools` 78. | [responsive], [a11y], Lead |
| H4 | all | **Dark identity still paints two live pages**: `/editors` and `/terms` are Tailwind-classed dark markup repainted by a 47-line `.atlas-legacy` bridge full of `!important` substring selectors. `aria`/structure drift from the rest of the site. | [perf], Lead |
| H5 | all | **Fonts: 354 KB gzip preloaded for 3–4 used faces; 127–210 KB belongs to dead identities.** 46% of home first load, 65% of `/docs`. | [perf] |
| H6 | `/tools` | **913,499 B decoded HTML / 4,367 DOM nodes / 226 inline scripts (63.7%)** because all 16 panels are server-rendered; `/languages` 385,652 B decoded / 244,693 B inline JS. | [perf] |
| H7 | all | **540 KB uncompressed / 161–168 KB gzip JS hydrates static pages**; `Navigation.tsx` is a client component in the root layout that returns `null` on every public route yet ships `usePathname` + lucide + react-icons; third-party GoatCounter preload in the critical head. | [perf] |
| H8 | `/docs` | **One 7,921-word page**, no sidebar search/prev/next, and it re-renders all 16 tool contracts verbatim (also on `/tools`): 16 contracts × 2 routes; tool names 28× on `/docs`, 113× on `/tools`. | [content] |
| H9 | all | **Missing conversion content**: no pricing/licence on marketing pages, no changelog route, no comparison, no editor-setup narrative, no benchmark headline, no GitHub in nav; `0` CTA buttons on `/docs`, `/editors`, `/support`, `/privacy`, `/terms`. | [content], Lead probe |
| H10 | `/editors`, `/terms` | **Design-doc/tree drift + dead identities**: DESIGN.md v3 documents Cobalt as current; Cobalt + `site.css` + `components/cobalt` + `components/site` + `install/page.tsx.s1bak` total **≥1,200 dead lines**, plus 6.4 MB unreferenced assets, 3 unused deps, dead Supabase env. | [perf], Lead |
| H11 | `/editors` | **Status messages never announced** — 0 `aria-live`/`role=status` on all 11 routes; `/install` copy buttons flip `aria-label` to "Copied" with no live region and a silent catch on failure (WCAG 4.1.3). | [a11y] |
| H12 | `/docs`,`/editors` | **Code text contrast 4.30–4.43:1** (190 nodes <4.5) — ember `#B33A22` on composited code-chip bg; cause is the `!important` bridge out-specifying the later code rule (WCAG 1.4.3). | [a11y] |
| H13 | all | **Target size failures** (WCAG 2.5.8): footer nav links 15 px tall (28.8×15), support section-nav 15.8 px, language arrows 13.2×30, editors frame links 18.8 px; footer row pitch 23 px fails the spacing exception too. | [a11y], [responsive] |

### Medium

| id | route | defect | evidence |
|---|---|---|---|
| M1 | home | **Two abstract plates in the first 2,000 px**; the constellation is 0.22-opacity hairlines with 9.5 px labels depicting bb's own `src/` directories; content is unreadable without the 10 px caption. | Lead |
| M2 | `/languages` | **Rail numbering is scrambled** (visible: `07 C++, 08 C, 09 C#, 12 Swift, 13 Kotlin, 14 Dart, 38 Zig, 39 Objective-C, 46 Visual Basic …; then SCRIPTING: 10 Ruby, 11 PHP, 19 Lua…`). Cause: `index+1` of the global dataset order while the rail groups by band. | Lead crop; `FamilyRail.tsx` |
| M3 | `/languages` | Panel column leaves ~40% of the page empty while the 50-row rail continues; the "record" panel is short and the layout has no sticky/scroll relationship. | Lead |
| M4 | `/install` | "Index your first project →" link **wraps its arrow onto a second line** (Tailwind preflight `svg{display:block}` inside an inline `<a>`), making the next-step link look broken. | Lead crop |
| M5 | `/docs` | Sidebar is **all-ember links on cream** (reads as errors); 80.64 px H1 for a docs index; `>_` icon headings; no search; no version selector. | Lead, [content] |
| M6 | all | **Container inconsistency**: 1320 px container, but `.reading` is 900 px on `/install`/`/tools`/`/docs` (304 px dead right margin at 1440) and 832 px on `/languages`; `/editors` content is 1024–1320. | Lead probe |
| M7 | `/tools` | **320 px overflow** (64 px) and 25 px at 360 from `.tool-shape` `1fr` min-content; inline code spills at 1080 (`pageStaleCount` 97 px). | [responsive] |
| M8 | all | **Footer is a 30 px legal strip**: 8 links at 10 px mono, missing Terms, no brand/contact/social; it duplicates all 6 nav targets and triggers the eager prefetch storm. | Lead, [perf] |
| M9 | all | **Prefetch storm**: +27 requests / +212 KB gzip after load (footer duplicates nav destinations); `/tools?_rsc` alone 103 KB. | [perf] |
| M10 | `/tools`,`/languages`,`/languages/[slug]` | **Per-page inline CSS** (`dangerouslySetInnerHTML`, 34,701 B on `/tools`, 24,702 B on `/languages`, 4,738 B/detail) — uncacheable, re-downloaded per route. | [perf] |
| M11 | all | **No brotli**: `Accept-Encoding: br` only returns identity; gzip-only needs 15–25 KB more per response. | [perf] |
| M12 | all | **No `aria-current`** sitewide; desktop primary nav is `<header><ul>` with no `nav` landmark (only the closed mobile menu and page-local navs are labelled). | [a11y], [content] |
| M13 | all | **Skip-link focus ring 2.08:1** on paper (outside `.atlas` scope) — below 3:1 (1.4.11); target is a wrapper `<div>` not `<main>`. | [a11y] |
| M14 | `/install` | **ARIA tabs promise broken**: `role=tablist/tab` but ArrowRight does nothing, all tabs are separate tab stops, no roving tabindex (click/Enter work). | [a11y] |
| M15 | `/tools`,`/languages` | Console radios have **no fieldset/legend/radiogroup**; accessible names are whole rows (~100 chars); panel swap unannounced; a `nav` landmark contains form controls. | [a11y] |
| M16 | `/install` | **JS-off: Linux/Windows commands unreachable** (tabs dead; hidden panels stay hidden). | [a11y] |
| M17 | `/docs`,`/tools`,`/languages` | **Breakpoint squeezes**: `/docs` main column drops 824→472 px at 900; `/languages` panel 933→579 at 1020; `/tools` 915→562 at 1000. Wider screen, narrower reading column. | [responsive] |
| M18 | all | **Sub-12 px text systemic** (see H3); SVG labels 9.5–11 px ≈ 7.9–9.1 px effective at 390. | [responsive], [a11y] |
| M19 | `/docs` | Docs sidebar on mobile is the full red link list **above** the content (pushes content below the fold). | Lead |
| M20 | all | **`/install` missing canonical**; `/languages/typescript` title 69 chars; nav labels drift from page titles. | [content] |
| M21 | `/editors` | Editor page has **no editor imagery** and no setup path; "installable — not on a marketplace" is a negative as the second-to-last section. | [content] |
| M22 | site-wide | **Legal/pricing opacity**: free + proprietary only in FAQ Q3/Q4 and `/terms`; no licence statement in nav/footer/hero. | [content] |
| M23 | site-wide | **Ember used for every affordance** (links, numerals, italics, map nodes, sidebar, copy tokens) → accent no longer distinguishes action from decoration; links in body often lack underline. | Lead, [a11y] |

### Low

| id | defect |
|---|---|
| L1 | `X-Powered-By: Next.js`; no CSP; GoatCounter third-party in critical head. |
| L2 | Prerendered HTML has `s-maxage` but no browser `max-age` → repeat navigations revalidate. |
| L3 | No ESLint/Prettier/test config in `website/`; the `verify-*.ts` gates the comments promise are **not wired to `next build`**. |
| L4 | `tailwind.config.ts` still carries retired fuchsia/purple/cyan palette + glow/gradient tokens; `next.config.mjs` `images.formats` is dead (0 images). |
| L5 | `tsconfig*.tsbuildinfo`, `.astro/`, `.vercel/` leftovers; `website/.env.local` + `.vercel/.env.production.local` hold `NEXT_PUBLIC_SUPABASE_*` with zero Supabase code/deps. |
| L6 | `01`–`21` FAQ numerals are italic serif ember — 42 near-miss contrast nodes at 4.96:1 for 18 px text. |
| L7 | Tool/language consoles write the fragment into `location` on mount (`#bb_search`) — minor history noise; deep links do work. |
| L8 | 404 is good (correct status, `noindex, follow`, 6 recovery links) — no change needed except the double-nav `:has()` workaround (`body:has(.atlas) header.fixed{display:none!important}`) it depends on. |

---

## 5. Truth and consistency findings (content lane, verified)

**Verified correct:** 16 tools (`docs/data/public-tools.json`), 16 DB tables (`schema-ddl`), 14 CLI commands, 53 languages, 50 display families, 53 dedicated grammars (all `tree-sitter-*`), 14 relationship types, engine `0.3.0`, installer `1.0.19`. Sitemap 59/59; canonical 10/11; one h1/page; JSON-LD valid; no broken links/anchors; redirects return 307 (should be 301/308 for `/faq`,`/contact`,`/troubleshooting`,`/demos`).

**Contradictions to fix (public copy vs source):**

| where | claim | truth |
|---|---|---|
| `/languages`, `/languages/typescript` | "TypeScript is one of only **two** families … construct all **ten** relationship types" | **5** families construct all **14** (TS, Rust, HTML, Vue, Svelte); the page itself prints "14 relationship types" four times |
| `/docs` | "For **53 of the 53** supported families … The remaining families parse…" | 53 registry languages vs **50** families/analyzers → zero remaining; interpolates `dedicatedParsers` as a denominator (`docs/page.tsx:182`) |
| `/docs` CLI help | "run the **12-point** index integrity check" | `/tools` `bb_health` says **14 checks** in the same build |
| `/editors` | VS Code extension "activates on only **7** languages … per package.json activationEvents" | `ide/vscode/package.json` has **14** `onLanguage:` entries; `extension.ts:320` selector = LAUNCH_LANGUAGES (14). Its own citation refutes it. |
| home hero plates | "50 analyzers" vs copy "53 languages and 53 dedicated grammars" in the same section | two different units in one paragraph (analyzers = 50, languages/grammars = 53) |

Also: the home claim "recorded with bb 0.3.0 · digest 680C72418FED…" is an unverifiable internal digest for a public visitor; the "index snapshot 2026-11-07" will be stale the day after; the live site's four numbers (49/46/16/15) are wrong.

---

## 6. Measurements appendix

### 6.1 Performance (production build, 1440×900, cache disabled; gzip bytes, prefetch excluded)

| route | HTML gz | HTML decoded | JS gz (chunks) | fonts gz | total | DOM | LCP | CLS |
|---|---|---|---|---|---|---|---|---|
| `/` | 19,796 | 107,142 | 161,284 (8) | 354,272 | **547,393** | 711 | 212 ms | 0 |
| `/docs` | 57,831 | 253,591 | ~161–168 K (8) | 354,272 | ~585 K | 1,064 | 216 ms | 0 |
| `/tools` | 186,537 | **913,499** | 159,970 (8) | 354,272 | **712,820** | **4,367** | 256 ms | 0 |
| `/languages` | 45,483 | 385,652 | 160,075 (8) | 354,272 | 571,871 | 2,630 | 204 ms | 0 |
| `/languages/typescript` | 13,000 | 65,311 | 168,432 (12) | 354,272 | 547,745 | 384 | 304 ms | 0 |
| `/editors` | 24,014 | 144,348 | 168,432 (12) | 354,272 | 558,759 | 776 | 196 ms | 0 |
| `/install` | 7,075 | 32,517 | ~161 K (8) | 354,272 | ~535 K | 204 | 176 ms | 0 |
| `/support` | 14,449 | 89,279 | ~161 K (8) | 354,272 | ~542 K | 314 | 160 ms | 0 |

Plus eager prefetch after load: **+27 requests / +212,370 B** (dominated by `/tools?_rsc` 103,011 B). CSS 53,968 B raw / 12,041 B gz; selector match rate 16–37% per route (true dead CSS ≈60–75% on content pages). No brotli. Zero images. Fonts: 9 woff2 preloaded on every route; 3–4 used.

### 6.2 Typography / template census (1440)

- home: 19 sizes (9.5→109.44 px); mono 72 text nodes, Hanken 165, Fraunces 12.
- interior page-head: identical geometry on 8 routes — h1 80.64/78.22 px at x=116 y=150, 733 px box; lead 18 px, max-width 625 px; meta 10 px mono.
- CTA count per route: home 2, install 0 primary (only "Read the docs"/"Common questions" ghost links), docs 0, tools 1 ghost, languages 2 ghost, editors 0, support 0, privacy/terms 0.
- Text volume: `/docs` 50,293 chars; `/editors` 12,976; `/tools` 11,495; `/languages` 8,421; home 2,607; `/install` 1,584.

### 6.3 Responsive (154 loads: 11 routes × 14 widths)

- 9/11 routes zero document overflow at 320→2560. Mobile menu opens fully in-viewport 190×225 with 6/6 links; exactly one chrome (legacy nav never visible, 0/154); all 18 tables correctly inside scroll wrappers; SVG plates swap exactly once at 900 with 0.0% aspect mismatch.
- **`/editors` fails 1.4.10**: 724 px overflow at 320 → 289 at 768 → 44 at 1023; clean ≥1024.
- **Nav dead zone [760, 900] inclusive**, every route.
- `/tools`: 64 px overflow at 320, 25 px at 360.
- Breakpoint squeezes (§4 M17); sub-12 px text §4 M18; touch targets §4 H13.

### 6.4 Accessibility (WCAG 2.2 AA)

**Works:** 1 h1/page and no skipped heading levels; `lang=en`; all tables `th`+`scope`; 0 unnamed controls; skip link is first tab stop, visible on focus, works; visible focus ring on every measured tab stop (never `outline:none`); no positive tabindex; console keyboard operation (ArrowDown cycles radio + panel on `/tools` and `/languages`); provenance Map/Text operable by click and Enter with `aria-pressed`; 22 FAQ `<details>` toggle with Enter and keep focus; mobile menu opens 6 links, Escape closes and returns focus; reduced motion: 0 running animations, `scroll-behavior:auto`; JS-off: `/tools` + `/languages` consoles and mobile nav still work.

**Fails (from §4):** 4.1.3 status messages (0 live regions) · 1.4.3 code text 4.30–4.43:1 · 2.5.8 targets · landmarks (desktop nav not a `nav`; footer nav unlabelled) · skip-link focus ring 2.08:1 · tabs pattern · console grouping/names · JS-off install tabs.

---

## 7. Root causes

1. **The site is written by the verification culture, for the verification culture.** The evidence culture is the product's best asset, but no one has translated it into reader-facing value. Every page answers "how do we know this is true?" instead of "what can I do with it?".
2. **Design was used as the lever, content was not.** Four identity attempts in one day, each a full CSS/font world, none touched the H1s, the audit copy, the duplication or the missing proof. The churn itself became a defect: dead identities, stale DESIGN.md, wasted font bytes, three chromes in the code.
3. **No product-surface owner.** IA grew by accretion (every new verification artifact got a public page: `/editors` ledgers, `Plate I/II`, tool word counts). There is no "one home per fact" rule in force: 16 tool contracts render on two routes, tool names appear 113× on `/tools` and 28× on `/docs`.
4. **Gates check internal consistency, not user value.** The gates verify contrast, headings, sitemap, no ungenerated claim — and they pass while the site is unintelligible to a first-time visitor and fails 1.4.10 on the editor product page. Nothing in the process asks "does a developer understand this in 5 seconds / can they install it / would they trust it?".
5. **Deploy has been broken for three weeks**, so feedback has been against a stale site and the tree's own state (three worlds) is not what anyone is looking at.

---

## 8. Recommendation — one decision, then four phases

### The decision

**Do not redesign the visual world again. Keep the paper/ink/ember Evidence Atlas as the base, cut it back to a disciplined technical-document system, and spend the redesign budget on content architecture + one real product artefact.** Then fix the objective defects and deploy.

Why this and not a fifth world:

- A new world costs ~2–4 days of design/build plus another 300–800 lines of CSS and another DESIGN.md, and the arithmetic of the last attempt is on the table: **839 dead CSS lines + 130 dead component lines + 128–210 KB/page dead fonts + a wrong design doc**, for zero improvement in comprehension.
- The measured failures are not palette failures: B1–B5, H1–H3, H8, H9 are content/IA/layout defects that survive any skin.
- The paper world is the only one the repo restored, it is distinctive (not slop), and its craft is real. Demoted from "art direction" to "document system", it becomes an asset: cream paper + one serif voice + mono data is exactly what a technical reference site needs **if** the product proof sits on top of it.

### What that means concretely (the shape of the fix)

**1. One artefact replaces the two abstract plates.** A real, recorded `bb` answer trace — the CLI output the margin note already hints at, with `file:line`, relationship tier, freshness and declared-absence rows — presented as a code/data panel in the first viewport, plus three real captures on `/editors` (hover with tier badge, go-to-definition, find-references) produced from actual sessions. Delete the directory-constellation and analyzer-band SVGs, or demote one to a small footer-of-page figure. This is the only thing on the site no competitor can fake, and it is currently invisible.

**2. Re-cut the IA to 11 routes, one home per fact.**

| route | job | change |
|---|---|---|
| `/` | Install + proof: hero (name, one sentence, install command, recorded trace), 3 proof blocks (ask → graph → guard), languages teaser, editor capture, CTA | rebuild content, keep shell |
| `/install` | Keep; add price/licence line, first-index output, real `bb --version` capture | light |
| `/docs` | Split the 7,921-word page into ~8 pages with sidebar + search + prev/next | rebuild content |
| `/tools` | Registry: index + **16 detail routes** (deep links exist) or lazy panels; one real request/response per tool; drop word-count meta | rebuild |
| `/languages` | 50-row matrix/table linking to detail pages; keep the 50 detail pages (best content on the site) | rebuild index |
| `/editors` | Editor setup + 3 real captures + **one** claim table; delete both ladders, blocked cards, M-codes and "what it deliberately does not do as three cards" | rebuild |
| `/why` **(new)** | The evidence thesis / honesty contract / what bb will not do — the one home for the current site-wide audit voice | new |
| `/changelog` **(new)** | Generated from `CHANGELOG.md` — velocity as proof | new |
| `/support`, `/privacy`, `/terms`, 404 | Keep; widen FAQ topics (editors/LSP, evidence semantics, write safety, performance, comparisons); footer → Terms + GitHub + version | light |

**3. Re-legislate the type and colour system** (no new identity, a reduction):
- display sizes: 3, not 19 — `h1 48–56px`, section `32–40px`, page-head shared; body 17/1.65; data 13–14px mono; **no content below 12px** (captions min 12, sentence case, tracking ≤0.04em).
- delete the editorial apparatus as a brand device: "Plate I/II", roman numerals, `fig.` captions, wide-tracked uppercase labels used as voice, and the italic-ember word in every headline (one accent word per *page*, not five).
- one accent used only for action/hover/selection + the strongest evidence tier; body links get a visible underline; docs sidebar links become ink with ember on active.
- container: pick **1200 or 1320** and one reading measure (68–72ch), applied everywhere; no more 900-vs-1320 mismatch.

**4. Objective fixes (must land before the redesign is judged):** B1 (`/editors` reflow), B2 (nav breakpoints meet), `/tools` 320 overflow, install arrow wrap, language rail numbering, docs sidebar colour, footer targets, code-chip contrast, live region for copy status, `nav` landmark + `aria-current`, fonts cut to 3–4 faces (−210 KB/page), brotli, lazy consoles (−50% of `/tools` HTML), delete the three dead worlds (≥1,200 lines + 6.4 MB assets + 3 deps + dead env), fix the 4 factual contradictions, fix DESIGN.md to describe the real system, **then deploy** (live is 20.7 days stale and reads as a different product).

**5. Two new gates that would have caught this review's Blockers** (the existing gates are good at consistency and useless at value):
- *first-viewport contract*: product named in H1; install command or CTA visible without scroll; ≥1 real product artefact above 1,200 px; page-specific H1 matches its nav label; word budget per marketing page (e.g. ≤600 words on `/`, `/install`, `/editors`).
- *no-internal-language gate*: deny-list in rendered public HTML — `M\d+`, `I[0-5]–`, `ledger`, `verifier`, `gate`, `mutant`, `wave-\d`, `validation/`, `task-\d`, `AUDIT.md`, `LATENCY.json`, `claim-table`, `declared drift`.

### Sequencing and cost (one developer-agent day ≈ 6 h)

| phase | work | estimate |
|---|---|---|
| P0 | objective Blockers/High + dead-code deletion + truth fixes + deploy | **1–1.5 days** |
| P1 | content rewrite + IA re-cut (11 routes, `/why`, `/changelog`, docs split, editors rebuild, pricing/licence) | **2–3 days** |
| P2 | the recorded-trace artefact + 3 real captures + home/tools/editors layouts | **1.5–2 days** |
| P3 | type/colour reduction across all pages, gate wiring, final QA sweep (responsive + a11y at 320/390/768/1024/1440 + reduced motion + JS-off) | **1–1.5 days** |
| | **total** | **~1 week** vs ~2 weeks for a fifth world that would leave every Blocker in place |

### What I recommend *not* doing

- No fifth identity, no new palette/font hunt, no new "concept boards" before P0 lands.
- No more data-art plates; one product artefact beats two abstractions.
- Do not publish the verification ladders/ledgers on marketing routes; move them to `/why` (or keep them internal).
- Do not add docs/tool content to `/docs` again that `/tools` already renders; one home per fact.

---

## 9. What genuinely works (keep list — do not lose these in the fix)

1. **The evidence thesis is genuinely differentiating and rare.** "Every answer carries its source bounds, the relationship it walked, and what it could not know" is a real product promise no competitor states. Keep the *thesis*; change the *voice*.
2. **The margin-note concept** (question + answer + file:line evidence) is the best idea on the site — it should become the hero, not a sidebar.
3. **Craft is real:** self-hosted latin-subset fonts, no FOUT, flat hairline aesthetic, hand-drawn SVG data art, 0 CLS, clean prerender, correct security headers, one authored motion moment. This is above-average execution.
4. **Generated-data discipline** is excellent: no hand-typed counts on the trusted surfaces; sitemap derives language slugs; install/privacy/terms pages are short, specific and honest.
5. **`/install`** is the best page on the site (one job, one command, platform tabs, verify, next steps). Widen it, add price/licence, add first-index output.
6. **`/languages/<slug>`** pages are the best content: per-family extensions, registry ids, symbol kinds, relationship types, plus the ruled-vs-not-constructed distinction. Keep and restyle lightly.
7. **`/tools` panel content** is high-quality technical reference ("Questions this description answers", "What it will not do", safety/evidence semantics). The panels are good; the page framing and the all-panels-at-once rendering are what's wrong.
8. **`/support` structure** (22 native `<details>`, real answers, admits limits) and the **404** are solid. The FAQ topics need widening, not replacing.
9. **Accessibility baseline is strong**: one h1, clean outline, working skip link, visible focus, keyboard-operable CSS-only consoles, full reduced-motion parity, JS-off consoles. Fix the three AA failures; don't rebuild this.
10. **SEO/metadata**: canonical 10/11, OG/Twitter everywhere, valid JSON-LD, 59/59 sitemap, robots fine, no broken links/anchors.
11. **Honesty is not negotiable and should stay**: fix the four contradictions rather than delete the claims; keep "declared absence" as a first-class UI state.

### Explicitly refuted suspicions (so nobody re-fixes them)

FAQ emoji ✅ and flattened pipe tables do **not** appear in the served build (removed; `/faq` 307s to `/support`). No duplicate document `<title>` (the 18 extras are SVG `<title>` tooltips). No invalid JSON-LD. No broken links or anchors on 11 routes. No incomplete sitemap (59/59). No double chrome / duplicate fixed nav visible (legacy nav 0/154 loads, hidden by `:has()`; only the 404 renders it hidden). No clipped SVG labels (screenshot-verified). No distorted/missing image crops (zero images). Mobile `<details>` menu works and stays in-viewport. Wide tables do not cause page overflow (they scroll internally). `/editors` and `/tools` overflow are grid tracks, not tables. Console radio selection maps correctly (`CSS → CSS`, fixed since the last review). Tool language counts (53/50/16/14) are correct.

---

## 10. Decisions needed from the owner before P0

1. **Positioning.** Is bb sold as *code intelligence for AI agents* (MCP-first — the homepage' current bet) or as *editor intelligence* (LSP-first — why `/editors` is a 13k-char page)? The answer changes the hero, the nav order and which page gets the 3 real captures first. My read of the product/launch plan says **MCP-first with the editor as proof #3**, but this is a product decision.
2. **Price/licence visibility.** Free + proprietary currently lives in FAQ Q3/Q4 and `/terms`. Do we state "free" (and the licence) on `/` and `/install`? (Recommendation: yes, one line in the hero meta and on `/install`.)
3. **Visual world.** Keep paper/ink/ember as the reduced document system (recommended, §8) or commission a different direction. If the latter, say so before P1 — not after P0 — so the content work isn't thrown away twice.

---

## 11. Evidence index

- `.tmp-web-review/review/metrics-full.json` — per route × 5 viewports: title, h1 count, heading outline, nav count, DOM nodes, scrollWidth, text length, fonts, LCP/CLS/long tasks, console/network errors, internal links, small targets.
- `.tmp-web-review/review/shots/` — 68 full-page and fold captures (`home-1440-full.png`, `editors-1440-full.png`, `tools-320` equivalents, `int-*` interaction captures, `live-home-*-full.png`).
- `.tmp-web-review/review/cap.mjs`, `probe-*.mjs`, `interact.mjs` — reproducible raw-CDP harness (measure, screenshot, interaction).
- `.tmp-web-review/review/lanes/content/REPORT.md` — facts table, duplication census, IA and SEO findings, raw/out text extractions.
- `.tmp-web-review/review/lanes/responsive/REPORT.md` — 154-measurement sweep matrix, 70+ screenshots, breakpoint geometry.
- `.tmp-web-review/review/lanes/a11y/REPORT.md` — WCAG findings, keyboard/motion/JS-off evidence, contrast walker output.
- `.tmp-web-review/review/lanes/perf/REPORT.md` — byte inventory, font/CSS/JS/DOM tables, dead-code line counts, architecture map.
