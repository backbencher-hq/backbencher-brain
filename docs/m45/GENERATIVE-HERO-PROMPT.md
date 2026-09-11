# M45 — Generative Hero Film: Owner-Approved Pivot

**Owner decision 2026-09-12:** the v2 in-house cuts are rejected as hero media.
The hero becomes a **fully generated cinematic impression** (stylized editor,
cursor glide, hover portal), produced by a generative video tool from the
prompts below. The real verified session films remain on `/demos` as proof —
this is the standard industry pattern (stylized hero + real demos as evidence).

## Honesty placement

- The hero film is a **cinematic impression**, not a screen capture. It shows
  abstract, unreadable text only — it asserts no specific numbers, file names,
  or claims that could be false.
- Real, gate-verified recordings stay on `/demos` (evidence-pinned, unchanged).
- The M45 D1/T1 gates continue to pin the real films. When the generated hero
  is approved and integrated, the embed gates are re-pinned to the new asset in
  the same commit (no gate is ever left stale).

## Master prompt (hero film — paste as-is)

Cinematic product film, 10 seconds, 16:9, dark premium developer-tool
aesthetic — in the spirit of high-end launch films for tools like Linear
or Raycast.

SETTING: Close-up of a dark code editor on a widescreen monitor, warm
near-black background (#0D0B08). Rows of code with syntax coloring in
muted warm tones — amber, soft teal, warm gray. The code is slightly
soft-focused: legible enough to feel real, never sharp enough to read.
A thin amber accent line runs down the left edge of the editor. Gentle
ambient screen-light reflects on the desk below; shallow depth of field.

ACTION, beat by beat:
0–3s — The camera drifts slowly toward the screen. A glowing white mouse
cursor glides smoothly from the lower right toward a single
amber-colored function name in the middle of the code.
3–5s — The cursor settles on the symbol and pauses. A beat of stillness.
The symbol brightens with a soft warm halo.
5–9s — An elegant dark translucent panel materializes beside the symbol,
rising and fading in softly — a hover portal. Inside: a few lines of
documentation (soft, unreadable), a short vertical list of usage
entries, and one larger amber number at the top. Hairline amber border,
very soft drop shadow, glassy and premium.
9–10s — The camera holds on the panel with a gentle 5% push-in, then the
whole frame dims and fades to black for a seamless loop.

CAMERA: one continuous slow dolly-in for the entire film, never faster
than 5% zoom. No cuts, no shake. Ends on black.

LIGHT & MOOD: warm amber rim-light from the screen onto the desk, deep
shadows, faint film grain. Calm, confident, premium — like a hardware
launch film. No flashiness, no fast motion.

HARD RULES: no readable text anywhere (all code and UI text stays soft
and abstract); no people, no hands, no logos, no watermarks, no
captions; no flicker, no warping, no morphing UI; the editor fills most
of the frame, monitor bezel barely visible at the edges.

## Negative prompt (separate field, if available)

people, hands, faces, logos, watermark, readable text, captions,
subtitles, flicker, morphing, jitter, bright background, white
background, daytime, cluttered desk, multiple windows, chat bubbles

## Settings

- Duration: 10s (Kling window is 3–15s; if the full prompt is rejected,
  trim to beats 0–9s — the portal reveal is the core)
- Aspect: 16:9 · Quality: highest available · Audio: none/silent
- One generation per prompt; reject gibberish/artifacts on first sight,
  do not iterate the same shot more than twice

## Variant B — "Jump to definition" (second film, for later)

Same setting, palette, and hard rules as the master prompt. Action:

0–2s — The cursor moves to an amber function name and clicks.
2–6s — The editor glides horizontally (one continuous move, no cut) to a
different part of the code; the cursor stays pinned to the symbol as the
world slides beneath it. Files blur slightly during the glide.
6–10s — The glide settles on a new location; the destination symbol
brightens with a warm halo and a translucent panel fades in beside it.
Frame fades to black for a seamless loop.

## Integration path (when the clip comes back)

1. Owner approves the generated clip.
2. Buffy audits it: no readable false claims (text must be abstract),
   no logos/people/artifacts, loop-safe ending.
3. Transcode to web master (H.264, poster frame), replace the hero embed
   asset, keep `/demos` real films untouched.
4. Re-pin the embed gates to the new asset in the same commit; re-run
   M41 + M45 gates green at one HEAD.
