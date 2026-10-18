/**
 * cpp-index-sizing — MILESTONE 1 of the C++ project-index task (charter §18 priority #2, task-22).
 *
 * THE QUESTION THIS ANSWERS BEFORE ANY IMPLEMENTATION: of the C++ lane's W1-callable wall
 * (614,081 whole-population call rows that are ambiguous or unresolved because the run's key space
 * declares no target), HOW MANY would a per-repo PROJECT INDEX make resolvable? Sizing first, so the
 * movement is priced rather than promised.
 *
 * METHOD — a bounded corpus sample, stated so it can be argued with:
 *   · SAMPLE REPOS: `--repos=fmt,nlohmann-json,r-Rcpp` (default). Chosen because they are medium,
 *     structurally different (header-heavy library / single-header+tests / R bindings with headers)
 *     and together small enough to parse whole (~1,000 files). This is a SAMPLE, not the corpus; every
 *     estimated number below is scaled from it and the scale factor is printed.
 *   · DECLARATION SPACE (the INDEX side): every admitted C++ file (.cpp/.cc/.cxx/.c++/.hpp/.hxx/.ipp/
 *     .inl/.cu) PLUS headers (.h/.hh/.h++), parsed with the cpp analyzer and its published symbols
 *     collected per repo. Headers are included because the index MUST index them even though the
 *     analyzer's own admitted set does not — that is the `.h`-by-content boundary the lane measured
 *     (CPP-D3): declarations in headers are exactly what a per-file model cannot see.
 *   · RESIDUAL ROWS (the WALL side): the gate's own dump, restricted to the sampled repos, rows whose
 *     outcome is unresolved or ambiguous and whose label is calls. Each row's analyzer metadata
 *     (`qualified` spelling) is joined by `label\0target\0line` from the SAME analysis.
 *   · CLASSIFICATION: a row is RESOLVABLE-BY-INDEX when the repo's declaration space contains a
 *     UNIQUE declaration of the leaf as a callable (function/type) AND the call is bare (no
 *     qualifier); QUALIFIER-RESOLVABLE when a qualified call's qualifier names a type/namespace
 *     declared in the repo AND the leaf is declared as its member anywhere in the repo (the index
 *     carries class→member attribution, so this is checkable); AMB-BY-COUNT when the repo declares
 *     the name more than once (the index bounds candidates but cannot choose — no resolution);
 *     MEMBER-BARE / MACRO / THIRD-PARTY / SAME-FILE / HEADER-ONLY as named below.
 *
 * OUTPUT: counts per class, per repo and total, plus the scaled whole-population estimate and the
 * measured contribution of header-only declarations (i.e. what the .h part of the index is worth).
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-index-sizing.ts --dump=.tmp-cpp/cpp-noindex-cap0-dump.txt [--repos=fmt,nlohmann-json,r-Rcpp] [--json=<path>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argOf = (flag: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${flag}=`))
  return j ? j.slice(flag.length + 1) : null
}
const DUMP = argOf("--dump")
const REPOS = (argOf("--repos") ?? "fmt,nlohmann-json,r-Rcpp").split(",").map((s) => s.trim()).filter(Boolean)
const JSON_OUT = argOf("--json")
if (!DUMP) {
  console.error("usage: bun run script/m14/cpp-index-sizing.ts --dump=<gate dump> [--repos=a,b,c] [--json=<path>]")
  process.exit(2)
}

const ADMITTED = new Set(["cpp", "cc", "cxx", "c++", "hpp", "hxx", "ipp", "inl", "cu"])
const HEADERS = new Set(["h", "hh", "h++"])
const extOf = (p: string): string => {
  const base = p.slice(p.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : ""
}
const repoTracked = (repo: string): string[] => {
  const dir = path.join(CR, repo)
  const out = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean)
  return out.filter((rel) => ADMITTED.has(extOf(rel)) || HEADERS.has(extOf(rel)))
}

const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

type Decl = { count: number; kinds: Set<string>; admittedFiles: Set<string>; headerFiles: Set<string>; fileCount: number }
const declByRepo = new Map<string, Map<string, Decl>>()
const fileByRepo = new Map<string, Set<string>>()
let parsedFiles = 0
let failedFiles = 0
for (const repo of REPOS) {
  const repoDir = path.join(CR, repo)
  const files = repoTracked(repo)
  const space = new Map<string, Decl>()
  for (const rel of files) {
    const abs = path.join(repoDir, rel)
    let res: any
    try {
      res = await parseFile(abs, repoDir)
    } catch {
      failedFiles++
      continue
    }
    if (!res || res.success === false) { failedFiles++; continue }
    parsedFiles++
    const isHeader = HEADERS.has(extOf(rel))
    for (const s of res.symbols ?? []) {
      const name = String(s.name ?? "").trim()
      if (name === "") continue
      const d = space.get(name) ?? { count: 0, kinds: new Set<string>(), admittedFiles: new Set<string>(), headerFiles: new Set<string>(), fileCount: 0 }
      d.count++
      d.kinds.add(String(s.kind ?? ""))
      if (isHeader) d.headerFiles.add(rel)
      else d.admittedFiles.add(rel)
      d.fileCount = d.admittedFiles.size + d.headerFiles.size
      space.set(name, d)
    }
  }
  declByRepo.set(repo, space)
  fileByRepo.set(repo, new Set(files))
}

// ── the wall rows: residual calls rows from the gate dump, restricted to the sampled repos ────────
const AMBIGUOUS = new Set(["ambDeclOnly", "ambBoth", "ambKindOnly"])
type Row = { label: string; outcome: string; target: string; src: string; line: number; md: any }
const rows: Row[] = []
const residualFiles = new Set<string>()
for (const line of readFileSync(DUMP, "utf8").split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const p = line.split("\t")
  if (p.length < 5) continue
  const [label, outcome] = [p[1], p[2]]
  if (label !== "calls") continue
  if (outcome !== "unresolved" && !AMBIGUOUS.has(outcome)) continue
  const m = p[4].match(/^(.*):(\d+)$/)
  if (!m) continue
  const src = m[1]
  const repo = REPOS.find((r) => src.includes(`${path.sep}.corpus${path.sep}${r}${path.sep}`) || src.includes(`/.corpus/${r}/`))
  if (!repo) continue
  rows.push({ label, outcome, target: p[3], src, line: Number(m[2]), md: null })
  residualFiles.add(src)
}
if (rows.length === 0) {
  console.error("cpp-index-sizing: 0 residual calls rows for the sampled repos — check the dump path / repo names")
  process.exit(2)
}
// join analyzer metadata (qualified spelling + member facts) from one re-analysis per residual file
const metaKey = (target: string, line: number) => `${target}\0${line}`
const metaByFile = new Map<string, Map<string, any>>()
for (const abs of residualFiles) {
  const repo = REPOS.find((r) => abs.includes(`/.corpus/${r}/`))!
  let res: any
  try {
    res = await parseFile(abs, path.join(CR, repo))
  } catch { continue }
  const m = new Map<string, any>()
  for (const e of res.relationships ?? []) {
    if (String(e.type) !== "calls") continue
    m.set(metaKey(String(e.target ?? ""), Number(e.line_number ?? 0)), e.metadata ?? {})
  }
  metaByFile.set(abs, m)
}
for (const r of rows) r.md = metaByFile.get(r.src)?.get(metaKey(r.target, r.line)) ?? {}

// ── classification ────────────────────────────────────────────────────────────────────────────────
type Leaf = { qualifier: string; bare: string }
const splitQualified = (qualified: string): Leaf => {
  // strip template arguments and call/paren punctuation from a qualified spelling, then split the
  // LAST `::` — the owner of a call is the segment before it. A spelling with no `::` is bare
  // (a member call through an object still spells only the leaf here, which is why it cannot be
  // resolved by an index alone).
  let s = String(qualified ?? "")
  let depth = 0
  let out = ""
  for (const ch of s) {
    if (ch === "<" || ch === "[") depth++
    else if (ch === ">" || ch === "]") depth = Math.max(0, depth - 1)
    else if (depth === 0) out += ch
  }
  s = out.trim()
  const cut = s.lastIndexOf("::")
  if (cut < 0) return { qualifier: "", bare: s }
  return { qualifier: s.slice(0, cut).replace(/^.*?::/, ""), bare: s.slice(cut + 2) }
}
const CALLABLE_KINDS = new Set(["function", "method", "constructor", "type", "class", "struct", "enum", "namespace", "interface", "macro", "constant", "variable", "property", "enum_member"])
const MACRO_KINDS = new Set(["macro"])
const classes: Record<string, { rows: number; samples: string[]; note: string }> = {}
const bump = (k: string, sample: string, note: string) => {
  const c = classes[k] ?? (classes[k] = { rows: 0, samples: [], note })
  c.rows++
  if (c.samples.length < 4) c.samples.push(sample)
}
let headerOnlyRows = 0
const perRepo: Record<string, Record<string, number>> = {}
for (const r of rows) {
  const repo = REPOS.find((x) => r.src.includes(`/.corpus/${x}/`))!
  const space = declByRepo.get(repo)!
  const qualified = typeof r.md?.qualified === "string" ? r.md.qualified : r.target
  const { qualifier, bare } = splitQualified(qualified || r.target)
  const leaf = space.get(bare) ?? space.get(r.target)
  const tag = `${repo}`.slice(0, 60)
  perRepo[repo] ??= {}
  const put = (k: string, note: string) => {
    bump(k, `${tag}:${r.line} ${qualified || r.target}`, note)
    perRepo[repo][k] = (perRepo[repo][k] ?? 0) + 1
  }
  if (!leaf) {
    put("third-party-not-declared-in-repo", "the repo's own source+headers declare no such name by the index proxy (platform / dependency / unparsed spelling)")
    continue
  }
  const onlyHeader = leaf.admittedFiles.size === 0 && leaf.headerFiles.size > 0
  if (onlyHeader) headerOnlyRows++
  const kinds = [...leaf.kinds].sort().join("+")
  const isMemberKind = leaf.kinds.has("method") || leaf.kinds.has("property") || leaf.kinds.has("enum_member")
  const isFreeCallableKind = ["function", "type", "class", "struct", "enum", "interface"].some((k) => leaf.kinds.has(k))
  if (qualifier !== "" && qualifier !== bare) {
    // Qualified call: the owner spelling names something. The index carries typeMembers (owner ->
    // member attribution), so the QUESTION "does owner declare leaf" is exactly answerable by the
    // real index — but this proxy (per-name symbol counts) cannot verify the PAIR, so the classes
    // below are split by which part is unique: the strong class is a LOWER bound on what the real
    // index can verify, the weak class an upper-bound contributor.
    const ownerDecl = space.get(qualifier) ?? space.get(qualifier.split("::").pop() ?? qualifier)
    const ownerInRepo = ownerDecl !== undefined
    const ownerUnique = ownerInRepo && ownerDecl!.count === 1
    const leafUnique = leaf.count === 1
    if (!ownerInRepo) {
      put("qualified-owner-not-in-repo", "qualified spelling whose owner is outside the repo (third-party namespace) — no index gain")
    } else if (ownerUnique && leafUnique && isMemberKind) {
      put("qualified-owner-unique-and-member-unique", "STRONG: the owner is declared once in the repo and the leaf is declared once as a member — the index's typeMembers can verify `owner declares leaf` exactly; the strongest index-resolvable class")
    } else if (ownerUnique && leafUnique && isFreeCallableKind) {
      put("qualified-owner-unique-and-free-callable-unique", "STRONG: a namespace/type owner declared once plus a free callable/type declared once — index-checkable")
    } else if (isMemberKind) {
      put("qualified-owner-and-member-declared-weak", "the owner and a member leaf are both declared in the repo, but one side is not unique — the index can verify the PAIR only with typeMembers; this proxy cannot, so it is an UPPER-bound contributor, not a proven gain")
    } else {
      put("qualified-owner-declared-leaf-free-callable-weak", "owner declared, free callable declared, but a side is not unique — index may still check the pair; upper-bound contributor")
    }
    continue
  }
  // bare call
  if (leaf.kinds.size > 0 && [...leaf.kinds].every((k) => MACRO_KINDS.has(k))) {
    put("macro-declared-in-repo", "the name is a repo MACRO — a policy question (W10), not a callable resolution; counted separately")
    continue
  }
  if (leaf.count === 1 && isFreeCallableKind) {
    put("bare-unique-free-callable", "STRONG: exactly one FREECALLABLE/type declaration of the leaf in the repo (header or source) — a project index resolves this row; the direct gain")
  } else if (leaf.count === 1 && isMemberKind) {
    put("bare-unique-member-only", "the leaf is declared exactly once but only as a MEMBER — a bare call could be an implicit-this member call; the index bounds it to one class but the row needs the enclosing-class fact (no guaranteed gain this pass)")
  } else if (leaf.count === 1) {
    put("bare-unique-other-kind", "one declaration, but of a non-callable kind — no callable resolution")
  } else if (leaf.count > 1) {
    put("bare-multiple-declarations-in-repo", "the repo declares the name more than once — the index bounds the candidate set but the name key still cannot choose (no resolution this pass)")
  } else {
    put("bare-declared-in-file-only", "declared only in the row's own file — a real resolver defect, not an index gain (measured separately)")
  }
  void kinds
}

// ── CONTROL: every residual row in exactly one class; counts close ────────────────────────────────
const classSum = Object.values(classes).reduce((a, b) => a + b.rows, 0)
const failures: string[] = []
if (classSum !== rows.length) failures.push(`class rows ${classSum} != residual rows ${rows.length}`)
for (const [k, c] of Object.entries(classes)) if (k.startsWith("unknown/")) failures.push(`unclassified class ${k}`)
if (failures.length > 0) {
  console.error("CONTROL DID NOT FIRE: sizing classes do not close.")
  for (const f of failures) console.error("  " + f)
  process.exit(3)
}

const W1_TOTAL = 614081 // the accepted D3 classifier count for W1-callable-not-declared-in-run
const sampleFiles = REPOS.reduce((a, r) => a + (fileByRepo.get(r)?.size ?? 0), 0)
const strongClasses = ["bare-unique-free-callable", "qualified-owner-unique-and-member-unique", "qualified-owner-unique-and-free-callable-unique"]
const weakClasses = ["qualified-owner-and-member-declared-weak", "qualified-owner-declared-leaf-free-callable-weak", "bare-unique-member-only"]
const resolvedPrimary = strongClasses.reduce((a, k) => a + (classes[k]?.rows ?? 0), 0)
const upperBound = resolvedPrimary + weakClasses.reduce((a, k) => a + (classes[k]?.rows ?? 0), 0)
const scale = rows.length > 0 ? W1_TOTAL / rows.length : 0
const report: any = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-index-sizing.ts",
  measuredAt: new Date().toISOString(),
  dump: DUMP,
  sample: { repos: REPOS, filesParsed: parsedFiles, filesFailed: failedFiles, residualCallsRows: rows.length, sampleIsOfWall: "the 614,081 W1-callable rows are the whole-population count; this sample's rows are a subset of that wall (stated sample, not corpus)" },
  declarationSpaceProxy: "cpp analyzer symbols per repo over admitted files PLUS headers (.h/.hh/.h++) — the index-side population; the real index will extract with a DeclarationSpec nameResolver and should be a SUPERSET of this proxy, never a subset",
  classes,
  totals: {
    residualRowsInSample: rows.length,
    indexResolvablePrimary: resolvedPrimary,
    indexResolvablePrimaryPct: Number(((100 * resolvedPrimary) / rows.length).toFixed(1)),
    indexResolvableUpperBound: upperBound,
    indexResolvableUpperBoundPct: Number(((100 * upperBound) / rows.length).toFixed(1)),
    estimatedWholePopulationLower: Math.round(resolvedPrimary * scale),
    estimatedWholePopulationUpper: Math.round(upperBound * scale),
    scaleFactor: Number(scale.toFixed(2)),
    headerOnlyRows,
    headerOnlyPct: Number(((100 * headerOnlyRows) / rows.length).toFixed(1)),
  },
  perRepo,
}
if (failures.length > 0) report.control = { ok: false, failures }
else report.control = { ok: true, detail: "every residual row in exactly one class; class sum == residual count" }

const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) {
  const fs = await import("node:fs")
  const target = path.resolve(ROOT, JSON_OUT)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, json)
}
process.stdout.write(
  `cpp-index-sizing — sample repos ${REPOS.join(",")} · ${parsedFiles} files parsed (${failedFiles} failed)\n` +
  `  residual calls rows in sample: ${rows.length}\n` +
  Object.entries(classes).sort((a, b) => b[1].rows - a[1].rows).map(([k, v]) => `  ${String(v.rows).padStart(6)}  ${k}`).join("\n") + "\n" +
  `  index-resolvable STRONG (lower bound): ${resolvedPrimary} (${report.totals.indexResolvablePrimaryPct}%) · scaled to W1 614,081 ≈ ${report.totals.estimatedWholePopulationLower} (×${report.totals.scaleFactor})\n` +
  `  index-resolvable including WEAK classes (upper bound): ${upperBound} (${report.totals.indexResolvableUpperBoundPct}%) · scaled ≈ ${report.totals.estimatedWholePopulationUpper}\n` +
  `  header-only declarations among residual: ${headerOnlyRows} (${report.totals.headerOnlyPct}%) — the .h half of the index\n` +
  `  CONTROL: PASS — every residual row in exactly one class, class sum closes\n`,
)
