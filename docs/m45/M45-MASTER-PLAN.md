# M45: Demo Media Truth (Website Demos)

Status: `planned` (master plan filed; GitHub milestone 49 open)
GitHub milestone: `49` (first genuinely free number — 45/46/47/48 belong to other lanes,
verified against the live board 2026-09-07)
GitHub issues (enforced exactly by the governance gate):
G1=#708, C1=#709, D1=#710, T1=#711, X1=#712.
Parent program: [IDE Program Decision Record](../IDE-PROGRAM-DECISIONS.md)
Governing contract: [IDE Honesty Contract](../IDE-HONESTY-CONTRACT.md) + the
Demo-Media Rules below (this milestone's contract extension, gated from G1)

Name note: "Demo Media Truth" — the milestone exists because a *video is a claim*, and
no claim in this program ships without machine-checkable evidence.

## Why now (evidence, not opinion)

The website (`website/`, M41 lane) tells visitors what bb is with words and a static
terminal illustration. The product is now real across all three doors — CLI (M30/M32/M33),
MCP (M28), and LSP (M24–M29, M42, M44) — with in-editor behavior verified by real
headless editor runs (M25.E5, M26.E5, M42.E5/E6). A visitor who has never seen the
hover portal or the graph panel cannot *believe* those surfaces exist from prose alone;
the standard every modern dev-tool site meets is a real, short product video.

## Production model (owner decisions 2026-09-07)

A demo is a **film**, not a screen recording. It has two layers that never touch:

- **Product pixels (Layer 1)** — what the UI actually shows. A REAL scripted session,
  recorded live: real VS Code under Xvfb, the real bb-lsp VSIX, real cursor (xdotool),
  real hover portals, real go-to-definition and references UI — captured as h264 by
  ffmpeg x11grab at 2×/retina scale (`session-driver.ts`). These pixels are real and
  verified; nothing in Layer 2 may alter them.
- **The director's layer (Layer 2)** — framing and treatment only: hard-cut trim,
  subtle grade, gentle ≤1.15× push-ins anchored to portal centers MEASURED from the
  take by frame-diff (never guessed), and Fraunces/JetBrains Mono beat captions with
  every hold ≥ 3 s. Built with a deterministic, self-verifying ffmpeg pass
  (`post-production.ts`), in full visual continuity with the website (warm near-black
  editor, Fraunces beat titles, JetBrains Mono labels, ember accent only where it
  means something). A push-in is a camera move over real pixels — it fabricates
  nothing. Every hold and anchor is machine-checked in `D1-post*.json`.

> Decision record (owner, 2026-09-07): the originally planned Remotion Layer 2 was
> tried (storyboard + stills composition) and rejected after owner review — camera
> moves over stills read as synthetic, and early renders had wrong zoom targets and
> unreadable pacing. The approved model is real session footage + the light anchored
> post above. Remotion was removed before any film shipped; no film claims it.

Films are storyboarded first (beats, each with a job), then shot, then directed:

1. **Storyboard** — beat list with timings and jobs (`script/m45/storyboard.json`),
   re-scoped as-shot after the pivot: each beat names the real interaction it films.
2. **Shoot** — `session-driver.ts` performs the real session with human dwell times
   and records it; the sidecar manifest and live-LSP hover proofs are written with
   the take. A take whose hover proof is missing fails the run.
3. **Direct** — `post-production.ts` trims, grades, and anchors the film; it
   self-verifies its output (duration, resolution, caption visibility, camera
   motion) and writes the per-film post evidence. Frame-truth for session films is
   beat-truth: a 1 s frame-diff scan of the committed take must reproduce the
   recorded beat transitions, and the committed drivers re-shoot the same beat
   structure deterministically (verified across multiple development shoots).

Clips are silent with on-screen captions (no synthetic voiceover can misstate a
claim). Reduced-motion users get the poster frame (rule 6).

## Demo-Media Rules (contract extension, gated from G1)

1. **A video is a claim.** Every committed clip carries a sidecar manifest: bb version,
   editor (name + exact version), extension VSIX hash, demo-corpus commit, index hash,
   capture date, ffmpeg/Xvfb/xdotool versions. No clip ships without its manifest.
2. **Every frame is real.** No AI-generated footage, no composited/doctored product
   pixels, no mock UI. The capture must be reproducible by script from the pinned
   artifacts; a frame a fresh run cannot reproduce is a defect.
3. **Version honesty.** What the video shows is the version in its manifest — never a
   newer or aspirational surface. Hub scenes whose UI is still changing (M44's open
   lane) are not filmed until the owning milestone closes.
4. **Verifier-first.** A frame-truth verifier re-runs the capture at the pinned commit,
   frame-diffs sampled frames, and carries planted mutations that must fail (wrong
   version burned into a caption, an edited frame, wrong corpus, missing manifest).
5. **Website integration is truth-invariant.** The hero embed and `/demos` page may not
   change any M41 claim; T2/T3/S1 verifiers re-run unchanged after T1.
6. **Reduced-motion and accessibility are not optional.** Autoplay is muted with a
   poster frame; `prefers-reduced-motion` gets the poster; clips carry captions or
   transcript summaries for the core beats.

## Prerequisites (G1 checks on every run)

- M41 website bar green (the embed lives in M41's truth-gated site).
- M42 bar green (the hover portal scenes are M42 surface).
- M44 bar green **before hub scenes are captured** (U1–U6 are the co-agent's open lane;
  the harness and non-hub scenes do not wait, per owner decision 2026-09-07).

## Issue groups

| Code | GitHub Issue | Deliverable |
|------|--------------|-------------|
| G1 | [#708](https://github.com/backbencher-hq/backbencher-brain/issues/708) | M45 ledger + Demo-Media Rules appended to the contract and machine-gated; capture-truth manifest schema; closure gate; `npm run verify` wiring |
| C1 | [#709](https://github.com/backbencher-hq/backbencher-brain/issues/709) | scripted real-VS-Code session driver (Xvfb + `code` + real VSIX + xdotool + ffmpeg) that indexes the demo corpus and emits 4× retina stills/clips + sidecar manifest; mutation suite proving it CAN FAIL |
| D1 | [#710](https://github.com/backbencher-hq/backbencher-brain/issues/710) | session films on real captures: hover → rich info → go-to-definition → usages/references (VS Code), site-continuity style. Two films: hero (~29 s, depth) + Money hub (~26 s, breadth). Hub scenes captured only after M44 closes; hover/definition/references scenes filmed |
| T1 | [#711](https://github.com/backbencher-hq/backbencher-brain/issues/711) | hero video replaces the static terminal illustration (muted autoplay, poster, reduced-motion fallback) + new `/demos` page in nav with manifest-pinned captions; nav/sitemap/SEO gates extended |
| T1 (scope change, M56.I1 [#785](https://github.com/backbencher-hq/backbencher-brain/issues/785)) | [#711](https://github.com/backbencher-hq/backbencher-brain/issues/711) | The owner withdrew both films on review (pacing and craft, not truth) and `/demos` is **retired**: the withdrawn cuts were removed from `website/public/demos` (the verified takes stay in `validation/m45/results/demo-session/`), the retired URL redirects to `/editors` through the site's single redirect declaration, and the surviving machine-verified stills serve on `/editors`. The hero decision is unchanged — video-free, live verbatim CLI terminal. The T1 gate was rewritten to assert the retirement (no film markup, no media in the bundle, no retired link, declaration intact) and re-pinned. The previous live-page scope is recorded here, not erased. |
| X1 | [#712](https://github.com/backbencher-hq/backbencher-brain/issues/712) | one-commit evidence batch at stable HEAD; frame-truth + manifest gates green; screenshots as evidence |

## Scope

- **In:** demo media for the LSP (VS Code) surface; the capture harness; the Remotion
  film layer; the website embed; governance + closure.
- **Out:** CLI and MCP videos (deliberately a later milestone, once D1's look is
  approved — M45 stays one focused, verifiable deliverable); the LSP hub's *behavior*
  (M44's lane — M45 only films it after M44 closes); pixel-exact theming of the editor;
  audio/narration (clips are silent with on-screen text, so no synthetic voiceover can
  misstate a claim); AI-generated or composited product pixels (rule 2).

## Verification discipline (unchanged from M24–M44)

Every issue closes only with machine evidence: a verifier that (a) runs against the real
component and real server legs, (b) carries mutation proofs that it CAN FAIL, and (c)
writes a timestamped record pinned to a commit. Drift gates keep docs/code/ledger
byte-honest. The bottom-up governance chain M24→M44 stays green on every M45 run.
Nothing closes on prose.

## Ledger states

- `planned`: no executable evidence yet; never a release claim.
- `verified`: a real check passed on the current commit with a persisted evidence file,
  positive AND negative check counts, current commit, and evidence file recorded.
- `known-gap`: a real check or required corpus failed; the limitation remains open.

## Authority order

1. Executable implementation and public LSP/CLI behavior (what the capture shows)
2. Versioned machine-readable evidence and the verifier that produced it
3. The IDE Honesty Contract, the Demo-Media Rules, and the decision record
4. Per-milestone documentation
5. GitHub issue text and human summaries

A lower authority cannot upgrade a higher-authority failure. Documentation may explain
a limitation, but it cannot turn a failed or missing behavioral check into `verified`.

## Negative list

- No clip without its manifest; no manifest pointing at a commit the capture cannot
  reproduce.
- No AI-generated or composited frames (rule 2).
- No hub-scene capture before M44 closes (rule 3).
- No CLI/MCP videos in this milestone (scope).
