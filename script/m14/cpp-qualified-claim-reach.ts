/**
 * cpp-qualified-claim-reach — THE PACKAGE-SCOPE CLAIM'S REAL C++ REACH, measured.
 *
 * WHY A SEPARATE, LIGHT INSTRUMENT. The four-bucket pricing (`cpp-d-package-scope.ts`) needs the project
 * index, so it is an ARM-scale job. But the claim's REACH does not: the claim fires on a QUALIFIED
 * spelling whose namespace agrees with a declared package's include root — and the qualified rows of the
 * wall carry their qualification IN THE TARGET, so the gate's own dump carries it.
 *
 * THE MEASURED FACT THAT PUTS IT HERE: the dump's qualified rows are `references` (2,770) and `uses` (1)
 * — **not one `calls` row in the whole 871,129-row dump carries a qualified target**, because a `calls`
 * row's TARGET is the callee LEAF and the qualification rides `metadata.qualified`, which the dump does
 * not print. **So this instrument measures the claim's reach over the W4 class, and the claim's reach
 * over the CALLS class is NOT measurable from the dump at all** — it is measurable only by an arm with the
 * emission ON and a CMake-aware context (the Lead's wiring).
 *
 * THE RULE (the lane's ruling — CPP-PACKAGE-SCOPE-RULING.md §1.1): the claim fires iff
 *   1. the spelling is QUALIFIED, and
 *   2. its namespace's first segment is an INCLUDE ROOT of the translation unit (the checkout's
 *      independent spelling of the same package), and
 *   3. EXACTLY ONE declared package of the governing manifest matches that root.
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-qualified-claim-reach.ts \
 *     --dump=.tmp-cpp/cpp-noindex-cap0-dump.txt [--json=<path>]
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
if (!DUMP) { console.error("usage: bun run script/m14/cpp-qualified-claim-reach.ts --dump=<dump> [--json=<path>]"); process.exit(2) }
const availGB = os.freemem() / (1024 ** 3)
if (availGB < 1) { console.error(`cpp-qualified-claim-reach: REFUSING — ${availGB.toFixed(2)} GB available (need >= 1).`); process.exit(2) }

const CORPUS_MARK = `${path.sep}.corpus${path.sep}`
const repoOf = (src: string): string => {
  const i = src.indexOf(CORPUS_MARK)
  return i >= 0 ? src.slice(i + CORPUS_MARK.length).split(path.sep)[0] : src.split(path.sep)[0]
}
const relOf = (src: string): string => {
  const i = src.indexOf(CORPUS_MARK)
  return i >= 0 ? src.slice(i + CORPUS_MARK.length) : src
}

// ── the CMAKE facts (the same semantics the ruling states) ─────────────────────────────────────────
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
function factsFor(absDir: string, repoDir: string): Facts | null {
  if (factsCache.has(absDir)) return factsCache.get(absDir) ?? null
  let dir = absDir
  let found: Facts | null = null
  for (;;) {
    const candidate = path.join(dir, "CMakeLists.txt")
    if (existsSync(candidate)) {
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
      break
    }
    if (path.resolve(dir) === path.resolve(repoDir)) break
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  factsCache.set(absDir, found)
  return found
}
/** The first manifest of ANY kind above the file — the ecosystem label. */
const kindCache = new Map<string, string | null>()
function nearestKind(absDir: string, repoDir: string): string | null {
  if (kindCache.has(absDir)) return kindCache.get(absDir) ?? null
  let dir = absDir
  let found: string | null = null
  for (;;) {
    for (const k of ["CMakeLists.txt", ...GATE_MANIFEST_KINDS]) if (existsSync(path.join(dir, k))) { found = k; break }
    if (found !== null) break
    if (path.resolve(dir) === path.resolve(repoDir)) break
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  kindCache.set(absDir, found)
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

// ── the dump's QUALIFIED rows ──────────────────────────────────────────────────────────────────────
type QRow = { label: string; target: string; src: string; line: number }
const qrows: QRow[] = []
let residualRows = 0
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
    const t = p[3].trim()
    if (!t.includes("::")) continue
    const m = p[4].match(/^(.*):(\d+)$/)
    if (!m) continue
    qrows.push({ label: p[1], target: t, src: m[1], line: Number(m[2]) })
  }
}
if (qrows.length === 0) { console.error("cpp-qualified-claim-reach: 0 qualified rows in the dump — check the dump path"); process.exit(3) }

// ── the measurement ───────────────────────────────────────────────────────────────────────────────
type Verdict = "CLAIM-SOUND-REACH" | "NAMESPACE-NOT-AN-INCLUDE-ROOT" | "NO-DECLARED-PACKAGE" | "AMBIGUOUS" | "FOREIGN-MANIFEST" | "NO-MANIFEST" | "NO-PROVENANCE"
const VERDICTS: Verdict[] = ["CLAIM-SOUND-REACH", "NAMESPACE-NOT-AN-INCLUDE-ROOT", "NO-DECLARED-PACKAGE", "AMBIGUOUS", "FOREIGN-MANIFEST", "NO-MANIFEST", "NO-PROVENANCE"]
const byVerdict: Record<string, number> = {}
const byEcosystem = new Map<string, Record<string, number>>()
const byLabel = new Map<string, number>()
const packages = new Map<string, number>()
const samples: string[] = []
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
for (const r of qrows) {
  const repo = repoOf(r.src)
  const repoDir = path.join(CR, repo)
  const kind = nearestKind(path.dirname(r.src), repoDir)
  const eco = kind ?? "no-manifest"
  const ev: Record<string, number> = byEcosystem.get(eco) ?? {}
  const bump = (v: Verdict): void => {
    byVerdict[v] = (byVerdict[v] ?? 0) + 1
    ev[v] = (ev[v] ?? 0) + 1
    byEcosystem.set(eco, ev)
    byLabel.set(r.label, (byLabel.get(r.label) ?? 0) + 1)
  }
  if (kind !== null && kind !== "CMakeLists.txt") { bump("FOREIGN-MANIFEST"); continue }
  const facts = factsFor(path.dirname(r.src), repoDir)
  if (!facts) { bump("NO-MANIFEST"); continue }
  const cut = r.target.lastIndexOf("::")
  if (cut <= 0) { bump("NO-PROVENANCE"); continue }
  const ns = r.target.slice(0, cut).toLowerCase()
  const root = ns.split("::")[0]
  if (root.length === 0) { bump("NO-PROVENANCE"); continue }
  const roots = rootsOf(r.src)
  if (!roots.has(root)) { bump("NAMESPACE-NOT-AN-INCLUDE-ROOT"); continue }
  const declared = [...facts.findPackage, ...facts.pkgConfig]
  const matched: string[] = []
  for (const p of declared) for (const a of aliasesOf(p, facts.importedNamespaces)) if (a === root) { if (!matched.includes(p)) matched.push(p) }
  if (matched.length === 0) { bump("NO-DECLARED-PACKAGE"); continue }
  if (matched.length > 1) { bump("AMBIGUOUS"); continue }
  bump("CLAIM-SOUND-REACH")
  packages.set(matched[0], (packages.get(matched[0]) ?? 0) + 1)
  if (samples.length < 12) samples.push(`${relOf(r.src)}:${r.line} ${r.label} ${r.target} — package ${matched[0]}`)
}

const total = qrows.length
const sum = Object.values(byVerdict).reduce((a, b) => a + b, 0)
if (sum !== total) { console.error(`CONTROL DID NOT FIRE: the verdict classes sum to ${sum} but there are ${total} qualified rows.`); process.exit(3) }
if ((byVerdict["CLAIM-SOUND-REACH"] ?? 0) === 0 && (byVerdict["FOREIGN-MANIFEST"] ?? 0) + (byVerdict["NO-MANIFEST"] ?? 0) + (byVerdict["NO-PROVENANCE"] ?? 0) === total) {
  console.error("CONTROL DID NOT FIRE: every qualified row was unattributable — the instrument read nothing, which is a MISSING MEASUREMENT, not an answer.")
  process.exit(3)
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-qualified-claim-reach.ts",
  measuredAt: new Date().toISOString(),
  dump: DUMP,
  corpusRoot: CR,
  population: { residualRowsInDump: residualRows, qualifiedRows: total, byLabel: Object.fromEntries([...byLabel.entries()].sort((a, b) => b[1] - a[1])) },
  rule: "the claim fires iff the spelling is QUALIFIED, its namespace's first segment is an INCLUDE ROOT of the translation unit, and EXACTLY ONE declared package of the governing manifest matches that root.",
  verdicts: byVerdict,
  byEcosystem: Object.fromEntries([...byEcosystem.entries()].sort((a, b) => (b[1]["CLAIM-SOUND-REACH"] ?? 0) - (a[1]["CLAIM-SOUND-REACH"] ?? 0))),
  packagesClaimed: Object.fromEntries([...packages.entries()].sort((a, b) => b[1] - a[1])),
  samples,
  note: "the claim's reach over the QUALIFIED class of the wall. The dump's qualified rows are `references` and `uses` — NOT `calls`: a calls row's TARGET is the callee LEAF and the qualification rides metadata.qualified, which the dump does not print. So the claim's reach over the CALLS class is NOT measurable from the dump; it is measurable only by an arm with the emission ON and a CMake-aware context.",
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) {
  const fs = await import("node:fs")
  const t = path.resolve(ROOT, JSON_OUT)
  fs.mkdirSync(path.dirname(t), { recursive: true })
  fs.writeFileSync(t, json)
}
console.log(`cpp-qualified-claim-reach — ${total} qualified rows (${[...byLabel.entries()].map(([k, v]) => `${k} ${v}`).join(", ")})`)
for (const v of VERDICTS) console.log(`  ${v.padEnd(30)} ${String(byVerdict[v] ?? 0).padStart(7)}  ${(((byVerdict[v] ?? 0) / total) * 100).toFixed(1)}%`)
console.log("PER ECOSYSTEM")
for (const [eco, ev] of Object.entries(report.byEcosystem)) console.log(`  ${eco.padEnd(20)} ${JSON.stringify(ev)}`)
console.log("THE PACKAGES THE CLAIM WOULD NAME")
for (const [p, n] of Object.entries(report.packagesClaimed)) console.log(`  ${p.padEnd(24)} ${n}`)
for (const s of samples) console.log(`  e.g. ${s}`)
