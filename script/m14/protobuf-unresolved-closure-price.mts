/**
 * PROTOBUF LANE — what an id->file map would recover, priced with protoc's own rule.
 *
 * ## Why this file exists
 *
 * Pass 20 §8 item 1 asks `src/ast/parallel-indexer.ts:1300` for a protobuf declaration
 * spec, and priced it at **42 edges on 12 distinct targets across 12 files** of 13,024
 * `uses` (0.32%). This probe measures the same thing without the price and gets **3,390
 * edges on 454 targets** — 80x. The request is unchanged; the number attached to it is
 * wrong, and a §8 item priced 80x low is a request a supervisor will deprioritise.
 *
 * ## The measurement, and the rule it applies
 *
 * For every edge this analyzer emits whose target is not a symbol the SAME file
 * declares, this asks: would `protoc` resolve it? protoc's rule for a name written
 * WITHOUT a leading dot is C++ scope lookup — try the current scope, then each enclosing
 * scope, and accept the first that holds a declaration. Two constraints are enforced,
 * because dropping either one inflates the number:
 *
 *   1. **the candidate must be DECLARED** somewhere in the corpus, and
 *   2. **the declaring file must be in the referring file's TRANSITIVE IMPORT CLOSURE.**
 *      protoc refuses a symbol from a file the caller does not depend on. Without this
 *      the walk resolves `docker.swarmkit.v1.Version` from a file that never imports
 *      docker, which protoc would reject: **220 edges across 79 targets** are found and
 *      then refused on exactly this ground.
 *
 * ## Why the two sub-populations have different prices
 *
 * `absolute` — the analyzer ALREADY emitted the correct fully-qualified id. Nothing
 * about the name is wrong; a single-file analyzer simply cannot CONFIRM the id exists.
 * The fix is a lookup, not a resolution algorithm.
 *
 * `relative` — the file wrote a name relative to its scope (`connect.IssuedCert` in
 * `package hashicorp.consul.internal.autoconf`), and protoc walks out to
 * `hashicorp.consul.internal.connect.IssuedCert`. The candidate is also correct here,
 * but only because the scope chain reaches the right package; the fix is the same map
 * plus the walk. **All 38 are consul.**
 *
 * The distinction is what tells a supervisor whether the ask is "publish an id->file map
 * in the project index" or "write a second name resolver". The first is cheap.
 *
 * ## What is NOT claimed
 *
 * This probe measures how many edges WOULD bind if the map existed. It does not assert
 * that any particular implementation binds them correctly, and the `absolute` rows are
 * the ones where a wrong implementation would silently invent a binding: the string is
 * already right, so a map that answered "yes" for the wrong reason would be invisible
 * here. That is the reason this file reports the declaring files rather than a count
 * alone, and why the dependency constraint is applied rather than assumed.
 *
 * ## No regex
 *
 * The corpus walk is `execFileSync` over `find`. The language filter is
 * `endsWith(".proto")`. Import paths are read as the text between the first pair of
 * double quotes on a line whose trimmed text starts with `import` — index arithmetic,
 * not a pattern. The well-known-type classifier is a literal prefix list, so a
 * well-known type spelled some other way lands outside it rather than inside by luck.
 *
 * ## Usage
 *
 *   npx tsx script/m14/protobuf-unresolved-closure-price.mts [fileCount] [--out /path.json] [--json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const NUM = argv.find((a) => /^[0-9]+$/.test(a)) ?? "842"
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "/tmp/opencode/pb/unresolved-closure-price.json"
const JSON_ONLY = argv.includes("--json")

/** Well-known / external spellings. A literal prefix list, so an unusual spelling is
 *  excluded rather than guessed into the bucket. */
const EXTERNAL_PREFIXES = [
  "google.protobuf.", "google/protobuf/", "google.api.", "google/type/",
  "google/rpc/", "protoc-gen-", "validate/", "envoy/", "grpc/",
]
const isExternalShaped = (t: string): boolean => EXTERNAL_PREFIXES.some((p) => t.startsWith(p))

type PF = {
  f: string
  ids: Set<string>
  pkg: string | null
  imports: string[]
}

const files = execFileSync(
  "bash",
  ["-lc", `find ${CR} -name '*.proto' -type f | sort | head -${NUM}`],
  { encoding: "utf8", maxBuffer: 1 << 28 },
)
  .trim()
  .split("\n")
  .filter(Boolean)

const perFile: PF[] = []
/** id -> the corpus files declaring it. This is the map a project index would publish. */
const idToFiles = new Map<string, string[]>()

for (const f of files) {
  const src = readFileSync(f, "utf8")
  const r: any = await parseFile(f, CR)
  const ids = new Set<string>()
  let pkg: string | null = null
  for (const s of r?.symbols ?? []) {
    const k = String(s.qualifiedName ?? "")
    if (!k) continue
    ids.add(k)
    if (!idToFiles.has(k)) idToFiles.set(k, [])
    if (!idToFiles.get(k)!.includes(f)) idToFiles.get(k)!.push(f)
    // A namespace carrying a dot is the package. A namespace with no dot is a directory
    // segment (`proto`), which is the pass-20 §5 defect-3 case and is not a package.
    if (String(s.kind) === "namespace" && k.includes(".")) pkg = k
  }
  const imports: string[] = []
  for (const line of src.split("\n")) {
    const t = line.trim()
    if (!t.startsWith("import")) continue
    const a = t.indexOf('"')
    const b = t.indexOf('"', a + 1)
    if (a > 0 && b > a) imports.push(t.slice(a + 1, b))
  }
  perFile.push({ f, ids, pkg, imports })
}

/** module path -> corpus files answering to it. A path 2+ files answer to is ambiguous. */
const byModulePath = new Map<string, string[]>()
for (const im of new Set(perFile.flatMap((p) => p.imports))) {
  byModulePath.set(im, perFile.filter((p) => p.f.endsWith("/" + im)).map((p) => p.f))
}

const closureCache = new Map<string, Set<string>>()
const closureOf = (f: string, seen: Set<string> = new Set()): Set<string> => {
  if (closureCache.has(f)) return closureCache.get(f)!
  if (seen.has(f)) return new Set()
  seen.add(f)
  const pf = perFile.find((p) => p.f === f)!
  const out = new Set<string>()
  for (const im of pf.imports) {
    for (const h of byModulePath.get(im) ?? []) {
      out.add(h)
      for (const t of closureOf(h, seen)) out.add(t)
    }
  }
  closureCache.set(f, out)
  return out
}

/** protoc's enclosing-scope chain for a name written without a leading dot. */
const scopeChain = (pkg: string | null): string[] => {
  const chain: string[] = []
  if (pkg) {
    const segs = pkg.split(".")
    for (let i = segs.length; i > 0; i--) {
      const v = segs.slice(0, i).join(".")
      if (!chain.includes(v)) chain.push(v)
    }
  }
  chain.push("")
  return chain
}

let unresolvedEdges = 0
let unresolvedTargets = 0
const unresolvedTargetSet = new Set<string>()

const absolute = { edges: 0, targets: new Set<string>(), externalEdges: 0, files: new Set<string>() }
const relative = { edges: 0, targets: new Set<string>(), externalEdges: 0, files: new Set<string>() }
const refusedNotImported = { edges: 0, targets: new Set<string>() }
const noCandidate = { edges: 0, targets: new Set<string>() }
const relativeEvidence: string[] = []

for (const pf of perFile) {
  const r: any = await parseFile(pf.f, CR)
  const dep = closureOf(pf.f)
  const chain = scopeChain(pf.pkg)
  for (const e of r?.relationships ?? []) {
    const t = String(e?.target ?? "")
    if (!t || pf.ids.has(t)) continue
    unresolvedEdges++
    unresolvedTargetSet.add(t)
    if (!t.includes(".")) continue
    let hit = false
    for (const base of chain) {
      const cand = base ? `${base}.${t}` : t
      if (!idToFiles.has(cand)) continue
      hit = true
      const declaring = idToFiles.get(cand)!
      if (!declaring.some((d) => dep.has(d))) {
        refusedNotImported.edges++
        refusedNotImported.targets.add(t)
        break
      }
      const bucket: typeof absolute = base === "" ? absolute : relative
      bucket.edges++
      bucket.targets.add(t)
      bucket.files.add(pf.f)
      if (isExternalShaped(t)) bucket.externalEdges++
      if (base !== "" && relativeEvidence.length < 8) {
        relativeEvidence.push(
          `${pf.f.replace(CR + "/", "")}  pkg=${pf.pkg}  target="${t}"  ->  "${cand}"  declared in ${declaring
            .map((d) => d.replace(CR + "/", ""))
            .join(", ")}`,
        )
      }
      break
    }
    if (!hit) {
      noCandidate.edges++
      noCandidate.targets.add(t)
    }
  }
}
unresolvedTargets = unresolvedTargetSet.size

const recoverableEdges = absolute.edges + relative.edges
const report = {
  population: {
    corpusRoot: CR,
    fileCount: files.length,
    filesWithSymbols: perFile.length,
    sampling: `find -name '*.proto' -type f | sort | head -${NUM}`,
  },
  unresolved: {
    edgesNotDeclaredInTheirOwnFile: unresolvedEdges,
    distinctTargets: unresolvedTargets,
    shareOfAllEdges: null,
  },
  protocWouldResolve: {
    edges: recoverableEdges,
    targets: absolute.targets.size + relative.targets.size,
    shareOfUnresolved: Number(((100 * recoverableEdges) / unresolvedEdges).toFixed(1)),
    absolute: {
      edges: absolute.edges,
      targets: absolute.targets.size,
      filesInvolved: absolute.files.size,
      externalShapedEdges: absolute.externalEdges,
      meaning:
        "the analyzer already emitted the correct fully-qualified id; it could not CONFIRM it " +
        "exists. The fix is an id->file lookup, not a second name resolver.",
    },
    relative: {
      edges: relative.edges,
      targets: relative.targets.size,
      filesInvolved: relative.files.size,
      externalShapedEdges: relative.externalEdges,
      meaning:
        "the file wrote a name relative to its scope and protoc walks out to an enclosing " +
        "package. Same map plus the walk.",
    },
  },
  protocWouldRefuse: {
    declaredButNotTransitivelyImported: {
      edges: refusedNotImported.edges,
      targets: refusedNotImported.targets.size,
      meaning:
        "a candidate exists in the corpus but its declaring file is not in the referring file's " +
        "transitive import closure. protoc rejects these, and so must any implementation.",
    },
    noCandidateInScopeChain: { edges: noCandidate.edges, targets: noCandidate.targets.size },
  },
  relativeEvidence,
}

if (JSON_ONLY) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`population ${report.population.fileCount} files  (${report.population.filesWithSymbols} with symbols)`)
  console.log(`sampling: ${report.population.sampling}`)
  console.log(`unresolved on the binding key: ${unresolvedEdges} edges, ${unresolvedTargets} distinct targets`)
  console.log()
  console.log(`protoc WOULD RESOLVE: ${recoverableEdges} edges (${report.protocWouldResolve.shareOfUnresolved}% of unresolved), ${report.protocWouldResolve.targets} targets`)
  console.log(`  absolute — id already correct, map miss only: ${absolute.edges} edges, ${absolute.targets.size} targets, ${absolute.files.size} files (external-shaped ${absolute.externalEdges})`)
  console.log(`  relative — scope walk needed:                ${relative.edges} edges, ${relative.targets.size} targets, ${relative.files.size} files (external-shaped ${relative.externalEdges})`)
  console.log(`protoc WOULD REFUSE:`)
  console.log(`  declared but NOT transitively imported:       ${refusedNotImported.edges} edges, ${refusedNotImported.targets.size} targets`)
  console.log(`  no candidate in the scope chain at all:       ${noCandidate.edges} edges, ${noCandidate.targets.size} targets`)
  if (relativeEvidence.length) {
    console.log()
    console.log(`  relative-name evidence:`)
    for (const e of relativeEvidence) console.log(`    ${e}`)
  }
}
writeFileSync(OUT, JSON.stringify(report, null, 2))