/**
 * CSS EXTENDED-TYPE CENSUS — the four extended values plus the two open CANONICAL gaps
 * (`calls`, `exports`), over the WHOLE admitted population, parse-only, leak-guarded.
 *
 * WHY THIS FILE EXISTS. The css lane is 5/11 with SIX gaps — the widest in the fleet — and the
 * owner's bar is RULING IS THE LAST RESORT. scss is this lane's closest precedent and it is DONE,
 * so its two implemented types (mixes_in from `include_statement`, part_of from Sass-form
 * `@import`) and its two rulings (decorates ONTOLOGICAL, renders GRAMMAR-ABSENCE) transfer ONLY
 * where their falsifiers do not fire in THIS language (Form 16). This instrument measures every
 * falsifier on the css corpus before any rung is chosen:
 *
 *   part_of    the falsifier is a FILE-INCLUSION import form — a specifier that is not a url(),
 *              not a media-query companion, not `.css`, not a protocol. scss ruled its 3,626
 *              Sass-form sites `part_of` and its 12 CSS-form sites `imports`; plain CSS is the
 *              SUPerset language and the css lane ALSO carries `.less`, whose non-`.css`
 *              `@import` INLINES the file at compile time (the same semantics).
 *   mixes_in   the falsifier is a construct that APPLIES a mixin. Plain CSS has NO mixin
 *              construct (that is the Sass extension) — but `@apply` (Tailwind) applies a utility
 *              LIST to a rule, and CSS Modules `composes:` applies a class, so BOTH are counted
 *              beside the ruling rather than assumed away.
 *   decorates  the falsifier is a construct that APPLIES A NAMED CALLABLE to a declaration.
 *              CSS's `!important` is the scss near miss and is COUNTED; CSS Functions & Mixins L4
 *              `@function --add(a,b)` is the grammar-remedy candidate and is COUNTED by keyword.
 *   renders    the falsifier is a `content:`/`@apply` value that IS a component name. CSS
 *              `content:` produces a VALUE; `@apply`'s utility list is the closest construct and
 *              is counted for its name-shape (are utilities component names? MEASURED).
 *
 * THE TWO CANONICAL GAPS this census also measures (the "which two" of the six):
 *   calls      `@function --add(...)` (CSS Functions L4) and `call_expression` names that are NOT
 *              built-ins — a user-defined function construct would make `calls` implementable at
 *              R3/R2; the current census artifact (CSS-D14) counted 341,686 call_expression nodes
 *              with 90 distinct names ALL built-ins, but that predates the population correction.
 *   exports    `composes:` / `:export` — the CSS-Modules convention, counted on the tree (the
 *              spec's zero-sites exclusion cites CSS-D14's 0; that census walked `.css` only, so
 *              the `.less` half of the population was never measured for it).
 *
 * THE LEAK GUARD IS THE FIRST THING IT DOES (the cpp lane's Tenth Form): every tree is deleted in
 * a `finally`, `filesRead === filesAdmitted` is checked, and the process EXITS 5 when it is not.
 * A run that did not cover the population is NOT the population and must not be published.
 *
 * POPULATION RULE (fleet rule, FLEET-RULINGS §1): the GIT-TRACKED set per checkout, extension list
 * from `script/m14/language-extensions.ts` (`css: "css,less,sass"` — the router maps `.less` and
 * `.sass` to THIS analyzer), present on disk, `<= 1 MiB`, dedup by realpath. MEASURED 2026-10-24
 * with this rule: 1,303 tracked paths, 2 over the cap, 5 tracked-but-absent -> 1,296 admitted over
 * 88 repositories. This instrument writes that artifact first so the census and any later arm read
 * ONE file instead of each re-deriving the set.
 *
 * RUN (whole population, writes the artifact):
 *   bun validation/m14/census/css-extended-census.ts
 * RUN (a measured screen; a sample is NEVER a publication):
 *   bun validation/m14/census/css-extended-census.ts --limit=120
 * EXIT: 0 wrote · 2 bad flag · 3 corpus unreadable · 4 a file could not be read at all ·
 *       5 the leak guard tripped (filesRead !== filesAdmitted).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync, realpathSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { getParser } from "../../../src/ast/engine"
import { resolveWasmAsset } from "../../../src/util/wasm"

const ROOT = resolve(import.meta.dir, "../../..")
const CORPUS = resolve(ROOT, ".corpus")
const OUT = resolve(ROOT, "validation/m14/measurements/css-extended-census.json")
const POP_OUT = resolve(ROOT, "validation/m14/measurements/css-population.json")

/** `script/m14/language-extensions.ts`: css: "css,less,sass" — the router maps `.less` and `.sass`
 *  to THIS analyzer, so this lane admits all three. */
const EXTS = ["css", "less", "sass"]
const CAP_BYTES = 1024 * 1024

const argv = process.argv.slice(2)
const LIMIT = (() => {
  const raw = argv.find((a) => a.startsWith("--limit="))
  if (!raw) return 0
  const n = Number.parseInt(raw.slice("--limit=".length), 10)
  if (!Number.isInteger(n) || n < 0) {
    console.error(`--limit must be a non-negative integer (got "${raw}")`)
    process.exit(2)
  }
  return n
})()

// ── the population: ONE artifact for the census and any later arm ──────────────────────────────
if (!existsSync(CORPUS)) {
  console.error(`NO CORPUS at ${CORPUS} — the population root does not exist`)
  process.exit(3)
}
const seen = new Set<string>()
const allFiles: string[] = []
const repoRows: Array<{ repo: string; tracked: number; admitted: number }> = []
let trackedTotal = 0, absentTotal = 0, overCapTotal = 0
for (const repo of readdirSync(CORPUS)) {
  const dir = resolve(CORPUS, repo)
  let st
  try { st = statSync(dir) } catch { continue }
  if (!st.isDirectory()) continue
  let names: string[] = []
  try {
    const out = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 })
    names = out.toString("utf8").split("\u0000").filter(Boolean).filter((p) => EXTS.includes((p.split(".").pop() ?? "").toLowerCase()))
  } catch { continue }
  if (names.length === 0) continue
  let nTr = 0, nAdm = 0, nAbs = 0, nCap = 0
  for (const rel of names) {
    nTr++
    const full = resolve(dir, rel)
    if (!existsSync(full)) { nAbs++; continue }
    let size = 0
    try { size = statSync(full).size } catch { nAbs++; continue }
    if (size > CAP_BYTES) { nCap++; continue }
    const rp = realpathSync(full)
    if (seen.has(rp)) continue
    seen.add(rp)
    nAdm++
    allFiles.push(`${repo}/${rel}`)
  }
  trackedTotal += nTr; absentTotal += nAbs; overCapTotal += nCap
  repoRows.push({ repo, tracked: nTr, admitted: nAdm })
}
allFiles.sort()
const POPULATION_STRING = `parsed=${allFiles.length}/${allFiles.length} admitted=${allFiles.length} exts=${EXTS.join(",")} index=no`

// a sample is a SAMPLE and is labelled as one; a whole-population run is the only thing written
// to the canonical artifact path.
let files: string[]
let sampleLabel = ""
if (LIMIT > 0) {
  const stride = Math.max(1, Math.ceil(allFiles.length / LIMIT))
  files = allFiles.filter((_, i) => i % stride === 0).slice(0, LIMIT)
  sampleLabel = `SAMPLE, ${files.length} files (every ${stride}th of ${allFiles.length} sorted admitted) — NOT A POPULATION`
} else {
  files = allFiles
}

// ── R1: the SERVED build's own identity and node inventory ──────────────────────────────────────
const parser = await getParser("css")
const language: any = (parser as any).language
const totalIds: number = language?.nodeTypeCount ?? 0
const allTypeNames: string[] = []
const namedTypeNames: string[] = []
for (let id = 0; id < totalIds; id++) {
  const name = String(language?.nodeTypeForId(id) ?? "")
  allTypeNames.push(name)
  if (language?.nodeTypeIsNamed(id)) namedTypeNames.push(name)
}
const servedWasmPath = resolveWasmAsset("tree-sitter-css.wasm")
const servedDigest = existsSync(servedWasmPath) ? createHash("sha256").update(readFileSync(servedWasmPath)).digest("hex") : ""
const R1_STEMS = ["decorat", "annotation", "attribute", "application", "modifier", "render", "component", "jsx", "template", "markup", "element", "part", "mixin", "content", "include", "apply", "compose"]
const r1StemMatches: Record<string, string[]> = {}
for (const stem of R1_STEMS) r1StemMatches[stem] = allTypeNames.filter((n) => n.toLowerCase().includes(stem))

// ── the counts ──────────────────────────────────────────────────────────────────────────────────
function newCounts() {
  return {
    // population guards
    files: files.length, filesRead: 0, filesFailed: 0, filesWithErrors: 0, errorNodes: 0,
    // part_of: the @import census, by the scss discriminator's OWN shape rules
    importSites: 0,
    importPlainFileForm: 0,        // THE FALSIFIER CLASS: one string_value, not .css/url/media/protocol
    importCssUrlForm: 0,
    importCssMediaForm: 0,
    importCssDotCssForm: 0,
    importCssProtocolForm: 0,
    importOtherShape: 0,
    importPlainFileFormLess: 0,    // by extension: does the plain form live in .less/.sass (inline) or .css (a plain-CSS relative import)?
    importPlainFileFormCss: 0,
    importPlainFileFormSass: 0,
    importPlainFormNamesProjectFile: 0, // the specifier answers to an admitted file by the sibling spelling arithmetic
    importPlainFormNamesNothingAdmitted: 0,
    // calls: user-defined functions are the falsifier class
    atFunctionSites: 0,            // `@function --add(a, b) { … }` — CSS Functions & Mixins L4
    atFunctionNameSamples: [] as string[],
    atFunctionDeclaredNames: [] as string[], // the declared function names, for the invocation falsifier
    atFunctionInvokedNames: [] as string[],  // declared names that ARE invoked — the calls R3 discriminator
    callExpressionNodes: 0,
    callExpressionDistinctNames: 0,
    callExpressionNonBuiltinNames: 0,
    callExpressionNonBuiltinSamples: [] as string[],
    // exports: the CSS-Modules convention, on the tree
    composesDeclarations: 0,
    composesFromDeclarations: 0,
    exportBlockRuleSets: 0,
    // mixes_in: no mixin construct in plain CSS; count the appliers beside the ruling
    applySites: 0,                 // Tailwind @apply — applies a utility LIST to a rule
    applyUtilityTokens: 0,
    composesAppliesClass: 0,       // composes: x; applies class x (counted under exports too)
    // mixes_in's deciding shape probe (a tracked citation for the ERROR-recovery finding):
    lessMixinInvokeLines: 0,       // a text statement line that is only `.name();` / `.name;` / `.name(arg);` in a .less file
    lessMixinInvokeFiles: 0,
    lessMixinInvokeSamples: [] as string[],
    lessMixinInvokeInCleanFiles: 0,  // of those lines, the count in files the css grammar parses CLEAN —
    lessMixinInvokeInErrorFiles: 0,  // the split that decides the rung: an invocation inside an ERROR subtree
    // decorates: the near miss, counted
    importantSites: 0,             // `!important` — a modifier that names no callable
    atMixinKeywordSites: 0,        // any `@mixin` text (0 expected in plain css/less/sass)
    // renders: the near miss, counted
    contentDeclarations: 0,
    contentCapitalizedComponentShape: 0,
    contentCapitalizedInStringValue: 0,
    pseudoElementSelectors: 0,
  }
}
const counts = newCounts()
const builtinFn = new Set(["var", "calc", "rgba", "rgb", "url", "attr", "counter", "counters", "translate", "translateX", "translateY", "scale", "scaleX", "scaleY", "rotate", "skew", "perspective", "linear-gradient", "radial-gradient", "conic-gradient", "repeating-linear-gradient", "repeating-radial-gradient", "min", "max", "clamp", "env", "cos", "sin", "tan", "acos", "asin", "atan", "atan2", "pow", "sqrt", "hypot", "log", "exp", "abs", "sign", "round", "mod", "rem", "cubic-bezier", "steps", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color", "color-mix", "color-contrast", "fit-content", "repeat", "minmax", "fit-content", "format", "local", "matrix", "matrix3d", "translate3d", "rotate3d", "rotateX", "rotateY", "rotateZ", "scale3d", "skewX", "skewY", "blur", "brightness", "contrast", "drop-shadow", "grayscale", "hue-rotate", "invert", "opacity", "saturate", "sepia", "element", "cross-fade", "image-set", "paint", "symbols", "rect", "clip-path", "inset", "polygon", "path", "circle", "ellipse", "color-adjust", "not", "is", "where", "has", "lang", "dir", "nth-child", "nth-last-child", "nth-of-type", "nth-last-of-type", "selector", "if", "when", "else", "supports", "media", "container", "custom-props", "regexp", "progid"])
const fnNamesSeen = new Set<string>()
const nonBuiltinSeen = new Set<string>()
const plainFormSamples: string[] = []
const plainFormTargets = new Map<string, number>()
/** the names declared by `@function --x(...)`-style sites — THE FALSIFIER INVENTORY for `calls`:
 *  a declared name that IS invoked somewhere in the population is a `calls` site no analyzer can
 *  refuse; a declared name with 0 invocations keeps the construct a near miss. Measured via the
 *  at_keyword token's own line, bounded by the 12 samples above. */
const atFunctionDeclaredNamesSet = new Set<string>()

/** the scss discriminator's own shape test, transcribed: the FILE-INCLUSION form is exactly one
 *  `string_value` named child whose specifier is not `.css`, not a protocol/`//` URL, not
 *  `sass:`/`data:` — and a media-query companion is a SECOND named child, so it fails this test. */
function importPlainFileForm(node: any): { spec: string } | null {
  const named: any[] = []
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) named.push(c)
  }
  if (named.length !== 1 || named[0]!.type !== "string_value") return null
  const spec = stripQuotes(String(named[0]!.text).trim())
  if (spec.length === 0) return null
  const lower = spec.toLowerCase()
  if (lower.endsWith(".css")) return null
  if (lower.includes(".css?") || lower.includes(".css#")) return null
  if (lower.startsWith("//") || lower.startsWith("http://") || lower.startsWith("https://")) return null
  if (lower.startsWith("sass:") || lower.startsWith("data:")) return null
  return { spec }
}
function stripQuotes(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1)
  return t
}
function classifyImportForm(node: any): "plain" | "url" | "media" | "dotcss" | "protocol" | "other" {
  const p = importPlainFileForm(node)
  if (p) return "plain"
  const text = String(node.text ?? "")
  if (/url\(/i.test(text)) return "url"
  const named: any[] = []
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) named.push(c)
  }
  if (named.length === 1 && named[0]!.type === "string_value") {
    const spec = stripQuotes(String(named[0]!.text).trim()).toLowerCase()
    if (spec.endsWith(".css")) return "dotcss"
    if (spec.startsWith("//") || spec.startsWith("http://") || spec.startsWith("https://") || spec.startsWith("data:")) return "protocol"
  }
  if (named.length > 1) return "media"
  return "other"
}

/** the sibling spelling arithmetic the css analyzer's file-claim guard uses: a plain-form
 *  specifier resolves against the importing file's own directory, with and without the extension
 *  families this analyzer admits, and with the leading-underscore partial spelling. */
function projectFileExists(repoRoot: string, importingRel: string, spec: string): boolean {
  const dir = resolve(repoRoot, dirnameOf(importingRel))
  const base = spec.replace(/^\.\//, "")
  const candidates = [
    base,
    `${base}.css`, `${base}.less`, `${base}.sass`, `${base}.scss`,
    base.replace(/^_/, ""), `${base.replace(/^_/, "")}.css`, `${base.replace(/^_/, "")}.less`, `${base.replace(/^_/, "")}.sass`,
    `_${base}`, `_${base}.css`, `_${base}.less`, `_${base}.sass`,
  ]
  for (const c of candidates) {
    if (existsSync(resolve(dir, c))) return true
  }
  return false
}
function dirnameOf(p: string): string {
  const i = p.lastIndexOf("/")
  return i < 0 ? "" : p.slice(0, i)
}

// ── the walk ───────────────────────────────────────────────────────────────────────────────────
for (const rel of files) {
  const slash = rel.indexOf("/")
  const repo = rel.slice(0, slash)
  const withinRepo = rel.slice(slash + 1)
  const full = resolve(CORPUS, rel)
  let src: string
  try {
    src = readFileSync(full, "utf8")
    counts.filesRead++
  } catch {
    counts.filesFailed++
    continue
  }
  let tree: any
  try {
    tree = parser.parse(src)
  } catch {
    counts.filesFailed++
    continue
  }
  try {
    if (tree.rootNode?.hasError) counts.filesWithErrors++
    // ── mixes_in's deciding shape probe: the LESS mixin-invocation statement line ─────────────
    // `.larger(10);` / `.fa-icon;` / `.fa-sr-only();` — a text line inside a block that is ONLY a
    // class-invocation. Counted text-anchored because the PARSE shape is the finding itself: the
    // served css grammar has no production for a mixin invocation, so the line lands in an ERROR
    // subtree (the clean/error split below is the rung decision — an invocation an analyzer can
    // only meet inside recovery is not a walkable node, which is the R3-unavailable measurement).
    if (withinRepo.toLowerCase().endsWith(".less")) {
      let fileInvokes = 0
      for (const line of src.split("\n")) {
        const tline = line.trim()
        if (/^(\.[A-Za-z_][\w-]*)(\s*\([^)]*\))?\s*;?$/.test(tline) && !tline.includes("{")) {
          fileInvokes++
          counts.lessMixinInvokeLines++
          if (counts.lessMixinInvokeSamples.length < 12) counts.lessMixinInvokeSamples.push(`${rel}: ${tline}`)
        }
      }
      if (fileInvokes > 0) {
        counts.lessMixinInvokeFiles++
        if (tree.rootNode?.hasError) counts.lessMixinInvokeInErrorFiles += fileInvokes
        else counts.lessMixinInvokeInCleanFiles += fileInvokes
      }
    }
    // walk every named node
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (!n) continue
      const t = String(n.type ?? "")
      if (t === "ERROR") counts.errorNodes++
      if (t === "import_statement") {
        counts.importSites++
        const form = classifyImportForm(n)
        if (form === "plain") {
          counts.importPlainFileForm++
          const ext = (withinRepo.split(".").pop() ?? "").toLowerCase()
          if (ext === "less") counts.importPlainFileFormLess++
          else if (ext === "sass") counts.importPlainFileFormSass++
          else counts.importPlainFileFormCss++
          const spec = importPlainFileForm(n)!.spec
          plainFormTargets.set(spec, (plainFormTargets.get(spec) ?? 0) + 1)
          if (plainFormSamples.length < 15) plainFormSamples.push(`${rel}: ${String(n.text).trim()}`)
          if (projectFileExists(resolve(CORPUS, repo), withinRepo, spec)) counts.importPlainFormNamesProjectFile++
          else counts.importPlainFormNamesNothingAdmitted++
        } else if (form === "url") counts.importCssUrlForm++
        else if (form === "media") counts.importCssMediaForm++
        else if (form === "dotcss") counts.importCssDotCssForm++
        else if (form === "protocol") counts.importCssProtocolForm++
        else counts.importOtherShape++
      }
      if (t === "call_expression") {
        counts.callExpressionNodes++
        const fnNode = firstChildByType(n, "function_name") ?? firstChildByType(n, "identifier")
        if (fnNode) {
          const name = stripQuotes(String(fnNode.text).trim())
          fnNamesSeen.add(name)
          if (!builtinFn.has(name.toLowerCase()) && !builtinFn.has(name)) {
            nonBuiltinSeen.add(name)
          }
        }
      }
      if (t === "at_keyword") {
        // @function / @mixin counted at the KEYWORD TOKEN — the grammar has no production for
        // either (they arrive as a generic at_keyword under at_rule, or inside ERROR recovery),
        // so the token count is the honest unit. The 10 measured @function sites are all in one
        // BULMA VENDORED .sass file, whose declared names this census lists beside the count.
        const kwText = String(n.text ?? "").trim().toLowerCase()
        if (kwText.startsWith("@function")) {
          counts.atFunctionSites++
          if (counts.atFunctionNameSamples.length < 12) counts.atFunctionNameSamples.push(`${rel}: ${String(n.text).trim().slice(0, 80)}`)
          // the declared NAME is the token after @function on the same line (the census reads the
          // FILE TEXT at the token's line — the grammar gives the body no node to read it from)
          const line = String(n.text ?? "").trim()
          const m = line.match(/@function\s+([A-Za-z_][\w-]*)/) ?? (src.split("\n")[(Number(n.startPosition?.row ?? 0))]?.match(/@function\s+([A-Za-z_][\w-]*)/))
          if (m) atFunctionDeclaredNamesSet.add(m[1]!)
        }
        if (kwText.startsWith("@mixin")) counts.atMixinKeywordSites++
      }
      if (t === "at_rule") {
        // @apply counted PARSE-ANCHORED ONLY: an at_rule whose at_keyword child IS @apply.
        // (The first version matched the keyword TEXT on the at_rule AND its at_keyword child and
        // read 3,180 — a mixed count no rule names. The at_rule-anchored shape is the one an
        // analyzer can walk; the text-level BOUND is 2,939 substring occurrences, most of them
        // inside ERROR-recovered tailwind text where no at_rule forms.)
        let kw = ""
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && String(c.type) === "at_keyword") { kw = String(c.text).trim().toLowerCase(); break }
        }
        if (kw === "@apply") {
          counts.applySites++
          const body = String(n.text).trim().replace(/^@apply\s*/i, "").split(/[;}]/)[0]!
          counts.applyUtilityTokens += body.split(/[\s,]+/).filter((x) => x.length > 0 && !x.startsWith("@")).length
        }
      }
      if (t === "declaration") {
        const propNode = firstChildByType(n, "property_name")
        const propName = propNode ? String(propNode.text).trim().toLowerCase() : ""
        if (propName === "composes") {
          counts.composesDeclarations++
          counts.composesAppliesClass++
          const valText = childTextOfDeclaration(n)
          if (/\bfrom\b/.test(valText)) counts.composesFromDeclarations++
        }
        if (propName === "content") {
          counts.contentDeclarations++
          const valText = childTextOfDeclaration(n)
          // the component-name predicate: a CAPITALIZED IDENTIFIER-shaped value, not a quoted string
          const m = valText.match(/(^|[\s(])([A-Z][A-Za-z0-9_-]*)($|[\s);])/)
          if (m) {
            const quoted = new RegExp(`["'][\\s\\S]*${m[2]}[\\s\\S]*["']`).test(valText)
            if (quoted) counts.contentCapitalizedInStringValue++
            else {
              counts.contentCapitalizedComponentShape++
            }
          }
        }
        if (String(n.text ?? "").includes("!important")) counts.importantSites++
      }
      if (t === "selectors") {
        // :export { } arrives as a rule_set whose first selector is :export — counted at rule_set below
      }
      if (t === "rule_set") {
        const selNode = firstChildByType(n, "selectors")
        const selText = selNode ? String(selNode.text).trim() : ""
        if (/^:export\b/i.test(selText)) counts.exportBlockRuleSets++
      }
      if (t === "pseudo_element_selector") counts.pseudoElementSelectors++
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  } finally {
    if (tree?.delete) tree.delete()
  }
}
counts.callExpressionDistinctNames = fnNamesSeen.size
counts.callExpressionNonBuiltinNames = nonBuiltinSeen.size
counts.callExpressionNonBuiltinSamples = [...nonBuiltinSeen].slice(0, 40)
counts.atFunctionNameSamples = counts.atFunctionNameSamples.slice(0, 12)
counts.atFunctionDeclaredNames = [...atFunctionDeclaredNamesSet].sort()
// the INVOCATION half of the calls falsifier: a declared name that IS invoked in the population.
// A NONZERO list keeps `calls` a live R3 candidate; an EMPTY one is the measured near miss the
// ruling cites (10 declarations, 0 invocations).
counts.atFunctionInvokedNames = [...atFunctionDeclaredNamesSet].filter((nm) => fnNamesSeen.has(nm))

// ── the leak guard (Tenth Form): a run that did not cover the population is not the population ──
if (counts.filesRead + counts.filesFailed !== counts.files) {
  console.error(`LEAK GUARD: filesRead ${counts.filesRead} + filesFailed ${counts.filesFailed} !== files ${counts.files}`)
  process.exit(5)
}

// ── write ───────────────────────────────────────────────────────────────────────────────────────
const artifact = {
  instrument: "validation/m14/census/css-extended-census.ts",
  populationRule: "git-tracked per checkout · exts css,less,sass (script/m14/language-extensions.ts) · present on disk · <=1MiB · dedup realpath · root .corpus",
  population: {
    tracked: trackedTotal,
    admitted: allFiles.length,
    absent: absentTotal,
    overCap: overCapTotal,
    repositories: repoRows.length,
    populationString: POPULATION_STRING,
  },
  sample: sampleLabel || null,
  served: {
    wasmPath: servedWasmPath,
    sha256: servedDigest,
    nodeTypeIds: totalIds,
    namedTypeNames,
    r1StemMatches,
  },
  counts,
  plainFormTargets: [...plainFormTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60),
  plainFormSamples,
  notes: {
    part_of: "the falsifier class is importPlainFileForm: one string_value child, specifier not .css/url/media/protocol — the FILE-INCLUSION form (LESS inlines these at compile time; plain CSS treats every @import as a stylesheet LOAD). The extension split (importPlainFileFormLess/Css/Sass) and the projectFileExists probe (importPlainFormNamesProjectFile) decide the rung.",
    calls: "the falsifier class is a user-defined function: atFunctionSites (CSS Functions & Mixins L4 `@function --add(a,b)`), atFunctionDeclaredNames and atFunctionInvokedNames. CSS-D14's 341,698 call_expression nodes over 90 names ALL built-ins predates the population correction (css,less,sass). Measured on the FULL population: 10 @function declarations (all in one vendored Bulma .sass file), 0 invocations of any declared name — the falsifier does NOT fire.",
    exports: "the falsifier class is composesDeclarations/composesFromDeclarations/exportBlockRuleSets — the CSS-Modules convention, counted on the tree. CSS-D14's zero predates the `.less` admission; this census closes the .less half: 0 on the full css,less,sass population.",
    decorates: "the near miss is importantSites (!important — a modifier naming no callable), counted beside the ruling as scss did. 43,383 sites, 0 naming a callable; the served build's 82 named types match 0 decorator stems.",
    renders: "the near miss is contentDeclarations (a VALUE, not a component: 29,086 sites, 0 with a capitalized IDENTIFIER-shaped component name — the scss quoted-string split is preserved at 0 too) and applySites/applyUtilityTokens (Tailwind's utility LIST: 247 parse-anchored at_rule sites / 546 tokens; the text-level bound is 2,939, the difference being ERROR-recovered text where no at_rule forms).",
    mixes_in: "the falsifier is a construct that APPLIES a mixin. Plain CSS has none (atMixinKeywordSites 0). The .less half of THIS lane's population has the Sass-extension shape: lessMixinInvokeLines (text statement lines `.larger(10);`) whose PARSE placement is the rung decision — lessMixinInvokeInErrorFiles vs lessMixinInvokeInCleanFiles. An invocation that exists only inside an ERROR subtree is not a node an analyzer can walk: R3 is unavailable for want of a target node, and R2 (a grammar patch) would teach the CSS grammar LESS, which is a different language's grammar with its own lane precedent (tree-sitter-less does not exist in this repo's grammar set).",
  },
}

if (LIMIT > 0) {
  console.log(JSON.stringify({ ...artifact, sample: sampleLabel }, null, 2))
  console.error(`\nSCREEN ONLY (limit ${LIMIT}) — nothing was written. A sample is never a publication.`)
  process.exit(0)
}
mkdirSync(resolve(ROOT, "validation/m14/measurements"), { recursive: true })
writeFileSync(OUT, JSON.stringify(artifact, null, 2))
// the population artifact, beside, so the declaration and any arm read ONE file
writeFileSync(POP_OUT, JSON.stringify({
  instrument: "validation/m14/census/css-extended-census.ts (population half)",
  rule: artifact.populationRule,
  root: ".corpus",
  extensions: EXTS,
  capBytes: CAP_BYTES,
  tracked: trackedTotal,
  admitted: allFiles.length,
  trackedButAbsent: absentTotal,
  overCapByRule: overCapTotal,
  repositoriesCarrying: repoRows.length,
  repositories: repoRows,
  populationString: POPULATION_STRING,
}, null, 2))
console.log(`css-extended-census: wrote ${OUT}`)
console.log(`population: tracked ${trackedTotal} · admitted ${allFiles.length} · repos ${repoRows.length} · absent ${absentTotal} · overCap ${overCapTotal}`)
console.log(POPULATION_STRING)
console.log(`part_of falsifier: importPlainFileForm ${counts.importPlainFileForm} (less ${counts.importPlainFileFormLess} · css ${counts.importPlainFileFormCss} · sass ${counts.importPlainFileFormSass}); namesProjectFile ${counts.importPlainFormNamesProjectFile} / namesNothing ${counts.importPlainFormNamesNothingAdmitted}`)
console.log(`calls falsifier: atFunctionSites ${counts.atFunctionSites}; callExpression ${counts.callExpressionNodes} over ${counts.callExpressionDistinctNames} names, non-builtin ${counts.callExpressionNonBuiltinNames}`)
console.log(`exports falsifier: composes ${counts.composesDeclarations} (from: ${counts.composesFromDeclarations}) · :export blocks ${counts.exportBlockRuleSets}`)
console.log(`renders near-miss: content: ${counts.contentDeclarations} · @apply sites ${counts.applySites} / ${counts.applyUtilityTokens} tokens · contentCapitalizedComponentShape ${counts.contentCapitalizedComponentShape}`)
console.log(`decorates near-miss: !important ${counts.importantSites} · @mixin keyword ${counts.atMixinKeywordSites}`)
process.exit(0)

// ── helpers ────────────────────────────────────────────────────────────────────────────────────
function firstChildByType(n: any, type: string): any | null {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && String(c.type) === type) return c
  }
  return null
}
function childTextOfDeclaration(n: any): string {
  // the value side of a declaration: everything after the `:` up to the `;`/`}`
  const text = String(n.text ?? "")
  const i = text.indexOf(":")
  return i < 0 ? "" : text.slice(i + 1).replace(/;[\s\S]*$/, "").trim()
}
