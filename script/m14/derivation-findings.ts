/**
 * DERIVATION FINDINGS for one lane, computed from the harness's OWN allowlist
 * expression plus the analyzer's OWN source. Lane-owned instrument.
 *
 * A DERIVATION finding is a relationship type the analyzer EMITS that the
 * differential never COMPARES — an edge stored and audited against nothing. It
 * ships a bug invisibly, and no gate reports it: the differential's 0 missing /
 * 0 unexplained is computed over the types it admits.
 *
 * The three verdicts this file must never confuse:
 *
 *   constructible   the analyzer's source contains `RelationshipType.X`. This
 *                   is what the old source-derivation check answered, and it is
 *                   NOT coverage. It is the answer to "can this analyzer ever
 *                   emit X", which says nothing about whether it does.
 *   compared        differential.ts's allowlist admits X for this lang. Extracted
 *                   by bracket matching from the harness file, never copied, so
 *                   this cannot drift into believing a label is admitted when the
 *                   harness drops it.
 *   firing          X actually appears in res.relationships on real corpus,
 *                   through the production path. Measured with --fire.
 *
 * DERIVATION finding = firing AND NOT compared.
 *
 * No regular expression anywhere: node types and String ops only.
 *
 * USAGE
 *   bun run script/m14/derivation-findings.ts --lang typescript
 *   bun run script/m14/derivation-findings.ts --lang typescript --fire [--files N]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const LANG = argOf("--lang") ?? "typescript"
const OUT = argOf("--out")
const REPO = argOf("--repo") ?? "element-plus"
const FIRE_FILES = Number(argOf("--files") ?? "300")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_ROOT = path.resolve(path.dirname(process.argv[1]!), "..", "..")

// ── 1. constructible: read the analyzer's SOURCE and look for the enum member ──
// A literal search over source TEXT, and here that is the correct instrument,
// because the question is literally "does the text `RelationshipType.X` appear in
// this file". It is NOT used for anything about the language's constructs, which
// is what source-text probing is forbidden for: `implements` in a comment or a
// string would fool it, and no comment in an analyzer decides whether it emits.
const analyzerFile = path.join(REPO_ROOT, "src/ast", `real-${LANG}-analyzer.ts`)
let src = ""
try { src = readFileSync(analyzerFile, "utf8") } catch {
  console.error(`cannot read ${analyzerFile}`)
  process.exit(2)
}
const constructible = new Set<Type>()
const siteCounts = new Map<Type, number>()
for (const t of ALL_TYPES) {
  const needle = `RelationshipType.${t[0]!.toUpperCase()}${t.slice(1)}`
  let n = 0
  let at = src.indexOf(needle)
  while (at >= 0) { n++; at = src.indexOf(needle, at + needle.length) }
  if (n > 0) { constructible.add(t); siteCounts.set(t, n) }
}

// ── 2. compared: the differential's own allowlist, extracted not copied ────────
const diffPath = path.join(REPO_ROOT, "script/m14/differential.ts")
const diffSrc = readFileSync(diffPath, "utf8")
function extractAllowlistExpr(s: string): string {
  const MARK = '.filter((r: any) => ["extends", "implements", "instantiates"'
  const at = s.indexOf(MARK)
  if (at < 0) throw new Error("allowlist marker not found — differential.ts changed shape")
  const bodyStart = s.indexOf("=>", at) + 2
  let depth = 0
  let inStr: string | null = null
  let inLine = false
  let inBlock = false
  for (let i = bodyStart; i < s.length; i++) {
    const c = s[i]!, n = s[i + 1]
    if (inLine) { if (c === "\n") inLine = false; continue }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++ } continue }
    if (inStr) { if (c === "\\") { i++; continue } if (c === inStr) inStr = null; continue }
    if (c === "/" && n === "/") { inLine = true; i++; continue }
    if (c === "/" && n === "*") { inBlock = true; i++; continue }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue }
    if (c === "[" || c === "(" || c === "{") { depth++; continue }
    if (c === "]" || c === ")" || c === "}") { depth--; if (depth === 0 && c === "]") return s.slice(bodyStart, i + 1) }
  }
  throw new Error("allowlist expression end not found")
}
const comparedSet = new Set<string>(new Function("lang", `return ${extractAllowlistExpr(diffSrc)}`)(LANG) as string[])

// ── 3. firing: production path over real corpus ───────────────────────────────
const firing = new Map<Type, number>()
const firingFiles = new Map<Type, Set<string>>()
let fireRan = false
if (argv.includes("--fire")) {
  const { getParser } = await import(path.join(REPO_ROOT, "src/ast/engine"))
  const mod: any = await import(path.join(REPO_ROOT, `src/ast/real-${LANG}-analyzer.ts`))
  const Cls = Object.values(mod).find((v: any) => typeof v === "function" && String(v.name).endsWith("Analyzer")) as any
  const dir = path.join(CR, REPO)
  const tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  const exts = LANG === "typescript" ? [".ts", ".tsx", ".mts", ".cts"] : [`.${LANG}`]
  const files: string[] = []
  for (const rel of tracked) {
    const ext = path.extname(rel).toLowerCase()
    let isTs = false
    for (const e of exts) if (rel.toLowerCase().endsWith(e)) isTs = true
    if (!isTs) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    files.push(abs)
    if (FIRE_FILES > 0 && files.length >= FIRE_FILES) break
  }
  let parsed = 0
  let idx = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (true) {
      const i = idx++
      if (i >= files.length) return
      const abs = files[i]!
      const rel = path.relative(dir, abs)
      let res: any
      try {
        const lang = rel.toLowerCase().endsWith(".tsx") ? "tsx" : LANG
        const p = await getParser(lang)
        const tree = p.parse(readFileSync(abs, "utf8"), abs)
        res = new Cls().analyze(tree.rootNode, readFileSync(abs, "utf8"), rel)
        parsed++
      } catch { continue }
      for (const r of res?.relationships ?? []) {
        const t = String(r.type ?? r.relationshipType ?? "").toLowerCase() as Type
        if (!ALL_TYPES.includes(t)) continue
        firing.set(t, (firing.get(t) ?? 0) + 1)
        const s = firingFiles.get(t) ?? new Set<string>()
        s.add(rel)
        firingFiles.set(t, s)
      }
    }
  }))
  fireRan = true
  console.log(`firing: ${parsed}/${files.length} parsed via getParser -> parse -> analyze (production path, ${REPO})\n`)
}

// ── report ────────────────────────────────────────────────────────────────────
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const rows = ALL_TYPES.map((t) => ({
  type: t,
  constructible: constructible.has(t),
  sites: siteCounts.get(t) ?? 0,
  compared: comparedSet.has(t),
  firing: fireRan ? (firing.get(t) ?? 0) : null,
  firingFiles: fireRan ? (firingFiles.get(t)?.size ?? 0) : null,
  derivation: fireRan && (firing.get(t) ?? 0) > 0 && !comparedSet.has(t),
}))
console.log(`DERIVATION findings — ${LANG}   analyzer: ${path.relative(REPO_ROOT, analyzerFile)}`)
console.log(`compared set read from script/m14/differential.ts (extracted, not copied): ${[...comparedSet].sort().join(" ")}`)
console.log(`\n${w("type", 14)}${w("constructible", 15)}${w("sites", 8)}${w("compared", 11)}${w("firing", 12)}${w("files", 8)}DERIVATION finding`)
console.log("-".repeat(84))
for (const r of rows) {
  console.log(`${w(r.type, 14)}${w(r.constructible ? "yes" : "no", 15)}${w(String(r.sites), 8)}${w(r.compared ? "yes" : "NO", 11)}${w(r.firing === null ? "-" : String(r.firing), 12)}${w(r.firingFiles === null ? "-" : String(r.firingFiles), 8)}${r.derivation ? "YES — emitted, never compared" : ""}`)
}
const findings = rows.filter((r) => r.derivation)
const uncomparedNoFire = rows.filter((r) => !r.compared && !r.firing)
console.log("-".repeat(84))
console.log(`DERIVATION findings: ${findings.length} — ${findings.map((f) => f.type).join(" ") || "(none)"}`)
if (uncomparedNoFire.length) {
  console.log(`not compared AND not firing: ${uncomparedNoFire.map((f) => f.type).join(" ")}`)
  console.log(`  these are NOT findings. A type the analyzer cannot construct, or does not`)
  console.log(`  produce, has no edge to be unaudited. They need a GAP or RULED verdict instead.`)
}
if (findings.length) {
  console.log(`\nAn edge of these types is stored and compared against NOTHING. The differential's`)
  console.log(`0 missing / 0 unexplained for ${LANG} is computed over the ${rows.filter((r) => r.compared).length} compared types only.`)
}
if (OUT) { writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), lang: LANG, compared: [...comparedSet].sort(), rows }, null, 2)); console.log(`\nwrote ${OUT}`) }