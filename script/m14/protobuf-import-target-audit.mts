/**
 * THE MODULE-EDGE TARGET — is `imports`' unresolvable target really EXTERNAL?
 *
 * ## What is being asked, and why it is the same question pass 16 asked twice
 *
 * `imports` and `exports` carry their target as the path AS WRITTEN, and this lane
 * has recorded that endpoint as "0% by design" on the grounds that `protoc` resolves
 * an import against `-I` include roots the analyzer is never told. That reason is
 * correct about the TARGET and it is the whole of what was ever said about it.
 *
 * Pass 16 measured the SOURCE half of the same edge and the assumption there turned
 * out to be worth 1,560 unresolvable endpoints and 967 ambiguous ones. The target
 * half has had no measurement at all, and it is the half that decides whether this
 * lane's graph can ever walk INTO a declaration from a module dependency.
 *
 * The question is NOT "why is the target unresolved" — the answer is known and sound.
 * It is: **of the targets that do not resolve, how many name a file that EXISTS in
 * the corpus?** Those two populations look identical in a resolution count and are
 * opposite findings:
 *
 *   - a target naming a corpus file is a declaration this lane's index could reach
 *     and does not, and the fix is a cross-file resolution context;
 *   - a target naming nothing is genuinely external — a `protoc` include root the
 *     corpus does not contain — and no amount of index work will ever resolve it.
 *
 * Calling the first "external by design" overstates the design and understates the
 * work, which is the specific confusion the incoming workstream asks lanes to
 * separate.
 *
 * ## The instrument
 *
 * A target is matched to a corpus file by PATH SUFFIX, never by basename: `import
 * "google/protobuf/timestamp.proto"` names an include-root-relative path, and the
 * only thing the analyzer was given is the string. Every corpus file contributes
 * every one of its own `.proto`-terminated suffixes as a key, so
 * `…/google/protobuf/timestamp.proto` answers to `google/protobuf/timestamp.proto`,
 * to `protobuf/timestamp.proto` and to `timestamp.proto` — which is precisely the
 * set of spellings an include root can produce for it. No regex, no text scan: this
 * is a walk of the corpus's own paths.
 *
 * ## What each number would take to overturn
 *
 *   - `reachable` non-zero is overturned by a suffix index built from a DIFFERENT
 *     corpus root; the number is a property of this corpus and says so.
 *   - the `unreachable` set being "genuinely external" is overturned by ANY target
 *     in it that resolves against a corpus file under a rule other than suffix
 *     match — the probe reports the widest suffix that missed, so that case is
 *     checkable by reading the list rather than by re-running with a different rule.
 *   - the ambiguity count is the load-bearing one: a target matching N corpus files
 *     cannot be resolved to one by ANY include-root-blind context, so it is a
 *     different defect from "never indexed" and is counted separately.
 *
 * Reproduce: npx tsx script/m14/protobuf-import-target-audit.mts
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/opencode/pb/import-target-audit.json"

// ------------------------------------------------------------------ corpus walk
const corpus: { repo: string; rel: string; abs: string }[] = []
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(dir)
  } catch {
    continue
  }
  if (!st.isDirectory()) continue
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop() as string
    let kids: string[]
    try {
      kids = readdirSync(cur).sort()
    } catch {
      continue
    }
    for (const k of kids) {
      const p = path.join(cur, k)
      let s: ReturnType<typeof statSync>
      try {
        s = statSync(p)
      } catch {
        continue
      }
      if (s.isDirectory()) {
        if (k === ".git" || k === "node_modules") continue
        stack.push(p)
      } else if (k.endsWith(".proto")) {
        corpus.push({ repo: entry, rel: path.relative(dir, p), abs: p })
      }
    }
  }
}

// ------------------------------------------------------------------ the suffix index
//
// Every `.proto`-terminated suffix of every corpus file's path, mapped to the files
// that answer to it. `google/protobuf/timestamp.proto` is the include-root-relative
// spelling; `timestamp.proto` is the spelling an include root AT that directory
// produces. Both are legitimate, so both are keys, and the count of files behind a
// key is the ambiguity an include-root-blind resolver faces.
const suffixIndex = new Map<string, Set<string>>()
for (const f of corpus) {
  const segs = f.abs.split("/")
  for (let i = 0; i < segs.length; i++) {
    const key = segs.slice(i).join("/")
    if (!key.endsWith(".proto")) continue
    let set = suffixIndex.get(key)
    if (!set) suffixIndex.set(key, (set = new Set()))
    set.add(f.abs)
  }
}

// ------------------------------------------------------------------ the edges
type Row = { type: string; source: string; target: string; line: number; file: string }
const rows: Row[] = []
let filesOk = 0
let filesFail = 0
for (const f of corpus) {
  let r: any
  try {
    r = await parseFile(f.abs, path.dirname(f.abs))
  } catch {
    filesFail++
    continue
  }
  filesOk++
  for (const x of r.relationships ?? []) {
    const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
    if (t !== "imports" && t !== "exports") continue
    rows.push({
      type: t,
      source: String(x.source ?? ""),
      target: String(x.target ?? ""),
      line: Number(x.line ?? x.line_number ?? 0),
      file: `${f.repo}/${f.rel}`,
    })
  }
}

// ------------------------------------------------------------------ classify
//
// A second-order question the file-level count cannot answer, and it decides whether
// the 640 ambiguous edges are recoverable at all. A target matching N corpus files
// is ambiguous AS A FILE — `helloworld.proto` exists in 9 of them — but the graph
// does not walk to files, it walks to SYMBOLS. If every candidate file declares the
// SAME package, then all N candidates agree on the one symbol the edge should land
// on, and the ambiguity is in the spelling rather than in the meaning. That is a
// different finding from "two different declarations claim one name", and pass 15
// measured that second kind for `contains` (90 package ids published by more than
// one file) without ever asking it of the import side.
//
// So each candidate is read for its own `package` declaration, off its parse tree.
// Candidates that agree are counted as AGREE, and the disagreement is reported with
// the packages named, because that residue is the part no include-root-blind
// context can fix and it must not be rounded into the recoverable half.
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await L.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))
const parser = new P()
parser.setLanguage(grammar)
const pkgCache = new Map<string, string | null>()
const packageOfFile = (abs: string): string | null => {
  const hit = pkgCache.get(abs)
  if (hit !== undefined) return hit
  let out: string | null = null
  try {
    const tree = parser.parse(readFileSync(abs, "utf8"))
    if (tree) {
      const visit = (n: any): void => {
        if (out !== null) return
        if (n.type === "package") {
          const named = (n.namedChildren ?? []).map((c: any) => String(c.text))
          out = named.length ? named.join(".") : null
          return
        }
        for (let i = 0; i < n.childCount; i++) visit(n.child(i))
      }
      visit(tree.rootNode)
      tree.delete?.()
    }
  } catch {
    out = null
  }
  pkgCache.set(abs, out)
  return out
}

type Class = "reachable-unique" | "reachable-ambiguous" | "unreachable"
const perType: Record<string, Record<Class, number>> = {}
const distinctTargets = new Set<string>()
const unreachableTargets = new Map<string, number>()
const ambiguousTargets = new Map<string, Set<string>>()
const uniqueTargets = new Map<string, string>()
const perRepoUnreachable: Record<string, number> = {}
// What the N candidate files of an AMBIGUOUS target agree on, and where they differ.
const agreeTargets = new Map<string, string>()
const disagreeTargets = new Map<string, string[]>()
let ambiguousEdgesWhoseCandidatesAgree = 0
let ambiguousEdgesWhoseCandidatesDisagree = 0
let ambiguousEdgesWithAPackagelessCandidate = 0

for (const e of rows) {
  const t = (perType[e.type] ??= { "reachable-unique": 0, "reachable-ambiguous": 0, unreachable: 0 })
  distinctTargets.add(e.target)
  const hits = suffixIndex.get(e.target)
  if (!hits || hits.size === 0) {
    t.unreachable++
    unreachableTargets.set(e.target, (unreachableTargets.get(e.target) ?? 0) + 1)
    const repo = e.file.split("/")[0]
    perRepoUnreachable[repo] = (perRepoUnreachable[repo] ?? 0) + 1
    continue
  }
  if (hits.size === 1) {
    t["reachable-unique"]++
    uniqueTargets.set(e.target, [...hits][0])
    continue
  }
  t["reachable-ambiguous"]++
  const pkgs = new Set<string | null>()
  for (const h of hits) pkgs.add(packageOfFile(h))
  const real = [...pkgs].filter((x): x is string => x !== null && x.length > 0)
  if (pkgs.has(null)) ambiguousEdgesWithAPackagelessCandidate++
  if (real.length === 1 && pkgs.size === 1) {
    ambiguousEdgesWhoseCandidatesAgree++
    agreeTargets.set(e.target, real[0])
  } else {
    ambiguousEdgesWhoseCandidatesDisagree++
    if (!disagreeTargets.has(e.target)) disagreeTargets.set(e.target, [...pkgs].map((x) => (x === null ? "(none)" : x)).sort())
  }
  let set = ambiguousTargets.get(e.target)
  if (!set) ambiguousTargets.set(e.target, (set = new Set()))
  for (const h of hits) set.add(h)
}

// The widest suffix that MISSED, per unreachable target — so a reader can check the
// "genuinely external" claim by looking rather than by re-running a different rule.
const nearestMiss: Record<string, string> = {}
for (const t of unreachableTargets.keys()) {
  const segs = t.split("/")
  let best = ""
  for (let i = 0; i < segs.length; i++) {
    const k = segs.slice(i).join("/")
    if (!k.endsWith(".proto")) continue
    if (suffixIndex.has(k)) best = k
  }
  if (best) nearestMiss[t] = best
}

// "Unreachable" is not one thing, and the distinction decides who could ever fix it.
// A target whose FIRST SEGMENT carries a dot is a host-qualified MODULE PATH —
// `github.com/docker/swarmkit/api/types.proto` is how a Go module names a file, and
// `protoc` resolves it through a module proxy, not through an include root. No
// include-root mechanism, correct or otherwise, can bind it. A target without a dot
// in its first segment is an ordinary include-root-relative path that simply names a
// root this corpus does not contain: recoverable in principle by widening the
// corpus, never by fixing the analyzer. Counting them as one number would let the
// second hide inside the first, and the first is the class where "external" is a
// property of the language's ecosystem rather than a gap anyone left.
const modulePathShaped = (t: string): boolean => {
  const first = t.split("/")[0] ?? ""
  return first.includes(".")
}
const unreachableByShape: Record<string, { edges: number; distinctTargets: string[] }> = {
  "module-path-shaped": { edges: 0, distinctTargets: [] },
  "include-root-shaped": { edges: 0, distinctTargets: [] },
}
for (const [t, n] of unreachableTargets) {
  const k = modulePathShaped(t) ? "module-path-shaped" : "include-root-shaped"
  unreachableByShape[k].edges += n
  unreachableByShape[k].distinctTargets.push(t)
}

const report = {
  corpus: { root: CR, files: corpus.length, parseOk: filesOk, parseFileThrew: filesFail },
  moduleEdges: rows.length,
  distinctTargets: distinctTargets.size,
  perType,
  suffixIndexKeys: suffixIndex.size,
  distinctTargetsReachableUnique: uniqueTargets.size,
  distinctTargetsReachableAmbiguous: ambiguousTargets.size,
  distinctTargetsUnreachable: unreachableTargets.size,
  ambiguousEdgesWhoseCandidatesAgreeOnOnePackage: ambiguousEdgesWhoseCandidatesAgree,
  ambiguousEdgesWhoseCandidatesDisagree: ambiguousEdgesWhoseCandidatesDisagree,
  ambiguousEdgesWithAtLeastOnePackagelessCandidate: ambiguousEdgesWithAPackagelessCandidate,
  edgesResolvableToASingleSymbolIdIfACrossFileContextExisted:
    (perType.imports?.["reachable-unique"] ?? 0) +
    (perType.exports?.["reachable-unique"] ?? 0) +
    ambiguousEdgesWhoseCandidatesAgree,
  distinctTargetsWhoseCandidatesAgree: [...agreeTargets.entries()].slice(0, 20).map(([t, p]) => ({ target: t, package: p })),
  distinctTargetsWhoseCandidatesDisagree: [...disagreeTargets.entries()].slice(0, 20).map(([t, ps]) => ({ target: t, packages: ps })),
  widestAmbiguousTarget: [...ambiguousTargets.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 8)
    .map(([t, s]) => ({ target: t, corpusFiles: s.size })),
  unreachableWithAResolvableSuffix: Object.keys(nearestMiss).length,
  unreachableByShape,
  unreachableTop: [...unreachableTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
  perRepoUnreachableEdges: perRepoUnreachable,
}
writeFileSync(OUT, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
console.log(`\nwrote ${OUT}`)