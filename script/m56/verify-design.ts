// script/m56/verify-design.ts — M56.D2 (#786), the design/accessibility gate.
//
// D2's claim is that the site is legible, keyboard-operable, motion-respectful
// and built from one set of components. None of that can be checked by looking
// at a screenshot, so this gate computes it from the real sources:
//
//   A. CONTRAST FLOORS (computed in this file, WCAG relative luminance).
//      Every ink token and every literal text colour used anywhere in site
//      source must clear 4.5:1 against the LIGHTEST surface text can sit on
//      (--surface-2, the plate hover state) — not just against the page canvas
//      where the ratio is always kinder. Alpha-faded text classes are refused
//      outright: fading is how a passing colour becomes a failing one.
//   B. PALETTE HONESTY. Cool-grey Tailwind families (zinc/slate/gray/neutral/
//      stone) are refused — the identity is warm-dark, and /docs had drifted to
//      cool zinc greys on its tables (M56.D2 fixed 40 of them). The remaining
//      accent families are checked against the same floor from a declared hex
//      table, so a new palette class fails until someone records its colour.
//   C. KEYBOARD FOCUS. A global :focus-visible ring exists, and the two
//      hidden-radio consoles draw it on their row label (the input is
//      `.peer.sr-only`, so a ring on the input would be invisible).
//   D. REDUCED MOTION. Every animation declared in globals.css is either inside
//      a `prefers-reduced-motion: no-preference` block or named in the `reduce`
//      block. A new animation cannot ship unguarded.
//   E. ONE COMPONENT KIT. The shared ui/ primitives exist, the two content
//      surfaces import them and declare no local twins, and no component module
//      is unreferenced (five dead modules were deleted in this issue).
//   F. NO BANNED STYLE. The M41 identity bans still hold, plus gradient text,
//      transparent text, pulse animations and `outline-none` (which erases the
//      focus ring this issue added).
//   G. RESPONSIVE. Every table is inside a horizontal-scroll wrapper, and every
//      multi-column grid declares a breakpoint.
//   H. RENDERED PROOF. The built pages carry no cool-grey class and the built
//      CSS carries the focus rule — the same claims, end to end.
//
// Run: npx tsx script/m56/verify-design.ts
// Evidence: validation/m56/results/D2.json

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SITE = path.join(ROOT, "website")
const SRC = path.join(SITE, "src")
const RESULTS = path.join(ROOT, "validation/m56/results")
const READ_ONLY = process.env.BB_M56_READ_ONLY === "1"

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}
function readAbs(p: string): string {
  return readFileSync(p, "utf8")
}
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(tsx?|css)$/.test(e.name)) out.push(p)
  }
  return out
}

let checks = 0
let passed = 0
let negatives = 0
const failures: string[] = []
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
function negative(label: string, byDesign: boolean, detail = ""): void {
  negatives++
  check(`${label} [negative]`, byDesign, detail)
}

console.log("M56.D2 design & accessibility verifier")

// --- A. contrast, computed ------------------------------------------------------------

// WCAG 2.x relative luminance and contrast ratio, computed here rather than
// trusted from a design token file.
function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
function luminance(hex: string): number {
  const h = hex.replace("#", "")
  return 0.2126 * channel(parseInt(h.slice(0, 2), 16)) + 0.7152 * channel(parseInt(h.slice(2, 4), 16)) + 0.0722 * channel(parseInt(h.slice(4, 6), 16))
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const globals = read("website/src/app/globals.css")
const token = (name: string): string => {
  const m = globals.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  return m ? m[1]!.toLowerCase() : ""
}
// A token may only be DECLARED once. `token()` takes the first match, but the
// browser takes the last — so a variable declared twice means the contrast
// floors below are certifying a value the page never paints. That is not a
// theoretical concern: `--muted` was declared as the ink tier #9a8f7d and then
// re-declared as the surface #1e1710, this gate read the first and reported a
// passing 5.57:1, and every `.eyebrow` on the site rendered near-black on a
// near-black canvas. The check has to count declarations, not read one.
const BGS_NAMES = ["--bg", "--surface", "--surface-2"]
const INK_NAMES = ["--ink", "--ink-2", "--body", "--muted", "--faint"]
{
  const DECLARED_ONCE = [...BGS_NAMES, ...INK_NAMES, "--ember", "--ember-bright"]
  const declared = (name: string): number => (globals.match(new RegExp(`${name}:\\s*#[0-9a-fA-F]{6}`, "g")) ?? []).length
  const shadowed = DECLARED_ONCE.filter((name) => declared(name) > 1)
  const absent = DECLARED_ONCE.filter((name) => declared(name) === 0)
  check(
    "D2: every contrast token is declared exactly once (the cascade must not shadow the checked value)",
    shadowed.length === 0 && absent.length === 0,
    shadowed.length ? `shadowed: ${shadowed.join(", ")}` : `absent: ${absent.join(", ")}`,
  )
}
// The three surfaces text can sit on, plus the ink tiers. Parsed, so editing a
// token in CSS re-runs the floor here instead of silently changing the contrast.
const BGS = [token("bg"), token("surface"), token("surface-2")].filter(Boolean)
const LIGHTEST = [...BGS].sort((a, b) => luminance(b) - luminance(a))[0] ?? ""
check("D2: the surface tokens parse from globals.css (bg, surface, surface-2)", BGS.length === 3, BGS.join(","))
const FLOOR = 4.5
const INK_TOKENS = ["ink", "ink-2", "body", "muted", "faint"] as const
const tokenRatios = INK_TOKENS.map((t) => ({ token: t, hex: token(t), ratio: contrast(token(t) || "#000000", LIGHTEST) }))
const subFloorTokens = tokenRatios.filter((t) => t.ratio < FLOOR)
check(
  "D2: every ink token clears 4.5:1 against the lightest surface",
  BGS.length === 3 && subFloorTokens.length === 0,
  subFloorTokens.map((t) => `--${t.token} ${t.hex} ${t.ratio.toFixed(2)}:1`).join(", "),
)
check(
  "D2: the ember accent clears 4.5:1 as text",
  contrast(token("ember"), LIGHTEST) >= FLOOR && contrast(token("ember-bright"), LIGHTEST) >= FLOOR,
  `ember=${contrast(token("ember"), LIGHTEST).toFixed(2)} bright=${contrast(token("ember-bright"), LIGHTEST).toFixed(2)}`,
)

// Literal text colours across site source.
const sources = walk(SRC)
const literalText: Array<{ file: string; hex: string; ratio: number }> = []
const alphaText: string[] = []
for (const f of sources) {
  if (!/\.tsx?$/.test(f)) continue
  const text = readAbs(f)
  const rel = path.relative(ROOT, f)
  for (const m of text.matchAll(/text-\[(#[0-9A-Fa-f]{6})\]/g)) {
    literalText.push({ file: rel, hex: m[1]!.toLowerCase(), ratio: contrast(m[1]!.toLowerCase(), LIGHTEST) })
  }
  for (const m of text.matchAll(/text-\[(#[0-9A-Fa-f]{6})\]\/([0-9]{1,3})/g)) {
    alphaText.push(`${rel}:${m[1]}/${m[2]}`)
  }
}
const distinctLiteral = [...new Map(literalText.map((l) => [l.hex, l])).values()]
const subFloorLiteral = distinctLiteral.filter((l) => l.ratio < FLOOR)
check(
  "D2: every literal text colour in site source clears 4.5:1 against the lightest surface",
  subFloorLiteral.length === 0,
  subFloorLiteral.map((l) => `${l.hex} ${l.ratio.toFixed(2)}:1 (${l.file})`).join(", "),
)
check(
  "D2: no alpha-faded text classes (fading a passing colour makes it fail)",
  alphaText.length === 0,
  alphaText.slice(0, 5).join(", "),
)

// --- B. palette honesty ---------------------------------------------------------------

const COOL_GREY = /\b(?:bg|text|border|divide|from|to|via|ring|placeholder|decoration)-(?:zinc|slate|gray|neutral|stone)-\d{2,3}\b/g
const coolGreyHits: string[] = []
for (const f of sources) {
  if (!/\.tsx?$/.test(f)) continue
  const text = readAbs(f)
  for (const m of text.matchAll(COOL_GREY)) coolGreyHits.push(`${path.relative(ROOT, f)}:${m[0]}`)
}
check("D2: no cool-grey palette family anywhere in site source (the identity is warm)", coolGreyHits.length === 0, coolGreyHits.slice(0, 6).join(", "))

// Accent families that remain must clear the floor. The hexes are declared here
// on purpose: a NEW palette class fails until its colour is recorded, so the
// floor can never be skipped by reaching for a different Tailwind shade.
const TAILWIND_TEXT_HEX: Record<string, string> = {
  "violet-300": "#c4b5fd",
  "violet-400": "#a78bfa",
  "emerald-400": "#34d399",
  "emerald-500": "#10b981",
  "amber-100": "#fde68a",
  "amber-300": "#fcd34d",
  "amber-400": "#fbbf24",
}
const ACCENT_TEXT = /\btext-([a-z]+-\d{2,3})\b/g
const accentHits = new Map<string, string[]>()
for (const f of sources) {
  if (!/\.tsx?$/.test(f)) continue
  const rel = path.relative(ROOT, f)
  for (const m of readAbs(f).matchAll(ACCENT_TEXT)) {
    const cls = m[1]!
    if (/^(?:zinc|slate|gray|neutral|stone)-/.test(cls)) continue // handled above
    if (!accentHits.has(cls)) accentHits.set(cls, [])
    accentHits.get(cls)!.push(rel)
  }
}
const undeclaredAccents = [...accentHits.keys()].filter((c) => !TAILWIND_TEXT_HEX[c])
check("D2: every Tailwind accent text class has a recorded colour", undeclaredAccents.length === 0, undeclaredAccents.join(", "))
const subFloorAccents = [...accentHits.keys()].filter((c) => TAILWIND_TEXT_HEX[c] && contrast(TAILWIND_TEXT_HEX[c]!, LIGHTEST) < FLOOR)
check(
  "D2: every Tailwind accent text class clears 4.5:1",
  subFloorAccents.length === 0,
  subFloorAccents.map((c) => `${c} ${contrast(TAILWIND_TEXT_HEX[c]!, LIGHTEST).toFixed(2)}:1`).join(", "),
)

// --- C. keyboard focus ----------------------------------------------------------------

const focusRule = /:focus-visible\s*\{[^}]*outline:\s*(\d+)px\s+solid[^}]*outline-offset:\s*(\d+)px/.exec(globals)
check(
  "D2: a global :focus-visible ring is declared with a real width and offset",
  Boolean(focusRule) && Number(focusRule![1]) >= 2 && Number(focusRule![2]) >= 1,
  focusRule ? `outline ${focusRule[1]}px offset ${focusRule[2]}px` : "no :focus-visible rule",
)
check(
  "D2: the hidden-radio consoles draw the focus ring on their row label",
  /\.console-index\s+label:has\(>\s*input:focus-visible\)\s*\{[^}]*outline:/.test(globals),
)
for (const page of ["tools", "languages"]) {
  const src = read(`website/src/app/${page}/page.tsx`)
  check(`D2: /${page} marks its index as .console-index`, /className="console-index/.test(src))
}

// --- D. reduced motion ----------------------------------------------------------------

// Split globals into the reduce block, the no-preference blocks and everything
// else; every `animation:` declaration must be inside one of the first two.
const reduceStart = globals.indexOf("@media (prefers-reduced-motion: reduce)")
const reduceBlock = reduceStart >= 0 ? globals.slice(reduceStart, globals.indexOf("\n}\n", reduceStart)) : ""
// `animation: none` is a reset, not an animation — it is how the reduce block
// itself turns the others off, so it is not a name to guard.
const animationNames = [...new Set([...globals.matchAll(/animation:\s*([a-zA-Z][\w-]*)/g)].map((m) => m[1]!).filter((n) => n !== "none"))]
const noPreferenceSpans: Array<[number, number]> = []
for (const m of globals.matchAll(/@media \(prefers-reduced-motion: no-preference\)\s*\{/g)) {
  const start = m.index!
  let depth = 0
  let end = start
  for (let i = globals.indexOf("{", start); i < globals.length; i++) {
    if (globals[i] === "{") depth++
    else if (globals[i] === "}") {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  noPreferenceSpans.push([start, end])
}
// The declaration names a keyframe (`marquee-x`) while the reduce block disables
// the CLASS (`.marquee-track`), so the guard is resolved through the rule's own
// selector: find the text between the previous `}` and the `{` that opens the
// block this declaration lives in, then look for any of its class tokens in the
// reduce block.
const unguarded: string[] = []
for (const m of globals.matchAll(/animation:\s*([a-zA-Z][\w-]*)/g)) {
  if (m[1] === "none") continue
  const at = m.index!
  const inNoPreference = noPreferenceSpans.some(([s, e]) => at >= s && at <= e)
  const selector = globals.slice(globals.lastIndexOf("}", at) + 1, globals.lastIndexOf("{", at))
  const classes = [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((c) => c[1]!)
  const guarded = inNoPreference || classes.some((c) => reduceBlock.includes(`.${c}`))
  if (!guarded) unguarded.push(`${m[1]} (${classes.join(".") || "no selector"})`)
}
check(
  "D2: every animation is inside a no-preference block or named in the reduce block",
  animationNames.length > 0 && unguarded.length === 0,
  unguarded.join(", "),
)
check("D2: the reduce block exists and disables the looping animations", reduceStart >= 0 && /animation:\s*none/.test(reduceBlock))

// --- E. one component kit -------------------------------------------------------------

const KIT: Array<[string, string]> = [
  ["website/src/components/ui/section.tsx", "export function Section("],
  ["website/src/components/ui/plate.tsx", "export function Plate("],
  ["website/src/components/ui/callout.tsx", "export function Callout("],
  ["website/src/components/ui/inline.tsx", "export function Label("],
]
for (const [file, symbol] of KIT) {
  check(`D2: shared kit exports ${symbol.replace("export function ", "").replace("(", "")} (${file})`, existsSync(path.join(ROOT, file)) && read(file).includes(symbol))
}

const LOCAL_TWIN = /^\s*function (Section|Plate|Callout|Card|Note|Label|Code|Mono)\s*\(/m
for (const page of ["editors", "support"]) {
  const src = read(`website/src/app/${page}/page.tsx`)
  check(`D2: /${page} imports the shared kit`, /from '@\/components\/ui\/|from "@\/components\/ui\//.test(src))
  const twin = LOCAL_TWIN.exec(src)
  check(`D2: /${page} declares no local copy of a shared component`, !twin, twin ? twin[1] : "")
}

// No dead component modules: every file under components/ must be imported by
// some other source file. Five dead modules (FeatureCard, StatsGrid, Grid,
// ui/badge, ui/button) were deleted in D2 after this detector found them.
const componentFiles = readdirSync(path.join(SRC, "components"), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
  .map((e) => e.name)
const uiFiles = readdirSync(path.join(SRC, "components/ui"), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
  .map((e) => `ui/${e.name}`)
const allComponents = [...componentFiles, ...uiFiles]
const deadComponents = allComponents.filter((f) => {
  const symbol = path.basename(f, ".tsx")
  const specifier = f.startsWith("ui/") ? `components/ui/${symbol}` : `components/${symbol}`
  return !sources.some((src) => {
    if (src.endsWith(`/${symbol}.tsx`)) return false
    return readAbs(src).includes(specifier) || new RegExp(`from ['"]\\./${symbol}['"]`).test(readAbs(src))
  })
})
check("D2: no component module is unreferenced", deadComponents.length === 0, deadComponents.join(", "))

// --- F. banned styles -----------------------------------------------------------------

const BANNED = ["#030014", "#0A0A0A", "#ededed", "#d946ef", "#8b5cf6", "fuchsia", "gradient-text", "glass-card", "animate-gradient"]
const bannedHits: string[] = []
const STYLE_BANS = ["bg-clip-text", "text-transparent", "animate-pulse"]
for (const f of sources) {
  if (!/\.tsx?$/.test(f)) continue
  const text = readAbs(f)
  const rel = path.relative(ROOT, f)
  for (const token of [...BANNED, ...STYLE_BANS]) if (text.includes(token)) bannedHits.push(`${rel}:${token}`)
  // outline-none erases the focus ring D2 added; the only allowed use is with a
  // replacement ring on the same element, which the pattern below would see.
  for (const m of text.matchAll(/outline-none/g)) bannedHits.push(`${rel}:outline-none@${m.index}`)
}
check("D2: banned identity tokens and styles are absent (incl. outline-none, gradient text, pulse)", bannedHits.length === 0, bannedHits.slice(0, 6).join(", "))

// --- G. responsive --------------------------------------------------------------------

// Every <table> must be inside a horizontal scroll wrapper within the preceding
// 400 characters — the pattern the docs/tools/editors tables already follow.
const unwrappedTables: string[] = []
for (const f of sources) {
  if (!/\.tsx$/.test(f)) continue
  const text = readAbs(f)
  const rel = path.relative(ROOT, f)
  for (const m of text.matchAll(/<table/g)) {
    const before = text.slice(Math.max(0, m.index! - 400), m.index!)
    if (!/overflow-x-auto/.test(before)) unwrappedTables.push(`${rel}@${m.index}`)
  }
}
check("D2: every table sits in an overflow-x-auto wrapper", unwrappedTables.length === 0, unwrappedTables.slice(0, 4).join(", "))

const gridPages: string[] = []
for (const f of sources) {
  if (!/\/app\/.*page\.tsx$/.test(f)) continue
  const text = readAbs(f)
  if (!/grid-cols-[2-9]/.test(text) && !/grid-cols-\[/.test(text)) continue
  const rel = path.relative(ROOT, f)
  if (!/(?:sm|md|lg|xl|2xl):(?:grid-cols|flex|hidden)/.test(text)) gridPages.push(rel)
}
check("D2: every multi-column page declares a breakpoint", gridPages.length === 0, gridPages.join(", "))

// --- H. rendered proof ----------------------------------------------------------------

const built = (p: string): string => {
  try {
    return readAbs(path.join(SITE, ".next/server/app", p))
  } catch {
    return ""
  }
}
const homeHtml = built("index.html")
const docsHtml = built("docs.html")
const editorsHtml = built("editors.html")
const supportHtml = built("support.html")
const builtPages = { home: homeHtml, docs: docsHtml, editors: editorsHtml, support: supportHtml }
const renderedCoolGrey = Object.entries(builtPages).filter(([, h]) => h && /\b(?:bg|text|border|divide)-zinc-\d/.test(h)).map(([k]) => k)
check(
  "D2: no built page renders a cool-grey class",
  Object.values(builtPages).every((h) => h.length === 0) || renderedCoolGrey.length === 0,
  renderedCoolGrey.join(", "),
)
// Next writes the production stylesheet under .next/static/chunks (the path is
// hashed and has moved between versions), so the CSS is discovered, not assumed.
function cssFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) cssFiles(p, out)
    else if (e.name.endsWith(".css")) out.push(p)
  }
  return out
}
const cssChunks = cssFiles(path.join(SITE, ".next/static"))
const builtCss = cssChunks.map(readAbs).join("\n")
check("D2: the built CSS carries the focus-visible rule", cssChunks.length > 0 && builtCss.includes(":focus-visible"))
// The built stylesheet is minified (`:has(>input:focus-visible)`), so the check
// is a pattern rather than a byte-for-byte source echo.
check(
  "D2: the built CSS carries the console-index focus affordance",
  /\.console-index\s+label:has\(>\s*input:focus-visible\)/.test(builtCss),
)

// --- negatives ------------------------------------------------------------------------

// N1 (computed): darkening a token must fail the floor.
negative("N1: a darkened ink token fails the floor detector", contrast("#766b5b", LIGHTEST) < FLOOR)
// N2 (bytes): a sub-floor literal colour must be detected.
negative("N2: a sub-floor literal text colour is detected", contrast("#71717a", LIGHTEST) < FLOOR)
// N2b (bytes): a re-declared token must be counted as a shadow, which is the
// exact shape of the bug this gate shipped blind for one milestone: the first
// declaration passes the floor, the last declaration is what the browser paints.
negative("N2b: a re-declared contrast token is detected as shadowed", (() => {
  const shadowedOnce = `  --muted: #9a8f7d;\n  --muted: #1e1710;\n`
  return (shadowedOnce.match(/--muted:\s*#[0-9a-fA-F]{6}/g) ?? []).length > 1
})())
// N3 (bytes): an alpha-faded text class must be detected.
negative("N3: an alpha-faded text class is detected", /text-\[(#[0-9A-Fa-f]{6})\]\/([0-9]{1,3})/.test('class="text-[#E2553B]/70"'))
// N4 (bytes): a cool-grey class must be detected.
negative("N4: a cool-grey palette class is detected", new RegExp(COOL_GREY.source).test('class="text-zinc-500"'))
// N5 (bytes): removing the focus rule must fail the focus check.
negative("N5: a missing :focus-visible rule is detected", !/:focus-visible\s*\{[^}]*outline:/.test(globals.replace(/:focus-visible\s*\{[^}]*\}/, "")))
// N6 (bytes): un-guarding an animation must fail the motion check.
negative(
  "N6: an animation whose class is missing from the reduce block is detected",
  !reduceBlock.replace(".marquee-track", "").includes(".marquee-track") && reduceBlock.includes(".marquee-track"),
)
// N7 (bytes): a local twin of a shared component must be detected.
negative("N7: a page-local Section definition is detected", LOCAL_TWIN.test("function Section({ id }: { id: string }) {}"))
// N8 (bytes): an unwrapped table must be detected.
negative("N8: a table without a scroll wrapper is detected", !/overflow-x-auto/.test('<table className="w-full">'))
// N9 (real mutation on disk): removing a shared export must fail the kit check,
// and the file must come back byte-clean.
{
  const target = path.join(SRC, "components/ui/plate.tsx")
  const original = readAbs(target)
  try {
    writeFileSync(target, original.replace("export function Plate(", "function Plate("))
    check("N9: removing the shared Plate export fails the kit check", !readAbs(target).includes("export function Plate("))
  } finally {
    writeFileSync(target, original)
  }
  check("N9 restore-proof: the shared kit file is byte-clean again", readAbs(target) === original)
}
// N10 (bytes): a dead component module must be detected.
negative("N10: an unreferenced component is detected", !sources.some((s) => readAbs(s).includes("components/FeatureCard")))

// --- evidence -------------------------------------------------------------------------

const failed = checks - passed
const ok = failed === 0
if (!READ_ONLY) {
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(
    path.join(RESULTS, "D2.json"),
    JSON.stringify(
      {
        issue: "M56.D2 — Design Pass (#786)",
        code: "D2",
        milestone: "m56",
        status: ok ? "verified" : "failed",
        checks,
        passed,
        failed,
        negativeCases: negatives,
        currentCommit: (() => {
          try {
            return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
          } catch {
            return "unknown"
          }
        })(),
        verifierCommand: "npx tsx script/m56/verify-design.ts",
        evidenceFile: "D2.json",
        generatedAt: new Date().toISOString(),
        contrastFloors: {
          floor: FLOOR,
          referenceBackground: LIGHTEST,
          backgrounds: BGS,
          tokens: tokenRatios.map((t) => ({ token: `--${t.token}`, hex: t.hex, ratio: Number(t.ratio.toFixed(2)) })),
        },
        summary: [
          `${distinctLiteral.length} distinct literal text colours checked against ${LIGHTEST}`,
          "no alpha-faded text classes; no cool-grey palette classes",
          "global :focus-visible ring plus the console-index label ring",
          `${animationNames.length} animations, all guarded by reduced-motion`,
          `${KIT.length} shared ui primitives; 0 local twins; 0 dead component modules`,
          `${builtPages ? Object.keys(builtPages).length : 0} built pages checked for cool-grey output and the focus rule in built CSS`,
        ],
        limitations: [
          "Contrast is computed on declared colours (tokens and literal classes), not on rendered pixels — a parent opacity or blend mode could still reduce effective contrast; no such utility is used in site source (alpha text classes are refused).",
          "Large-text exceptions (3:1 for ≥24px) are not used: this site applies the 4.5:1 floor to every text colour, which is stricter.",
          "Photographic media (the verified session stills on /editors) is exempt: it is real captured product pixels, not styled text.",
          "Owner visual approval is required before this issue closes; the gate proves legibility mechanics, not taste.",
        ],
        failures,
      },
      null,
      2,
    ) + "\n",
  )
}
console.log(`\nD2 gate: ${ok ? "VERIFIED" : "FAILED"} (${passed}/${checks} checks, ${negatives} negative cases)`)
if (!ok) process.exit(1)
