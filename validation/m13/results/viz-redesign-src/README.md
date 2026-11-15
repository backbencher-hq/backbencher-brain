# The code map at `src/` scale — what is in this directory, and how it was read

These are the emitted `bb_visualize` documents for this repository's own `src/` tree
(scope `project`, `maxNodes 2000`: 140 files, ~1,770 symbols, ~15 directories), the frames
screenshotted from them at a fixed viewport, and the measurements taken off those frames.
The corpus-scale numbers the renderer's own comments and `docs/tools/bb_visualize.md` quote
come from here, and so does the census read out of these documents.

They exist because a reader reported the map as unreadable — *"the only thing I see is cyan
throughout, nothing is readable"* — and a screenshot cannot be argued with. Numbers can.

## The instrument

Two out-of-band instruments produced everything below. They live OUTSIDE the checkout
(`/tmp/viz-shots/`) on purpose: they need playwright, and neither a browser dependency nor a
lockfile change belongs in this repository. The gates that run in-repo are V1–V11 under
`script/m13/verify-visualize-*.ts`; these are the eyes the gates do not have.

| instrument | what it does |
|---|---|
| `/tmp/viz-shots/img2txt.py` | turns a PNG into a character grid plus a colour-class census, so a picture can be *read* as text and its ink shares quoted as numbers |
| `/tmp/viz-shots/legibility.mjs` | drives the document in chromium and reads the live DOM: labels drawn, clipped, overlapping; stripe heights; band fills; the fold the view publishes |
| `/tmp/viz-shots/frame-shot.mjs` | screenshots one composed document's map frame at a fixed viewport and settle time, so two documents can be compared pixel class by pixel class |
| `/tmp/viz-shots/wheel-probe.mjs` | delivers a real wheel and reads the map's own published zoom and the pill's own text back |

Reproduce the whole set from the repository root:

```bash
bun run script/m13/emit-viz-full.mts src 2000 validation/m13/results/viz-redesign-src   # the documents
node /tmp/viz-shots/frame-shot.mjs validation/m13/results/viz-redesign-src/preview-codemap-full.html /tmp/frame.png
python3 /tmp/viz-shots/img2txt.py /tmp/frame.png 96 26
node /tmp/viz-shots/legibility.mjs
node /tmp/viz-shots/wheel-probe.mjs validation/m13/results/viz-redesign-src/preview-codemap-full.html
```

## The files

| file | what it holds |
|---|---|
| `preview-codemap.html`, `preview-codemap-full.html`, `preview-graph*.html`, `preview-class.html` | the emitted documents (composed studio page and standalone view) |
| `codemap-frame-before-palette.png`, `codemap-frame-after-palette.png` | the SAME frame, same viewport (1600x1000, frame 1264x1000), before and after this pass |
| `codemap-ink-before.txt`, `codemap-ink-after.txt` | those two frames as character grids, with their colour-class census |
| `codemap-legibility-after.txt` | the live-DOM legibility census of the documents in this directory |
| `codemap-zoom-pill-before-after.txt` | the zoom pill's own text at 0.8 / 3.377 / 14.25 on the before and after documents |

## What was wrong, and what the measurement said

**1. One hue owned the picture, and the palette was the cause — not the detail level.**
`function`, `method` and `constructor` were all `#5eead4`, and in a TypeScript scope those
three are 78% of the symbols (821 methods, 551 functions of 1,769). The level-of-detail pass
before this one removed sub-pixel smearing and took the single-colour share from 62.2% to
41.0%, but folding cannot change the *proportions* of the kinds it folds. The two kinds that
dominate the picture now have two hues, imports moved off the method hue, and `test` moved off
the amber that means "stale since index" everywhere else:

| frame-only ink census | before | after |
|---|---|---|
| cyan (`function`) | **40.9%** | **9.2%** |
| blue (`method`) | 0.0% | **23.7%** |
| code between symbols (gap bands) | 39.8% | 41.7% |
| label text | 0.2% | 0.3% |

**2. Only 39 things in the picture had a name.** The naming budget was set to 32 to stop 21 of
59 names being clipped with an ellipsis — and clipping became impossible when the renderer
switched to *whole name or none*. So all 32 bought was an emptier picture: at fit over this
scope, 39 names were drawn while 111 candidates that FIT their own cell lost a queue. At 96 the
same document draws **84 names with 0 clipped and 0 overlapping**, and the queue costs 63
instead of 111. (`codemap-legibility-after.txt`.)

**3. The zoom pill was wrong in the only state where it could be read.** The test was
`view.k >= fitScale()`, which is true at the fit *and at every scale above it*, while the class
that displays the pill is set exactly when the whole map is NOT on screen. So a reader at 338%,
with three quarters of the map off the frame, was told "whole map · scroll to zoom in" — by a
pill that was never displayed at any zoom. `codemap-zoom-pill-before-after.txt` is that pill's
own text, before and after the comparison was read the other way:

```
== BEFORE     zoom 0.8 -> "whole map · scroll to zoom in"
              zoom 3.3766 -> "whole map · scroll to zoom in"     <- 338%, three quarters off screen
              zoom 14.2514 -> "whole map · scroll to zoom in"
== AFTER      zoom 0.8 -> "whole map · scroll to zoom in"
              zoom 3.3766 -> "338% · drag to pan, scroll to zoom"
              zoom 14.2514 -> "1425% · drag to pan, scroll to zoom"
```

A gate had pinned that defect in place: `script/m13/verify-visualize-honesty.ts` required the
literal string `var shown = view.k >= fitScale() - 1e-6`. It now asserts the corrected
predicate, and the *behaviour* is asserted where it can be driven —
`script/m13/verify-visualize-codemap.ts` (V11) delivers a wheel to the artifact's own `wheel`
listener and checks both states, with a negative that fails on the old predicate (measured:
reverting the one-line comparison turns 2 assertions in V11 red).

## What the gates cover, and what they do not

After this pass: V1 15/15, V2 24/24, V3 21/21, V4 25/25, V5 89/89, V6 21/21, V7 86/86, V8
29/29, V9 34/34, V10 70/70, V11 106/106. The ink census and the naming budget are *out of
band* numbers recorded in the renderer's comments and in the generated tool page, not
thresholds a gate re-checks on every run — the same arrangement the earlier LOD pass used.

Known gaps, stated rather than left to be discovered:

- `img2txt.py` classifies pixels against a fixed palette, so antialiased edges land in the
  "other" bucket and a fill's exact share is approximate; the DOM census (band fills, label
  counts) is the exact instrument, the picture-as-text is the readable one.
- `legibility.mjs`'s third case re-measures after a wheel; in the runs recorded here the wheel
  did not take effect (published zoom stayed 0.8, hence the identical third block). The wheel
  path is measured by `wheel-probe.mjs`, which drives the same gesture successfully on the same
  document, and by V11 and V10.
- One viewport (1600x1000) and one scope (`src/`). Another aspect ratio or a much larger tree
  is not represented here.
