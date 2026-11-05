/**
 * POPULATION GATE — does every instrument measure the population the ROUTER defines?
 *
 * THE DEFECT CLASS THIS EXISTS FOR, and it has now cost the programme three separate rounds:
 *
 *   1. yaml   `incoming-gate` admitted `.yaml` only, while ansible's fleet is 13 `.yaml` to
 *             2,068 `.yml` — a PASS built on 0.6% of the population (fixed 4ccea0ef1).
 *   2. `.github`  four instruments pruned any directory whose name CONTAINS `.git`, deleting
 *             an entire corpus directory from every population (fixed 28d79cb99).
 *   3. xml    `incoming-gate` admitted `.xml` only, while the router maps SEVEN extensions to
 *             the xml language — every xml number covered 18% of the lane (fixed 68138a1c8).
 *
 * All three are the same shape: **the router declares which files are a language, and each
 * instrument keeps its own list.** A second source of truth drifts, and when it drifts the
 * instrument reports a confident number about a population nobody chose. This gate makes the
 * router the single source and checks every declared list against it.
 *
 * ── 2026-10-20 (Lead) · THE GATE ITSELF WAS MEASURED, AND IT COULD NOT SEE MOST OF THE FLEET ──
 *
 * Three defects in this file, found by measuring what it actually checks
 * (`validation/m14/verification/POPULATION-GATE-REPAIR-2026-10-20.md`):
 *
 *   A. `laneMapFrom` read a FIXED 4000-CHARACTER WINDOW from the literal's start. The
 *      `LANES_B` literal is 4,833 characters, so the window TRUNCATED it: the gate parsed
 *      19 of the 24 lanes `LANES_B` declares and never saw `hcl`, `toml`, `xml`, `markdown`
 *      or `clean` at all. A window is a stride; a stride is not a population.
 *   B. the instrument list checked `LANES_B` ONLY. `LANES_A` is a second lane map in the same
 *      file — 22 more lanes (c, clojure, cpp, csharp, elixir, erlang, go, groovy, haskell,
 *      html, java, javascript, kotlin, perl, python, rust, scala, svelte, swift, typescript,
 *      vb, vue) — and the gate never looked at any of them. cpp's missing `c++`/`cu`/`inl`/
 *      `ipp` and html's missing eleven template extensions were invisible for that reason.
 *   C. the router reader's KEY CLASS could not see a key containing `+` or `#`, and the
 *      router HAS one: `"c++": "cpp"`. The gate therefore reported a router that does not
 *      contain `c++`, which is a false clean about a real extension.
 *
 * Plus: the lane reader was not COMMENT-AWARE, so the `key: "value"` shape inside a comment
 * in `LANES_B` was read as a lane (the same prose-as-code failure the board's own parser had
 * to fix), and `POPULATION_EXEMPT` was DECLARED AND NEVER READ.
 *
 * What it checks now:
 *   A. every extension the router maps to language L is in the instrument's list for L  (completeness)
 *   B. every extension in the instrument's list for L is routed to L by the router     (no foreign files)
 *   C. the same for `residual-gate.ts`'s per-lane map and `run-fixtures.ts`'s table
 *   D. a lane the ENGINE has an analyzer for, that NO instrument declares  →  an unswept lane
 *
 * A language is ALLOWED to declare fewer extensions only by naming the ones it omits in
 * `POPULATION_EXEMPT` WITH a reason — an exemption is a stated decision, not a silence.
 *
 * Usage: npx tsx script/m14/population-gate.ts [--json]
 */
import { readFileSync, readdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE: string = (import.meta as any).dir ?? dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..")

/**
 * Remove comments from a TypeScript source, preserving length and newlines so offsets stay
 * aligned. The lane literals are quote-aware but NOT comment-aware, and a comment whose text
 * contains a `key: "value"` shape is read as a lane — the board's own parser had to be taught
 * this, and the same lesson applies here.
 */
function stripComments(src: string): string {
  let out = ""
  let i = 0
  let quote: string | null = null
  while (i < src.length) {
    const c = src[i]
    if (quote) {
      if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue }
      if (c === quote) quote = null
      out += c; i++; continue
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") { out += " "; i++ }
      continue
    }
    if (c === "/" && src[i + 1] === "*") {
      out += "  "; i += 2
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++ }
      out += "  "; i += 2
      continue
    }
    out += c; i++
  }
  return out
}

/** The router is the source of truth: extension -> language. */
function routerMap(): Map<string, string[]> {
  const src = stripComments(readFileSync(resolve(ROOT, "src/ast/language-detection.ts"), "utf8"))
  // THE TABLE PACKS SEVERAL PAIRS PER LINE — `xml: "xml", xsd: "xml", dtd: "xml", …` — so the
  // first version of this function, which anchored on line boundaries, found 3 languages and
  // silently reported that it could not vouch for anything. Matched globally instead, and the
  // EXTENSION TABLE is located first so the basename table and comment prose cannot contribute.
  const start = src.indexOf("EXTENSION_LANGUAGE")
  const body = start >= 0 ? src.slice(start, src.indexOf("\n}", start) + 2) : src
  const out = new Map<string, string[]>()
  // THE KEY MAY BE QUOTED, and a quoted key may contain `+` or `#` — the router has `"c++": "cpp"`.
  // A key class without them reports a router that does not contain `c++`, which is a false clean.
  for (const m of body.matchAll(/"?([A-Za-z0-9_+#-]+)"?\s*:\s*"([A-Za-z0-9+#-]+)"/g)) {
    const [, ext, lang] = m
    if (ext.length > 14) continue
    const list = out.get(lang) ?? []
    list.push(ext.toLowerCase())
    out.set(lang, list)
  }
  return out
}

/**
 * Read a `export const NAME: … = { … }` literal IN FULL, comments removed.
 *
 * NOT A WINDOW. The previous reader took a fixed 4,000 characters from the literal's start; the
 * `LANES_B` literal is 4,833 characters long, so five of its lanes were invisible to the gate
 * that exists to check them. A window is a stride, and a stride is not a population.
 */
function literalBody(src: string, constName: string): string | null {
  const at = src.indexOf(constName)
  if (at < 0) return null
  // THE VALUE'S BRACE, NOT THE TYPE'S. `const LANGS: Record<string, { wasm; ext }> = {` has a
  // brace inside its TYPE annotation, and anchoring on the first `{` returned the type — so the
  // reader saw `wasm: string` and no lane at all, and the `run-fixtures` instrument reported
  // nothing rather than reporting everything. Anchor on the `= {` that starts the VALUE.
  const eq = src.indexOf("= {", at)
  const start = eq >= 0 ? eq + 2 : src.indexOf("{", at)
  if (start < 0) return null
  let depth = 0
  for (let j = start; j < src.length; j++) {
    const c = src[j]
    if (c === "{") depth++
    else if (c === "}") { depth--; if (depth === 0) return src.slice(start, j + 1) }
  }
  return null
}

/** A declared lane table of the form `lang: "a,b,c",` inside a named const. */
function laneMapFrom(file: string, constNames: string[]): Map<string, string[]> | null {
  const src = stripComments(readFileSync(resolve(ROOT, file), "utf8"))
  const out = new Map<string, string[]>()
  let found = false
  for (const constName of constNames) {
    const body = literalBody(src, constName)
    if (body === null) continue
    found = true
    // THE KEY MAY BE QUOTED — `"objective-c": "m,mm"` is a real lane — and a key class that
    // stops at the closing quote cannot see it. The lane was therefore ABSENT from the gate's
    // map, and an absent lane is a lane the gate cannot check.
    for (const m of body.matchAll(/"?([a-z0-9+#-]+)"?\s*:\s*"([^"]*)"/g)) {
      const [, lang, exts] = m
      if (exts.includes(" ") && !exts.includes(",")) continue
      out.set(lang, exts.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean))
    }
  }
  return found ? out : null
}

/**
 * A lane table whose extension is a NESTED field, not the key's value.
 *
 * `run-fixtures.ts` declares `LANGS: Record<string, { wasm; analyzerFile; className; ext }>`, so
 * the old reader's `key: "value"` regex matched `wasm: "tree-sitter-vbnet.wasm"` and called
 * `wasm` a LANE. Every real lane in that table was invisible to the check, and the
 * `run-fixtures` instrument's findings were VACUOUS — a check that cannot fail, which is the
 * same defect class this gate exists to catch, inside the gate.
 */
function nestedExtMapFrom(file: string, constName: string): Map<string, string[]> | null {
  const src = stripComments(readFileSync(resolve(ROOT, file), "utf8"))
  const body = literalBody(src, constName)
  if (body === null) return null
  const out = new Map<string, string[]>()
  for (const m of body.matchAll(/([a-z0-9+#-]+):\s*\{[^{}]*?\bext\s*:\s*"([^"]*)"/g)) {
    out.set(m[1], m[2].split(",").map((e) => e.trim().toLowerCase()).filter(Boolean))
  }
  return out.size > 0 ? out : null
}

/**
 * EXTENSIONS AN INSTRUMENT MAY LEGITIMATELY OMIT, each with the reason it is not a population
 * defect. An entry here is a DECISION someone made and can be argued with; the absence of one is
 * the silent drift this gate exists to catch.
 *
 * THIS WAS DECLARED AND NEVER READ before 2026-10-20. It is read now.
 */
const POPULATION_EXEMPT: Record<string, Record<string, { reason: string; missing?: string[]; foreign?: string[] }>> = {
  "incoming-gate": {
    // `.h` IS ROUTED TO `c` BY THE ROUTER, BUT THE cpp LANE ADMITS IT DELIBERATELY: the engine
    // CONTENT-SNIFS a header (class / namespace / template< / ::) and hands the C++ ones to the
    // cpp analyzer, so the router's extension answer is not the last word on a header. The gate
    // admits `h` so the cpp lane measures the headers the ENGINE will give it; the c lane
    // admits `h` too, because the c analyzer reads the plain-C ones. Both lanes therefore
    // measure `.h` and the CONTENT decides — which is the engine's behaviour, not a drift.
    //
    // The exemption is PER-EXTENSION and covers `foreign` ONLY: cpp's MISSING extensions
    // (`c++`, `ipp`, `inl`, `cu`) are a real finding and stay reported.
    cpp: {
      reason: "the engine CONTENT-SNIFS a header and routes the C++ ones to the cpp analyzer; the router's extension answer is not the last word on `.h`",
      foreign: ["h"],
    },
    // matlab IS CONTENT-DISAMBIGUATED, NOT EXTENSION-ROUTED. A `.m` file is routed to
    // objective-c by the router, and the engine then sniffs the file's heading
    // (`function `/`classdef `) and hands the MATLAB ones to this lane — measured in
    // language-detection.ts:407 and used by the matlab lane's own declaration. The router
    // ALSO carries a literal `matlab: "matlab"` row (added 2026-10-31 in the dedicated-root
    // commit) that maps a pseudo-extension named after the language; NO file with that
    // extension exists in any corpus on this machine (checked: zero across the shared shelf
    // and the workspace `.corpus` root), so it is a language-support placeholder, not a
    // population the lane could measure. Declaring it in the lane's extension list would
    // claim a file population that does not exist; this exemption records the decision
    // instead, and it is scoped to that one pseudo-extension only.
    matlab: {
      reason: "matlab is content-disambiguated from `.m`; the router's `matlab` pseudo-extension names no real file (0 in every corpus) and is a placeholder, not a measurable population, while the lane's `m` entry is the CONTENT-SNIFFED half of the objective-c route that the engine hands to this lane",
      missing: ["matlab"],
      foreign: ["m"],
    },
  },
  "residual-gate": {},
  "run-fixtures": {},
}

/**
 * INSTRUMENTS WHOSE EXTENSION FIELD IS NOT A POPULATION DECLARATION AT ALL.
 *
 * `run-fixtures.ts`'s `LANGS[lang].ext` says WHICH EXTENSION THE FIXTURE FILES USE — a curated
 * set of a few files per lane, not the lane's corpus. A typescript fixture set written in `.ts`
 * is correct and complete for what it is; demanding it also carry `.tsx` fixtures would be a
 * FIXTURE-COVERAGE question, and that question has its own instrument
 * (`script/m14/verify-fixture-coverage.ts`, which checks that every node type a spec claims is
 * handled is actually EXERCISED by a fixture's parse tree).
 *
 * So the run-fixtures field is exempt FROM THIS GATE, with the reason recorded here, and the
 * fixture-coverage question is left to the gate that answers it. Before 2026-10-20 this reading
 * was impossible: the old reader matched `wasm: "tree-sitter-vbnet.wasm"` and called `wasm` a
 * LANE, so the instrument reported NOTHING at all — a check that could not fail, inside the gate
 * that exists to catch checks that cannot fail.
 */
const INSTRUMENT_EXEMPT: Record<string, string> = {
  "run-fixtures": "`LANGS[lang].ext` is the extension the FIXTURE FILES use, not the lane's corpus population; the fixture-coverage question belongs to script/m14/verify-fixture-coverage.ts",
}

type Finding = {
  check: string
  instrument: string
  lang: string
  detail: string
  missing: string[]
  foreign: string[]
}

const router = routerMap()
/**
 * Instruments to check: [label, file, kind, constNames]
 *   "laneMap"    — `lang: "a,b,c"`   (incoming-gate's two maps, residual-gate's ext table)
 *   "nestedExt"  — `lang: { … ext: "a,b,c" }`   (run-fixtures' LANGS)
 */
const INSTRUMENTS: Array<[string, string, "laneMap" | "nestedExt", string[]]> = [
  // BOTH lane maps: `LANES_A` is a second map in the same file and the gate used to read one.
  // THE TABLE MOVED, THE INSTRUMENT FOLLOWED (2026-11-04). `incoming-gate.ts` runs its whole gate
  // body on import, so the lane maps were extracted to `language-extensions.ts` (commit 8f449a26e)
  // and re-exported from the gate. This reader still parsed the OLD file, found no literal
  // `export const LANES_A` (the file now has `import { LANES_A } from "./language-extensions"`),
  // reported the instrument as absent and then reported EVERY lane as unswept — a gate that could
  // not read the table it was written to read. The single moved table is the one this gate must
  // read: one table, every consumer, exactly the property that extraction was made for.
  ["incoming-gate", "script/m14/language-extensions.ts", "laneMap", ["export const LANES_A", "export const LANES_B"]],
  ["residual-gate", "script/m14/residual-gate.ts", "laneMap", ["const ext = {"]],
  ["run-fixtures", "script/m14/run-fixtures.ts", "nestedExt", ["const LANGS"]],
]

/**
 * ROUTER LANGUAGES THAT ONE LANE LEGITIMATELY COVERS TOGETHER.
 *
 * The router separates `terraform` (`.tf`, `.tfvars`, `.tofu`) from `hcl` (`.hcl`) because
 * `--language terraform` must be able to find the former, and the distinction is real for a user.
 * The ONTOLOGY lane `hcl` covers both, because one analyzer parses both and the compiled grammar
 * is the same — a deliberate decision, recorded in the router's own comment ("`.hcl` keeps its own
 * name for the generic-HCL case"). Naming it here keeps the gate strict everywhere else: an
 * unlisted omission is still a finding.
 *
 * THE OTHER TWO ARE THE ENGINE'S OWN FOLDS, and they are the same kind of statement: the router
 * names a language, and `getAnalyzer` (src/ast/engine.ts:2256) hands that language to another
 * lane's analyzer.
 *   · `tsx`   → the TYPESCRIPT analyzer (`case "typescript": case "tsx":`)
 *   · `sass`  → the CSS analyzer      (`case "css": case "sass":`)   — NOT the scss one
 *   · `terraform` → the HCL analyzer  (`case "hcl": case "terraform":`)
 *
 * The `sass` fold is the one that matters for correctness: the scss lane must NOT admit `sass`,
 * because the engine reads a `.sass` file with the CSS analyzer and the css grammar — the
 * router's own comment records that the indented syntax parses with ERROR nodes there. A scss
 * lane that admits `sass` measures files production never gives that analyzer.
 */
const LANE_ALIASES: Record<string, string[]> = {
  hcl: ["terraform"],
  typescript: ["tsx"],
  css: ["sass"],
}

/**
 * THE PER-LANE CHECK, as a function, so the self-test can call it with synthetic inputs.
 *
 * A check that cannot fail is decoration, and this gate's own history is the argument: before
 * 2026-10-20 the `run-fixtures` instrument's findings were VACUOUS — the reader matched
 * `wasm: "tree-sitter-vbnet.wasm"` and called `wasm` a LANE, so every real lane was invisible
 * and the instrument reported nothing at all, for as long as it was there. The self-test below
 * drives this function with a known-bad map and asserts it FIRES.
 */
function checkLane(label: string, lang: string, declaredExts: string[], routerExts: string[]): Finding | null {
  const aliasExts = (LANE_ALIASES[lang] ?? []).flatMap((a) => router.get(a) ?? [])
  const exts = [...routerExts, ...aliasExts].filter((e) => e.length <= 8 && e.length <= 14)
  if (exts.length === 0) return null
  const exempt = POPULATION_EXEMPT[label]?.[lang]
  const exemptMissing = new Set(exempt?.missing ?? [])
  const exemptForeign = new Set(exempt?.foreign ?? [])
  const missing = exts.filter((e) => !declaredExts.includes(e) && !exemptMissing.has(e))
  // A foreign extension is only a defect if the router maps it to a DIFFERENT language.
  // An extension is foreign only if the router gives it to a language this lane does NOT cover —
  // and "covers" includes its LANE_ALIASES, so the hcl lane may spell terraform's extensions
  // without that reading as drift.
  const covered = new Set([lang, ...(LANE_ALIASES[lang] ?? [])])
  const foreign = declaredExts.filter((e) => {
    if (exemptForeign.has(e)) return false
    const owners = [...router].filter(([, l]) => l.includes(e)).map(([L]) => L)
    return owners.length > 0 && !owners.some((o) => covered.has(o))
  })
  if (missing.length === 0 && foreign.length === 0) return null
  return { check: "population-drift", instrument: label, lang, detail: `${declaredExts.join(",")} declared vs router's ${exts.join(",")}`, missing, foreign }
}

const findings: Finding[] = []
const declaredLanes = new Set<string>()

for (const [label, file, kind, constNames] of INSTRUMENTS) {
  let declared: Map<string, string[]> | null = null
  try {
    declared = kind === "nestedExt" ? nestedExtMapFrom(file, constNames[0]) : laneMapFrom(file, constNames)
  } catch { declared = null }
  if (!declared || declared.size === 0) {
    findings.push({ check: "instrument-absent", instrument: label, lang: "-", detail: `could not read a lane map (${constNames.join(" / ")}); the gate cannot vouch for it`, missing: [], foreign: [] })
    continue
  }
  if (label === "incoming-gate") for (const l of declared.keys()) declaredLanes.add(l)
  if (INSTRUMENT_EXEMPT[label]) {
    // The instrument's extension field is not a population declaration — recorded, not silent.
    continue
  }
  for (const [lang, routerExts] of [...router].sort()) {
    // the router's table covers many languages this programme does not measure; only compare
    // where the instrument DECLARES the language at all.
    if (!declared.has(lang)) continue
    const f = checkLane(label, lang, declared.get(lang)!, routerExts)
    if (f) findings.push(f)
  }
}

// ── D · A LANE THE ENGINE HAS AN ANALYZER FOR, THAT NO INSTRUMENT DECLARES ─────────────────
// A lane that is not in the map is not measured by the fleet sweep at all — and a lane can hold
// an accepted verdict and still be invisible to the instrument that would re-check it.
{
  const analyzerFiles = new Set<string>()
  for (const f of readdirSync(resolve(ROOT, "src/ast"))) {
    const m = /^real-(.+)-analyzer\.ts$/.exec(f)
    if (m) analyzerFiles.add(m[1])
  }
  // The lane's NAME and the ANALYZER FILE's name are not always the same: the analyzer is
  // `real-makefile-analyzer.ts` and the lane is `make`. The map is keyed analyzer -> lane.
  const analyzerToLane: Record<string, string> = { makefile: "make" }
  for (const analyzer of [...analyzerFiles].sort()) {
    const lane = analyzerToLane[analyzer] ?? analyzer
    if (declaredLanes.has(lane)) continue
    findings.push({
      check: "lane-unswept", instrument: "incoming-gate", lang: lane,
      detail: `the engine has real-${analyzer}-analyzer.ts, but no instrument declares the lane — the fleet sweep never measures it`,
      missing: [], foreign: [],
    })
  }
}

const JSON_MODE = process.argv.includes("--json")

/**
 * SELF-TEST — the gate must be able to GO RED, or a green run means nothing.
 *
 * Every case drives the SAME code path the real measurement uses (`checkLane`, `routerMap`,
 * `laneMapFrom`, `literalBody`), not a paraphrase of it. The cases are the defects this file
 * actually had on 2026-10-20, so a regression that re-introduces one of them fails here.
 */
if (process.argv.includes("--selftest")) {
  const cases: Array<[string, boolean, string]> = []
  const ok = (name: string, cond: boolean, why: string) => cases.push([name, cond, why])

  // 1 · a lane that omits an extension the router gives it MUST be found.
  const miss = checkLane("incoming-gate", "php", ["php"], router.get("php") ?? [])
  ok("missing-extension is found", miss !== null && miss.missing.includes("phpt"), "php without phpt must report phpt missing")

  // 2 · a lane that admits an extension the router gives to ANOTHER language MUST be found.
  const foreign = checkLane("incoming-gate", "scss", ["scss", "sass"], router.get("scss") ?? [])
  ok("foreign-extension is found", foreign !== null && foreign.foreign.includes("sass"), "scss admitting sass must report it foreign")

  // 3 · a lane that matches the router exactly MUST NOT be reported.
  const clean = checkLane("incoming-gate", "php", ["php", "phpt"], router.get("php") ?? [])
  ok("exact-match is not reported", clean === null, "a lane that matches the router produces no finding")

  // 4 · the exemption is honoured (cpp's deliberate `.h` widening is not a finding).
  const cpp = checkLane("incoming-gate", "cpp", ["cpp", "cc", "cxx", "c++", "hpp", "hxx", "hh", "h", "ipp", "inl", "cu"], router.get("cpp") ?? [])
  ok("exempt foreign extension is not reported", cpp === null, "cpp's documented .h widening must not be a finding")

  // 5 · THE ROUTER READER MUST SEE A QUOTED KEY CONTAINING `+` — the defect that hid `c++`.
  ok("router reader sees the quoted + key", (router.get("cpp") ?? []).includes("c++"), "the router's c++ extension must be visible to the gate")

  // 6 · THE LANE READER MUST SEE A QUOTED KEY — `"objective-c"` was invisible before.
  const laneMaps = laneMapFrom("script/m14/language-extensions.ts", ["export const LANES_A", "export const LANES_B"])
  ok("lane reader sees a quoted key", laneMaps?.has("objective-c") === true, "the objective-c lane must be readable")
  ok("lane reader sees a quoted key in LANES_B's sibling map", laneMaps?.has("c") === true, "the c lane must be readable")

  // 7 · THE LANE READER MUST NOT READ A COMMENT — the `key: "value"` shape in a comment.
  ok("lane reader ignores comment prose", laneMaps?.has("key") === false, "a comment must not become a lane")

  // 8 · THE LITERAL READER MUST READ PAST 4,000 CHARACTERS — the window that hid five lanes.
  const gateSrc = readFileSync(resolve(ROOT, "script/m14/incoming-gate.ts"), "utf8")
  const bodyB = literalBody(stripComments(gateSrc), "export const LANES_B")
  ok("literal reader is not a window", bodyB !== null && bodyB.length > 4000, `LANES_B body must exceed 4000 chars (it is ${bodyB?.length ?? 0})`)
  ok("the five lanes the window hid are readable", ["hcl", "toml", "xml", "markdown", "clean"].every((l) => laneMaps?.has(l)), "hcl, toml, xml, markdown and clean must all be readable")

  // 9 · the run-fixtures instrument is EXEMPT as a class, and the reason is recorded.
  ok("run-fixtures is exempt with a reason", typeof INSTRUMENT_EXEMPT["run-fixtures"] === "string" && INSTRUMENT_EXEMPT["run-fixtures"].length > 0, "an instrument-level exemption must carry its reason")

  let failed = 0
  for (const [name, cond, why] of cases) {
    if (!cond) failed++
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}\n      ${why}`)
  }
  console.log(`\n${cases.length - failed}/${cases.length} self-test case(s) passed`)
  process.exit(failed ? 1 : 0)
}

if (JSON_MODE) { console.log(JSON.stringify({ gate: "population-gate", routerLanguages: router.size, declaredLanes: [...declaredLanes].sort(), findings }, null, 2)); process.exit(findings.length ? 1 : 0) }

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`population gate — ${router.size} languages in the router, ${INSTRUMENTS.length} instruments checked, ${declaredLanes.size} lanes declared\n`)
if (findings.length === 0) {
  console.log("POPULATION OK — every instrument's declared extensions cover the router's map.")
} else {
  console.log(`${w("check", 16)} ${w("instrument", 15)} ${w("lang", 12)} ${w("MISSING (router says these belong)", 30)} foreign`)
  console.log("-".repeat(100))
  for (const f of findings) {
    console.log(`${w(f.check, 16)} ${w(f.instrument, 15)} ${w(f.lang, 12)} ${w(f.missing.join(",") || "-", 30)} ${f.foreign.join(",") || "-"}`)
    console.log(`${" ".repeat(44)}${f.detail}`)
  }
  console.log(`\n${findings.length} finding(s). A MISSING extension means the instrument measures LESS than the`)
  console.log(`language is — every number it produced is about a population nobody chose (this is how xml`)
  console.log(`came to be measured over 18% of its corpus and yaml over .yaml alone).`)
}
process.exit(findings.length ? 1 : 0)
