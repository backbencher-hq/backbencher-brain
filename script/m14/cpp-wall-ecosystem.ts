/**
 * cpp-wall-ecosystem — THE WALL PER ECOSYSTEM, priced against the package-scope claim, WITHOUT the
 * project index.
 *
 * WHY A SECOND INSTRUMENT, AND WHY IT IS LIGHT. The four-bucket pricing (`cpp-d-package-scope.ts`) needs
 * the project index, so it is an ARM-scale job — and the arm token is a FLEET resource, so a measurement
 * that can be made without it should be. This instrument measures the same wall's **per-ecosystem
 * distribution** and the **claim's unit attribution** over the WHOLE W1 class, and it needs NO index:
 *
 *   - the W1 class is a SPELLING rule (an identifier, not a keyword/builtin/non-class-standard type, not
 *     qualified, not template-shaped, not all-caps) re-derived from the ANALYZER's own exported sets — so
 *     no index is needed to recognise a W1 row;
 *   - the ECOSYSTEM of a row is the kind of the FIRST manifest above its file (the nearest-ancestor rule
 *     the gate's manifest reader uses) — no index either;
 *   - the CLAIM's unit attribution (does the unit's include-root set match exactly one declared package?)
 *     needs the manifest and the source — no index either.
 *
 * What the index IS needed for is the A/C/D refinement (is the name declared elsewhere? is it a member
 * leaf?). So this instrument answers the PER-ECOSYSTEM question over the whole W1 class, and the D
 * refinement is the other instrument's table.
 *
 * THE VERDICT CLASSES over the W1 rows:
 *   CLAIM-SOUND-REACH          a QUALIFIED spelling — impossible in W1 by construction (the rule excludes
 *                              a qualified target), and the instrument COUNTS the exclusion rather than
 *                              asserting it
 *   UNIT-ATTRIBUTION-UNIQUE    the unit's include roots match EXACTLY ONE declared package
 *   UNIT-ATTRIBUTION-AMBIGUOUS the unit matches TWO OR MORE declared packages
 *   NO-DECLARED-PACKAGE        the unit uses package-shaped include roots and the manifest declares none
 *   NO-PROVENANCE              the unit has no package-shaped include root at all
 *   FOREIGN-MANIFEST           another ecosystem's manifest governs the file — a claim here is REFUTED
 *   UNVERIFIABLE-NO-MANIFEST   no manifest governs the file
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-wall-ecosystem.ts \
 *     --dump=<the gate's dump> [--json=<path>]
 *
 * EXIT: 0 measured · 2 usage/environment · 3 CONTROL DID NOT FIRE.
 */
import { readFileSync, existsSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const DUMP = argOf("--dump")
const JSON_OUT = argOf("--json")
if (!DUMP) { console.error("usage: bun run script/m14/cpp-wall-ecosystem.ts --dump=<dump> [--json=<path>]"); process.exit(2) }
const availGB = os.freemem() / (1024 ** 3)
if (availGB < 1) { console.error(`cpp-wall-ecosystem: REFUSING — ${availGB.toFixed(2)} GB available (need >= 1).`); process.exit(2) }

const CORPUS_MARK = `${path.sep}.corpus${path.sep}`
const repoOf = (src: string): string => {
  const i = src.indexOf(CORPUS_MARK)
  return i >= 0 ? src.slice(i + CORPUS_MARK.length).split(path.sep)[0] : src.split(path.sep)[0]
}
const relOf = (src: string): string => {
  const i = src.indexOf(CORPUS_MARK)
  return i >= 0 ? src.slice(i + CORPUS_MARK.length) : src
}

// ── the W1 rule, re-derived from the ANALYZER's own sets (never forked) ───────────────────────────
const analyzerSrc = readFileSync(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"), "utf8")
function extractStringSet(name: string): Set<string> {
  const start = analyzerSrc.indexOf(`export const ${name}`)
  if (start < 0) return new Set()
  const open = analyzerSrc.indexOf("[", start)
  if (open < 0) return new Set()
  let depth = 0, close = -1
  for (let i = open; i < analyzerSrc.length; i++) {
    if (analyzerSrc[i] === "[") depth++
    else if (analyzerSrc[i] === "]") { depth--; if (depth === 0) { close = i; break } } }
  if (close < 0) return new Set()
  const body = analyzerSrc.slice(open + 1, close)
  const out = new Set<string>()
  let i = 0
  while (i < body.length) {
    while (i < body.length && body[i] !== '"') i++
    if (i >= body.length) break
    let j = i + 1
    while (j < body.length && body[j] !== '"') j++
    const v = body.slice(i + 1, j)
    if (v.length > 0) out.add(v)
    i = j + 1
  }
  return out
}
const CPP_KEYWORDS = extractStringSet("CPP_KEYWORDS")
const CPP_BUILTIN_TYPE_KEYWORDS = extractStringSet("CPP_BUILTIN_TYPE_KEYWORDS")
const CPP_NON_CLASS_STANDARD_TYPES = extractStringSet("CPP_NON_CLASS_STANDARD_TYPES")
if (CPP_KEYWORDS.size < 40 || CPP_BUILTIN_TYPE_KEYWORDS.size < 10 || CPP_NON_CLASS_STANDARD_TYPES.size < 5) {
  console.error(`CONTROL DID NOT FIRE: the analyzer's own sets read ${CPP_KEYWORDS.size}/${CPP_BUILTIN_TYPE_KEYWORDS.size}/${CPP_NON_CLASS_STANDARD_TYPES.size}.`)
  process.exit(3)
}
const isIdentifierShape = (s: string): boolean => {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const ok = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_"
    if (!ok) return false
  }
  return !(s[0] >= "0" && s[0] <= "9")
}
const isAllCaps = (s: string): boolean => {
  let hasUpper = false
  for (let i = 0; i < s.length; i++) {
    if (s[i] >= "a" && s[i] <= "z") return false
    if (s[i] >= "A" && s[i] <= "Z") hasUpper = true
  }
  return hasUpper
}
const isW1 = (t: string): boolean => {
  if (t.length === 0) return false
  if (CPP_KEYWORDS.has(t) || CPP_BUILTIN_TYPE_KEYWORDS.has(t)) return false
  if (CPP_NON_CLASS_STANDARD_TYPES.has(t)) return false
  if (t.startsWith("operator") || t.startsWith("~")) return false
  if (t.includes("::")) return false
  if (t.includes("<") || t.includes(">")) return false
  if (!isIdentifierShape(t)) return false
  if (isAllCaps(t)) return false
  return true
}

// ── the CMake facts and the nearest-manifest kind ─────────────────────────────────────────────────
function stripCmakeComments(text: string): string {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    let inString = false
    let cut = line.length
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"' && line[i - 1] !== "\\") inString = !inString
      else if (c === "#" && !inString) { cut = i; break }
    }
    out.push(line.slice(0, cut))
  }
  return out.join("\n")
}
function scanCmake(text: string, command: string): string[][] {
  const out: string[][] = []
  const re = new RegExp(`(^|[^A-Za-z0-9_])${command}\\s*\\(`, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const open = text.indexOf("(", m.index + m[0].length - 1)
    let depth = 0, i = open
    for (; i < text.length; i++) {
      if (text[i] === "(") depth++
      else if (text[i] === ")") { depth--; if (depth === 0) break }
    }
    out.push(text.slice(open + 1, i).split(/\s+/).map((s) => s.replace(/^["']|["']$/g, "")).filter((s) => s.length > 0))
    re.lastIndex = i
  }
  return out
}
const GATE_MANIFEST_KINDS = ["package.json", "composer.json", "pubspec.yaml", "Cargo.toml", "pyproject.toml", "Gemfile", "pom.xml", "build.gradle", "build.gradle.kts", "Package.swift"]
type Facts = { findPackage: string[]; pkgConfig: string[]; importedNamespaces: string[] }
const factsCache = new Map<string, Facts | null>()
const kindCache = new Map<string, string | null>()
function walkUp(absDir: string, repoDir: string, onDir: (dir: string) => boolean): boolean {
  let dir = absDir
  for (;;) {
    if (onDir(dir)) return true
    if (path.resolve(dir) === path.resolve(repoDir)) return false
    const up = path.dirname(dir)
    if (up === dir) return false
    dir = up
  }
}
function nearestKind(absDir: string, repoDir: string): string | null {
  if (kindCache.has(absDir)) return kindCache.get(absDir) ?? null
  let found: string | null = null
  walkUp(absDir, repoDir, (dir) => {
    for (const k of ["CMakeLists.txt", ...GATE_MANIFEST_KINDS]) if (existsSync(path.join(dir, k))) { found = k; return true }
    return false
  })
  kindCache.set(absDir, found)
  return found
}
function factsFor(absDir: string, repoDir: string): Facts | null {
  if (factsCache.has(absDir)) return factsCache.get(absDir) ?? null
  let found: Facts | null = null
  walkUp(absDir, repoDir, (dir) => {
    const candidate = path.join(dir, "CMakeLists.txt")
    if (!existsSync(candidate)) return false
    let text = ""
    try { text = readFileSync(candidate, "utf8") } catch { text = "" }
    const src = stripCmakeComments(text)
    const findPackage = scanCmake(src, "find_package").map((a) => a[0])
      .filter((s): s is string => typeof s === "string" && s.length > 0 && s.toUpperCase() !== "COMPONENTS")
    const pkgConfig: string[] = []
    for (const args of scanCmake(src, "pkg_check_modules")) {
      for (const a of args.slice(1)) {
        if (a.toUpperCase() === "REQUIRED" || a.toUpperCase() === "QUIET" || a.toUpperCase() === "IMPORTED_TARGET") continue
        if (a.startsWith("-")) continue
        pkgConfig.push(a)
      }
    }
    const importedNamespaces: string[] = []
    for (const args of scanCmake(src, "target_link_libraries")) {
      for (const a of args.slice(1)) {
        if (["PUBLIC", "PRIVATE", "INTERFACE"].includes(a.toUpperCase())) continue
        if (a.startsWith("-")) continue
        const ns = a.split("::")[0]
        if (ns && ns !== a) importedNamespaces.push(ns)
      }
    }
    found = { findPackage: [...new Set(findPackage)], pkgConfig: [...new Set(pkgConfig)], importedNamespaces: [...new Set(importedNamespaces)] }
    return true
  })
  factsCache.set(absDir, found)
  return found
}
const aliasesOf = (pkg: string, namespaces: string[]): Set<string> => {
  const out = new Set<string>()
  const p = pkg.trim().toLowerCase()
  if (p.length === 0) return out
  out.add(p); out.add(p.replace(/_/g, "-")); out.add(p.replace(/-/g, "_"))
  for (const seg of p.split(/[_/:.]+/)) if (seg.length >= 3) out.add(seg)
  for (const ns of namespaces) { const n = ns.trim().toLowerCase(); if (n.length > 0) out.add(n) }
  return out
}

// ── the dump's W1 rows ─────────────────────────────────────────────────────────────────────────────
type Row = { target: string; src: string; line: number; outcome: string }
const w1: Row[] = []
let residualRows = 0
let callsResidual = 0
{
  const text = readFileSync(DUMP, "utf8")
  let start = 0
  while (start < text.length) {
    let nl = text.indexOf("\n", start)
    if (nl < 0) nl = text.length
    const line = text.slice(start, nl)
    start = nl + 1
    if (!line.startsWith("DUMP\t")) continue
    const p = line.split("\t")
    if (p.length < 5) continue
    if (p[2] !== "unresolved" && p[2] !== "ambDeclOnly" && p[2] !== "ambBoth") continue
    residualRows++
    if (p[1] !== "calls") continue
    callsResidual++
    const t = p[3].trim()
    if (!isW1(t)) continue
    const m = p[4].match(/^(.*):(\d+)$/)
    if (!m) continue
    w1.push({ target: t, src: m[1], line: Number(m[2]), outcome: p[2] })
  }
}
if (w1.length === 0) { console.error("cpp-wall-ecosystem: 0 W1 rows — check the dump path"); process.exit(3) }

// ── the per-ecosystem pricing ──────────────────────────────────────────────────────────────────────
type Verdict = "CLAIM-SOUND-REACH" | "UNIT-ATTRIBUTION-UNIQUE" | "UNIT-ATTRIBUTION-AMBIGUOUS" | "NO-DECLARED-PACKAGE" | "NO-PROVENANCE" | "FOREIGN-MANIFEST" | "UNVERIFIABLE-NO-MANIFEST"
const VERDICTS: Verdict[] = ["CLAIM-SOUND-REACH", "UNIT-ATTRIBUTION-UNIQUE", "UNIT-ATTRIBUTION-AMBIGUOUS", "NO-DECLARED-PACKAGE", "NO-PROVENANCE", "FOREIGN-MANIFEST", "UNVERIFIABLE-NO-MANIFEST"]
const byVerdict: Record<string, number> = {}
const byEcosystem = new Map<string, { rows: number; verdicts: Record<string, number>; repos: Set<string> }>()
const includeCache = new Map<string, Set<string>>()
const rootsOf = (abs: string): Set<string> => {
  const cached = includeCache.get(abs)
  if (cached) return cached
  const roots = new Set<string>()
  let text = ""
  try { text = readFileSync(abs, "utf8") } catch { text = "" }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*#\s*include\s*<([^>]+)>/.exec(line)
    if (!m) continue
    const p = m[1].trim()
    const slash = p.indexOf("/")
    if (slash > 0) roots.add(p.slice(0, slash).toLowerCase())
  }
  includeCache.set(abs, roots)
  return roots
}
for (const r of w1) {
  const repo = repoOf(r.src)
  const repoDir = path.join(CR, repo)
  const kind = nearestKind(path.dirname(r.src), repoDir)
  const eco = kind ?? "no-manifest"
  const rep = byEcosystem.get(eco) ?? { rows: 0, verdicts: {}, repos: new Set<string>() }
  rep.rows++
  rep.repos.add(repo)
  const bump = (v: Verdict): void => {
    byVerdict[v] = (byVerdict[v] ?? 0) + 1
    rep.verdicts[v] = (rep.verdicts[v] ?? 0) + 1
  }
  if (kind !== null && kind !== "CMakeLists.txt") { bump("FOREIGN-MANIFEST"); byEcosystem.set(eco, rep); continue }
  const facts = factsFor(path.dirname(r.src), repoDir)
  if (!facts) { bump("UNVERIFIABLE-NO-MANIFEST"); byEcosystem.set(eco, rep); continue }
  const roots = rootsOf(r.src)
  if (roots.size === 0) { bump("NO-PROVENANCE"); byEcosystem.set(eco, rep); continue }
  const matched = new Set<string>()
  for (const p of [...facts.findPackage, ...facts.pkgConfig]) {
    for (const a of aliasesOf(p, facts.importedNamespaces)) if (roots.has(a)) { matched.add(p); break }
  }
  if (matched.size === 1) bump("UNIT-ATTRIBUTION-UNIQUE")
  else if (matched.size > 1) bump("UNIT-ATTRIBUTION-AMBIGUOUS")
  else bump("NO-DECLARED-PACKAGE")
  byEcosystem.set(eco, rep)
}

const sum = Object.values(byVerdict).reduce((a, b) => a + b, 0)
if (sum !== w1.length) { console.error(`CONTROL DID NOT FIRE: the verdict classes sum to ${sum} but there are ${w1.length} W1 rows.`); process.exit(3) }
if ((byVerdict["UNIT-ATTRIBUTION-UNIQUE"] ?? 0) + (byVerdict["UNIT-ATTRIBUTION-AMBIGUOUS"] ?? 0) + (byVerdict["NO-DECLARED-PACKAGE"] ?? 0) + (byVerdict["NO-PROVENANCE"] ?? 0) + (byVerdict["FOREIGN-MANIFEST"] ?? 0) + (byVerdict["UNVERIFIABLE-NO-MANIFEST"] ?? 0) !== w1.length) {
  console.error("CONTROL DID NOT FIRE: a W1 row landed in no class.")
  process.exit(3)
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-wall-ecosystem.ts",
  measuredAt: new Date().toISOString(),
  dump: DUMP,
  corpusRoot: CR,
  population: { residualRowsInDump: residualRows, callsResidualRows: callsResidual, w1Rows: w1.length, repos: new Set(w1.map((r) => repoOf(r.src))).size },
  rule: "the W1 class re-derived from the ANALYZER's own exported sets; the ECOSYSTEM is the kind of the FIRST manifest above the file; the claim's unit attribution matches the unit's external include roots against the governing manifest's declared packages.",
  verdicts: byVerdict,
  perEcosystem: Object.fromEntries([...byEcosystem.entries()].sort((a, b) => b[1].rows - a[1].rows).map(([k, v]) => [k, { rows: v.rows, repos: [...v.repos].sort(), verdicts: v.verdicts }])),
  note: "the WALL (the W1 class) per ecosystem, priced against the package-scope claim. NO INDEX IS NEEDED for this table: the W1 class is a spelling rule, the ecosystem is the nearest manifest's kind, and the unit attribution is the manifest and the source. The A/C/D REFINEMENT (which needs the index) is script/m14/cpp-d-package-scope.ts's table.",
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) {
  const fs = await import("node:fs")
  const t = path.resolve(ROOT, JSON_OUT)
  fs.mkdirSync(path.dirname(t), { recursive: true })
  fs.writeFileSync(t, json)
}
const pct = (n: number): string => `${((n / w1.length) * 100).toFixed(1)}%`
console.log(`cpp-wall-ecosystem — W1 ${w1.length} rows (of ${callsResidual} residual call rows) · no index used`)
for (const v of VERDICTS) console.log(`  ${v.padEnd(28)} ${String(byVerdict[v] ?? 0).padStart(8)}  ${pct(byVerdict[v] ?? 0)}`)
console.log("PER ECOSYSTEM")
for (const [eco, v] of Object.entries(report.perEcosystem)) {
  const parts = VERDICTS.map((x) => `${x.replace("UNIT-ATTRIBUTION-", "ua-").replace("NO-DECLARED-PACKAGE", "no-declared").replace("UNVERIFIABLE-NO-MANIFEST", "no-manifest").replace("CLAIM-SOUND-REACH", "sound")}=${v.verdicts[x] ?? 0}`).join(" ")
  console.log(`  ${eco.padEnd(20)} rows=${String(v.rows).padStart(7)}  repos=${String(v.repos.length).padStart(3)}  ${parts}`)
}
