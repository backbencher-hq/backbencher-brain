# Homepage-first fix plan v2 — 2026-11-08

**Purpose:** ship one homepage the owner actually likes, for ~1/5 the tokens of a full-site redesign, before touching other routes. This file is the durable contract: if the session resets, resume from here.
**v2 change:** the owner reviewed the current home and rejected the visual result ("white background and text", "what is this map", letters lost strokes). v2 keeps the home-first loop, keeps the owner's line *"Evidence is the answer."* as the brand signature, and replaces the flat-paper direction with a **dark product-instrument surface built around real product artefacts** (recorded trace, real index graph, real LSP responses). It also names the two concrete bugs to fix first.
**Status:** AWAITING GO — R0 not started.

---

## 0. Why home-first is still right

The homepage concentrates 100% of the real problem: a thesis headline that never names the product, no product artefact, two abstract plates, audit voice, and a fold spent on a meaningless map. If the home lands, the same components/spec roll out; if not, we spent an afternoon.

**The rule that makes it cheap:** a round is judged on **screenshots of one real page**, not on words, boards or design docs. No new identity document. The implemented page *is* the design doc.

---

## 1. Two bugs the owner found — verified, root causes

### 1.1 The display letters lose their strokes (Fraunces at 109 px) — CONFIRMED
- The H1 uses `font-family: fraunces` with `font-optical-sizing: auto` at 109.44 px. Fraunces is a variable serif with an optical-size axis (9–144). Auto-opsz picks ≈109 → the display extremum: hairlines collapse at 1×, so **`E` reads as an empty frame, `c/e/n` lose joins, and the italic `answer.` shows wonky swash forms** ("w" collides into "cu").
- Verified by CDP: computed `font-optical-sizing: auto`, `font-variation-settings: normal`, size 109.44 px. With `font-optical-sizing: none; font-variation-settings: "opsz" 40, "SOFT" 0, "WONK" 0` the same words render complete (evidence: `.tmp-web-review/review/shots/h1-zoom.png` vs `font-pinned-opsz40.png`).
- **Fix (non-negotiable, ships in R1):** never let auto-opsz drive a display font. Body/UI text keeps Archivo/Hanken; Fraunces survives **only** for the motto, italic, ≤40 px, with pinned axes; H1 becomes Archivo 600 at 64–76 px (verified legible in `font-archivo-72.png`).

### 1.2 The "map" is decoration, not a product surface — CONFIRMED
- It is a radial plot of **bb's own `src/` directories** (17 clusters on an ellipse, opacity-0.22 hairlines, 9.5 px labels like `SETUP`, `UTIL`, `BUS`, `CONTRACTS`), with 4 reached directories painted ember. The visitor is not told whose repo it is, what a "directory" means in their project, or why they should care.
- The real data behind it is good: `hero-data.generated.json` holds **210 modules · 635 resolved import edges · 4 traversal waves · 7 affected modules · real `file:line` chips with evidence tiers**, captured from `bb_analyze mode=dependencies`. The failure is the rendering and the framing, not the data.
- **Fix:** replace it with a **real index graph** — actual file nodes, real paths on hover, the rename's blast radius lit, wave-by-wave traversal, tier colours, text fallback. Working title: "One answer, as a graph." This is also the section that answers "what is this map".

---

## 2. The page spec (v2 — the contract)

**Mode:** Persuade · **Job:** a developer understands what bb is in 5 s and installs it in 2 min · **Reader:** a developer evaluating a local code-intelligence tool for agents/editor · **Tone:** confident, technical, evidence attached; zero internal audit language.

### 2.0 The visual world (one paragraph, replaces the paper world on `/`)

**Dark graphite instrument.** Near-black warm canvas (`#0B0908`) with a barely-there grain, hairline slabs, one ember signal (`#FF5A36`), bone type (`#F5EEE5`), and the **five evidence-tier colours as the only functional palette** (structural bone, import sand, usage amber, reference ember, inferred violet-grey with dotted treatment). Product surfaces are the ornament: real recorded panels, a real graph, real LSP response cards. No glassmorphism, no glow blobs, no gradient text, no fake terminal chrome, no stock editor screenshot as the hero. One authored motion moment (the trace/graph walks); `prefers-reduced-motion` gives the settled frame.
The owner's line **"Evidence is the answer."** stays: set in Fraunces italic (pinned axes, ~30–40 px) as the brand overline above the H1, and repeated once at the close. It is the signature, not the headline.

### 2.1 Section list (≤ 6 blocks, ~600 words)

**1. Masthead** — reuse AtlasNav structure; dark skin; remove the duplicate Install; `aria-current`; GitHub icon added.

**2. Hero (the fold, ≤ ~750 px at 1440):**
- overline: *Evidence is the answer.* (serif italic, ember, pinned opsz)
- **H1 (Archivo 600, 64–76 px):** `Code intelligence that shows its evidence.`
- sub (≤ 2 sentences): `bb indexes your codebase locally — symbols, imports, call edges — and answers with file:line, the relationship it walked, and what it could not know. 16 MCP tools, one CLI, your editor.`
- install control (real one-liner + copy) + `Read the docs →`
- meta: `Free · local-only · macOS, Linux, Windows · 53 languages`
- right: **the recorded trace panel** (real `bb` output, tier chips, digest footer) with a **mini traversal graph** that plays once.

**3. "One answer, as a graph"** — the real index graph (210 nodes / 635 edges from the recorded `bb_analyze` run), the rename's 7 affected modules lit in order, hover shows real path + tier, click-free; a text list fallback for a11y. Replaces both abstract plates.

**4. "Your editor, answering from the same index"** — real LSP responses rendered in-designed (hover with evidence tier + staleness, references list), plus one **real captured** VS Code definitions-peek frame (exists: `validation/m45/results/demo-session/clips-hero/`), cropped to the evidence region. No stock editor chrome as the hero image.

**5. Register strip** — `53 languages · 50 analyzers · 14 relationship types`, each with provenance in 13 px mono; a compact real matrix teaser (50 × 14, lit cells = relationship types the analyzer constructs) → `/languages`.

**6. Close + footer** — install again, `Free · local-only`, the motto once, docs link; footer fixes (target size, Terms, GitHub).

### 2.2 Delete from home
Both abstract SVGs, "Plate I/II" captions/legends/roman numerals, the margin-note block (its content becomes the hero trace), "50 analyzers, drawn once.", "Every claim states how it is known." (the tier vocabulary moves into the trace/graph labels), all word-count/registry-contract meta copy, "See the register", the italic accent word in H1 (the motto is the only italic).

### 2.3 Budgets (measured at R3)
| budget | value |
|---|---|
| rendered words | ≤ 600 |
| HTML transfer (gzip) | ≤ 60 KB |
| font faces on `/` | 4 (Archivo, Hanken, JBMono, Fraunces italic — all already in repo, **no new fonts**) |
| JS on `/` | ≤ 120 KB gzip |
| LCP / CLS (4G throttled) | ≤ 1.2 s / 0 |
| overflow at 320/390/768/1024/1440 | none |
| text < 12 px | none (mono data 13–14) |
| CTAs | 2 (hero + close) |
| internal-language tokens (`M\d+`, ledger, gate, verifier, task-\d, validation/) | 0 |
| images | real captures only, webp/avif, ≤ 250 KB total |

### 2.4 Acceptance tests (owner judges these)
1. 5-second test: product named + what it does + install path in the first viewport.
2. "Would I install?" yes/no.
3. "Does it look like a website?" — at least three designed surfaces (product panel, graph, editor response) with depth/colour/motion, not text on a flat background.
4. Letters/typography test: no missing strokes at 1×; display text legible in the screenshot.
5. Mobile: H1 + sub + install + start of the trace at 390 without sideways scroll.
6. Technical gate (budgets + a11y + reduced motion + JS-off content).

---

## 3. Isolation

| path | role |
|---|---|
| `website/src/app/page.tsx` | rewrite composition, this route only |
| `website/src/app/home.css` | new, imported only by `page.tsx`; dark instrument tokens scoped to `.home` |
| `website/src/components/home/*` | new components (hero, trace, graph, editor responses, register) |
| `website/src/data/home/*.generated.json` | recorded real data (trace, graph, LSP responses) + generator under `script/website/` |

Nothing else changes. Current home snapshotted before R1; reset = copy back.

---

## 4. Rounds, tokens, owner outputs

| round | work | tokens | owner sees |
|---|---|---|---|
| **R0** | fix font (pin opsz) + record real data: index `test/fixtures/m45-studio` with `bb`, run `bb ask/graph/impact`, capture LSP hover/definition/references JSON from `bb lsp`, extract the best real editor frames from `validation/m45/.../clips-hero/`, pull the 210-node graph from `hero-data.generated.json` | 20–30k | nothing (internal), 1-line status |
| **R1** | hero only, dark instrument: overline motto, Archivo H1, install, trace panel + mini graph. Screenshots 1440 + 390 | 40–55k | 2 screenshots + checklist + **one decision** |
| **R2** | graph section + editor responses + register strip + close/footer; screenshots 1440/768/390 | 40–55k | 3 screenshots + checklist |
| **R3** | mobile, a11y, budgets, motion/reduced-motion, one skill audit pass; final pack | 25–35k | final pack + rollout go/no-go |
| **retry** | if no: change **one** structural variable (hero composition / light-vs-dark / artefact order), not the palette | ~40k | one verdict |

**First attempt ≈ 125–175k tokens, ~1 day.** Hard cap 3 refinement rounds on R1; then the concept is wrong, not the polish.

**Owner review protocol:** screenshots + checklist + one question per round; verdict + ≤3 notes back. No design essays.

---

## 5. Reset / token-safety

1. Before R1, snapshot `page.tsx`, the home's atlas components and CSS to `.tmp-web-review/home-baseline/` — reset is a `cp` back.
2. Never `git checkout/restore/reset/clean` in this shared checkout; revert by explicit commit id or the snapshot.
3. No new identity doc, no new fonts, no new deps, no changes outside the four isolated paths; one change-set per round judged on screenshots.
4. This file + the snapshot are the durable state: a session reset costs one read, not a redesign.

---

## 6. Decisions needed before R0

1. **Direction:** dark graphite instrument (§2.0, recommended) — or keep a light surface? If the owner wants light, say so now; the artefact plan is unchanged either way.
2. **Motto role:** keep *"Evidence is the answer."* as the serif brand overline + closing line, with the H1 naming the product (recommended) — or keep it as the H1 itself (works only with a strong product panel beside it).
3. **"Free + licence" line on the hero** — recommended yes.
4. **Go/no-go** — on "go" I start R0; the first thing the owner sees is R1 screenshots, not another plan.

## 7. After a yes (rollout)
Promote home components/patterns; page order `/install` → `/tools` → `/editors` → `/docs` → `/languages` → `/why` + `/changelog` + footer; fix the master-review P0/High list in the same pass (editors reflow, nav breakpoints, fonts to 3–4 faces, brotli, truth contradictions, dead-identity deletion); deploy (live site is 20.7 days stale). ~3–4 days to a shippable site.
