// INCLUDE CENSUS — the admitted-vs-absent target split for the part_of wall,
// over the whole router-admitted make population (BB_CORPUS_ROOT=.corpus → 741
// files), on the production path. The population is enumerated EXACTLY as the
// incoming gate enumerates it: git-tracked paths per repo (git ls-files), the
// router's own admission predicate, the gate's own 1 MiB cap, absent paths
// counted rather than assumed. Counts:
//   * include SITES — every include_directive operand (literal word or
//     computed expression), split literal vs computed;
//   * part_of TARGETS the emission names (symbol-shaped basenames) — how many
//     name an ADMITTED file (a basename of a router-admitted make file in the
//     SAME population) vs something ABSENT from it;
//   * for each literal part_of's written PATH, whether it resolves, relative
//     to the including file's directory, to a router-admitted file.
// NO REGEX: classification is a JSON read, a Set lookup or a tree walk.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, resolve, dirname, basename } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = resolve(ROOT, "validation/m14/fixtures/make/include-census.current.json")
const SIZE_CAP = 1024 * 1024 // the gate's own cap (incoming-gate.ts:305)

const { detectLanguageFromPath } = await import(`${ROOT}/src/ast/language-detection.ts`)
const { parseFile, getParser } = await import(`${ROOT}/src/ast/engine.ts`)

// ── population: the gate's own enumeration AND admission ────────────────────
// The gate's rule (incoming-gate.ts admitByExtension): extension match over the
// lane's table — NOW [mk,mak,makefile,gnumakefile] after the Lead's fix
// (2ec95f3b6), which admitted the 14 `GNUmakefile` files this census's own
// diff walk proved the old table refused — or lowercased basename equal to one
// of those spellings plus the router's verdict.
const EXT = ["mk", "mak", "makefile", "gnumakefile"]
const gateAdmits = (rel: string): boolean => {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (EXT.some((e) => low.endsWith(`.${e}`))) return true
  return EXT.some((e) => base === e) && detectLanguageFromPath(rel) === "make"
}
const found: string[] = []
let absent = 0, overCap = 0
for (const name of readdirSync(CR).sort()) {
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!gateAdmits(rel)) continue
    const abs = join(dir, rel)
    try {
      const size = statSync(abs).size
      if (size > SIZE_CAP) { overCap++; continue }
    } catch { absent++; continue }
    found.push(abs)
  }
}
found.sort()
const files = found
const relOf = (p: string) => (p.startsWith(CR) ? p.slice(CR.length + 1) : p)

// The basename key space the emission's symbol-shaped targets resolve against.
const admittedByBase = new Map<string, string[]>() // basename → [relpaths]
for (const f of files) admittedByBase.set(basename(f), [...(admittedByBase.get(basename(f)) ?? []), relOf(f)])

type IncSite = { file: string; line: number; written: string; kind: "literal" | "computed" }
const sites: IncSite[] = []
const partTargets: Array<{ file: string; line: number; path: string; symbol: string; admitted: boolean; absRel: string | null }> = []
let parsed = 0, degraded = 0, failed = 0, walkFailed = 0, partEdges = 0, importEdges = 0
const failedFiles: string[] = [], walkFailedFiles: string[] = []

// The analyzer's own expression refusal, copied by rule: last path segment
// must be a name, not syntax.
const partSymbolOf = (p: string): string => {
  const slash = p.lastIndexOf("/")
  const base = slash >= 0 ? p.slice(slash + 1) : p
  if (base.length === 0) return ""
  for (let i = 0; i < base.length; i++) {
    const c = base.charCodeAt(i)
    if (c <= 32 || c === 34 || c === 39 || c === 96 || c === 36 || c === 40 || c === 41 ||
        c === 123 || c === 125 || c === 91 || c === 93 || c === 42 || c === 63 ||
        c === 59 || c === 124 || c === 38 || c === 60 || c === 62 || c === 92 || c === 126) return ""
  }
  return base
}

for (const f of files) {
  const content = readFileSync(f, "utf8")
  // (a) SITES by AST walk — include_directive nodes, operand split literal vs computed.
  try {
    const parser: any = await getParser("make")
    const tree: any = await parser.parse(content, f)
    if (!tree?.rootNode) throw new Error("null root")
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const node: any = stack.pop()
      if (!node) continue
      if (node.type === "include_directive") {
        const line = node.startPosition.row + 1
        const listNode = (node.namedChildren ?? []).find((c: any) => c.type === "list") ?? null
        const ops: Array<{ text: string; kind: "literal" | "computed" }> = []
        if (listNode) {
          for (const c of listNode.namedChildren ?? []) {
            if (c.type === "word") ops.push({ text: String(c.text).trim(), kind: "literal" })
            else if (c.type === "function_call" || c.type === "variable_reference" || c.type === "shell_function" || c.type === "substitution_reference") ops.push({ text: String(c.text).trim(), kind: "computed" })
          }
        } else {
          ops.push({ text: String(node.text).trim(), kind: "computed" })
        }
        for (const o of ops) {
          if (!o.text) continue
          sites.push({ file: relOf(f), line, written: o.text, kind: o.kind })
        }
      }
      for (const c of node.namedChildren ?? []) stack.push(c)
    }
  } catch (e) { walkFailed++; walkFailedFiles.push(`${relOf(f)}: ${String(e).slice(0, 60)}`) }

  // (b) EMISSION on the production path — part_of rows and their targets.
  let res: any
  try { res = await parseFile(f, content) } catch (e) { failed++; failedFiles.push(`${relOf(f)}: ${String(e).slice(0, 60)}`); continue }
  const md = res?.metadata ?? {}
  if (md.fallback === true || md.analysisVersion === "2.0-basic-fallback") { degraded++; continue }
  parsed++
  for (const r of res.relationships ?? []) {
    const t = String(r.relationshipType ?? r.type ?? "")
    if (t === "part_of") {
      partEdges++
      const meta = r?.metadata ?? {}
      const path = String(meta.partPath ?? "")
      const symbol = String(r.target ?? r.targetExternal ?? "")
      const sym = symbol || partSymbolOf(path)
      const baseAdmitted = admittedByBase.has(sym)
      let absRel: string | null = null
      if (path && !path.includes("$")) {
        const dirParts = relOf(f).split("/").slice(0, -1)
        for (const seg of path.split("/")) {
          if (seg === "." || seg === "") continue
          if (seg === "..") { dirParts.pop(); continue }
          dirParts.push(seg)
        }
        const probe = dirParts.join("/")
        if (admittedByBase.has(basename(probe))) {
          const hit = (admittedByBase.get(basename(probe)) ?? []).find((rp) => rp === probe)
          if (hit) absRel = hit
        }
      }
      partTargets.push({ file: relOf(f), line: Number(r.line ?? r.lineNumber ?? -1), path, symbol: sym, admitted: baseAdmitted, absRel })
    }
    if (t === "imports") importEdges++
  }
}

if (walkFailed > 0) {
  console.error(`SITE-WALK REFUSAL — ${walkFailed} file(s): ${walkFailedFiles.slice(0, 3).join(" | ")}`)
  process.exit(3)
}

const literalSites = sites.filter((s) => s.kind === "literal").length
const computedSites = sites.filter((s) => s.kind === "computed").length
const siteFiles = new Set(sites.map((s) => s.file)).size
const admittedTargets = partTargets.filter((p) => p.admitted).length
const absentTargets = partTargets.filter((p) => !p.admitted).length
const pathResolved = partTargets.filter((p) => p.absRel).length
const pathUnresolved = partTargets.filter((p) => !p.absRel).length

const artefact = {
  instrument: "script/m14/tmp/make/include-census.mts",
  whatThisIs: `Include census for the part_of wall over the whole router-admitted make population: include SITES by AST walk (literal vs computed), and the part_of EMISSION's symbol-shaped targets checked against the admitted file list by basename and by written-path resolution.`,
  population: {
    corpusRoot: CR,
    membership: "detectLanguageFromPath(p) === 'make' over git ls-files per repo — the incoming gate's own enumeration and admission",
    admitted: files.length, absent, overCap,
    parsed, degraded, failed, walkFailed,
    repos: new Set(files.map((f) => relOf(f).split("/")[0])).size,
  },
  includeSites: { total: sites.length, literal: literalSites, computed: computedSites, files: siteFiles },
  partOfEmission: { edges: partEdges, importsEdgesForCrossCheck: importEdges, targetsAdmittedByBasename: admittedTargets, targetsAbsentByBasename: absentTargets, targetsPathResolved: pathResolved, targetsPathUnresolved: pathUnresolved },
  perSite: sites,
  perTarget: partTargets,
  failedFiles, walkFailedFiles,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(artefact, null, 2) + "\n")
console.log(`include census — ${parsed}/${files.length} parsed (absent ${absent} · overCap ${overCap}) · repos ${artefact.population.repos}`)
console.log(`include sites ${sites.length}: literal ${literalSites} · computed ${computedSites} in ${siteFiles} files`)
console.log(`part_of edges ${partEdges} · targets ADMITTED-by-basename ${admittedTargets} · ABSENT ${absentTargets}`)
console.log(`written-path resolution: ${pathResolved} resolved · ${pathUnresolved} unresolved`)
