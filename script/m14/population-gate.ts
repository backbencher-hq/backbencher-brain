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
 * WHAT IT CHECKS:
 *   A. every extension the router maps to language L is in `LANES_B[L]`      (completeness)
 *   B. every extension in `LANES_B[L]` is mapped to L by the router         (no foreign files)
 *   C. the same for `residual-gate.ts`'s per-lane map
 *   D. `run-fixtures.ts`'s extension table, where one exists
 *
 * A language is ALLOWED to declare fewer extensions only by naming the ones it omits in
 * `POPULATION_EXEMPT` WITH a reason — an exemption is a stated decision, not a silence.
 *
 * Usage: npx tsx script/m14/population-gate.ts [--json]
 */
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

const HERE: string = (import.meta as any).dir ?? dirname(new URL(import.meta.url).pathname)
const ROOT = resolve(HERE, "..", "..")

/** The router is the source of truth: extension -> language. */
function routerMap(): Map<string, string[]> {
  const src = readFileSync(resolve(ROOT, "src/ast/language-detection.ts"), "utf8")
  // THE TABLE PACKS SEVERAL PAIRS PER LINE — `xml: "xml", xsd: "xml", dtd: "xml", …` — so the
  // first version of this function, which anchored on line boundaries, found 3 languages and
  // silently reported that it could not vouch for anything. Matched globally instead, and the
  // EXTENSION TABLE is located first so the basename table and comment prose cannot contribute.
  const start = src.indexOf("EXTENSION_LANGUAGE")
  const body = start >= 0 ? src.slice(start, src.indexOf("\n}", start) + 2) : src
  const out = new Map<string, string[]>()
  for (const m of body.matchAll(/([A-Za-z0-9_]+):\s*"([A-Za-z0-9+#-]+)"/g)) {
    const [, ext, lang] = m
    if (ext.length > 14) continue
    const list = out.get(lang) ?? []
    list.push(ext.toLowerCase())
    out.set(lang, list)
  }
  return out
}

/** A declared lane table of the form `lang: "a,b,c",` inside a named const. */
function laneMapFrom(file: string, constName: string): Map<string, string[]> | null {
  const src = readFileSync(resolve(ROOT, file), "utf8")
  const at = src.indexOf(constName)
  if (at < 0) return null
  const chunk = src.slice(at, at + 4000)
  const out = new Map<string, string[]>()
  for (const m of chunk.matchAll(/([a-z0-9+#-]+):\s*"([^"]*)"/g)) {
    const [, lang, exts] = m
    if (exts.includes(" ") && !exts.includes(",")) continue
    out.set(lang, exts.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean))
  }
  return out
}

/**
 * EXTENSIONS AN INSTRUMENT MAY LEGITIMATELY OMIT, each with the reason it is not a population
 * defect. An entry here is a DECISION someone made and can be argued with; the absence of one is
 * the silent drift this gate exists to catch.
 */
const POPULATION_EXEMPT: Record<string, Record<string, string>> = {
  incoming: {
    // `.svn`/`.git` style control directories are not corpora; the router maps them for other
    // reasons (file-type detection in general, not source indexing).
  },
}

type Finding = { check: string; instrument: string; lang: string; detail: string; missing: string[]; foreign: string[] }

const router = routerMap()
/** Instruments to check: [label, file, constName] */
const INSTRUMENTS: Array<[string, string, string]> = [
  ["incoming-gate", "script/m14/incoming-gate.ts", "export const LANES_B"],
  ["residual-gate", "script/m14/residual-gate.ts", "const ext = {"],
  ["run-fixtures", "script/m14/run-fixtures.ts", "const LANGS"],
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
 */
const LANE_ALIASES: Record<string, string[]> = { hcl: ["terraform"] }

const findings: Finding[] = []
for (const [label, file, constName] of INSTRUMENTS) {
  let declared: Map<string, string[]> | null = null
  try { declared = laneMapFrom(file, constName) } catch { declared = null }
  if (!declared || declared.size === 0) {
    findings.push({ check: "instrument-absent", instrument: label, lang: "-", detail: `could not read a lane map (${constName}); the gate cannot vouch for it`, missing: [], foreign: [] })
    continue
  }
  for (const [lang, routerExts] of [...router].sort()) {
    // the router's table covers many languages this programme does not measure; only compare
    // where the instrument DECLARES the language at all.
    if (!declared.has(lang)) continue
    const declaredExts = declared.get(lang)!
    const aliasExts = (LANE_ALIASES[lang] ?? []).flatMap((a) => router.get(a) ?? [])
    const exts = [...routerExts, ...aliasExts].filter((e) => e.length <= 8 && e.length <= 14)
    if (exts.length === 0) continue
    const missing = exts.filter((e) => !declaredExts.includes(e))
    // A foreign extension is only a defect if the router maps it to a DIFFERENT language.
    // An extension is foreign only if the router gives it to a language this lane does NOT cover —
    // and "covers" includes its LANE_ALIASES, so the hcl lane may spell terraform's extensions
    // without that reading as drift.
    const covered = new Set([lang, ...(LANE_ALIASES[lang] ?? [])])
    const foreign = declaredExts.filter((e) => {
      const owners = [...router].filter(([, l]) => l.includes(e)).map(([L]) => L)
      return owners.length > 0 && !owners.some((o) => covered.has(o))
    })
    if (missing.length === 0 && foreign.length === 0) continue
    findings.push({ check: "population-drift", instrument: label, lang, detail: `${declaredExts.join(",")} declared vs router's ${exts.join(",")}`, missing, foreign })
  }
}

const JSON_MODE = process.argv.includes("--json")
if (JSON_MODE) { console.log(JSON.stringify({ gate: "population-gate", routerLanguages: router.size, findings }, null, 2)); process.exit(findings.length ? 1 : 0) }

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`population gate — ${router.size} languages in the router, ${INSTRUMENTS.length} instruments checked\n`)
if (findings.length === 0) {
  console.log("POPULATION OK — every instrument's declared extensions cover the router's map.")
} else {
  console.log(`${w("instrument", 15)} ${w("lang", 10)} ${w("MISSING (router says these belong)", 40)} foreign`)
  console.log("-".repeat(90))
  for (const f of findings) {
    console.log(`${w(f.instrument, 15)} ${w(f.lang, 10)} ${w(f.missing.join(",") || "-", 40)} ${f.foreign.join(",") || "-"}`)
    console.log(`${" ".repeat(26)}${f.detail}`)
  }
  console.log(`\n${findings.length} finding(s). A MISSING extension means the instrument measures LESS than the`)
  console.log(`language is — every number it produced is about a population nobody chose (this is how xml`)
  console.log(`came to be measured over 18% of its corpus and yaml over .yaml alone).`)
}
process.exit(findings.length ? 1 : 0)
