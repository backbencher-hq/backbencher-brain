/**
 * PHP `overrides` — HOW BIG IS THE SUBSET THE LANE DOES NOT COVER, and is the bound justified?
 *
 * ## Why this measurement exists
 *
 * `resolveOverrides` emits an `overrides` edge only when the BASE'S METHOD SET IS VISIBLE in
 * the same file (`methodsByOwner`, built from this file's symbols). A cross-file base emits
 * nothing, and the reason is on the record: php keys edges on the LEAF name, phpunit declares
 * three `TestSuite` classes and two `Assert` classes (one vendored), and
 * `script/m12/php-override-audit.ts` measured the old cross-file guess at 66.7% FALSE — e.g.
 * `StringEqualsStringIgnoringWhitespace.normalizeWhitespace "overrides"` a base that does not
 * declare it at all.
 *
 * That makes the boundary CORRECT but it does not make it SMALL, and a boundary whose size is
 * unknown is indistinguishable from a boundary that hides the work. So this instrument walks
 * the whole admitted population with the pinned grammar and counts, per DIRECT base:
 *
 *   SAME-FILE    the base is declared in the same file  -> the analyzer covers it
 *   CROSS-FILE   the base is declared in ANOTHER admitted file -> NOT covered, by ruling
 *   EXTERNAL     the base is declared by no admitted file -> there is nothing to resolve to
 *
 * and, for CROSS-FILE, whether the base's LEAF NAME IS AMBIGUOUS (declared by more than one
 * admitted file) — because that number is what the ruling rests on, and it is checkable rather
 * than assertable: if every cross-file base resolved to exactly one file, the bound would be
 * an unfinished job rather than a language boundary.
 *
 * ## The CONTROL, and the corrected walker it caught
 *
 * The first version of this file walked base clauses RECURSIVELY, so a base clause belonging to
 * an anonymous class nested in a method body was attributed to the OUTER class — and it read
 * 20 same-file sites where the lane's oracle reads **2** across the same 5,094 files. A census
 * that disagrees with the oracle on the subset the oracle covers cannot be trusted about the
 * subset it does not, so the walker now mirrors `derivePhpOverridesTruth` EXACTLY (direct
 * `base_clause` child only, `baseIdentity` for a qualified same-leaf base, methods deduped per
 * `base.method` target) and ASSERTS its same-file total against the oracle's own committed
 * number (2) — printed as a control, and a failure exits non-zero.
 *
 * With that control holding, the CROSS-FILE number is produced by the same walker under the
 * same rules, which is what makes it a denominator rather than a second opinion.
 *
 * BOUND, stated: DIRECT bases only (transitive inheritance is not followed) and methods are
 * compared by NAME, both exactly as the analyzer compares them.
 *
 * Run: npx tsx validation/m14/fixtures/php/override-scope-census.mts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
/** The oracle's same-file total over this population, from
 *  `validation/m14/fixtures/php/overrides-truth-crosscheck.mts` (truth 2 == analyzer 2). */
const ORACLE_SAME_FILE_EDGES = 2

// ---------------------------------------------------------------- population (the gate's rule)
const files: { abs: string; repo: string; rel: string }[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".php")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push({ abs, repo: name, rel })
  }
}
files.sort((a, b) => (a.abs < b.abs ? -1 : 1))
console.log(`admitted .php files ${files.length} across ${new Set(files.map((f) => f.repo)).size} repos`)

// ---------------------------------------------------------------- parser (the lane's pinned wasm)
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm"))))

const TYPE_KINDS = new Set(["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"])
type TypeInfo = { name: string; base: string | null; methods: Map<string, boolean>; kind: string; rel: string }
const byLeaf = new Map<string, TypeInfo[]>()
const typesByFile = new Map<string, TypeInfo[]>()

const nameOf = (n: any): string => String(n?.childForFieldName?.("name")?.text ?? "")
const leaf = (raw: string): string => {
  const i = raw.lastIndexOf("\\")
  return i >= 0 ? raw.substring(i + 1) : raw
}
/** The lane's identity for a base (the oracle's `baseIdentity`): the leaf, unless that would
 *  name the class itself, in which case the qualified spelling is kept. */
const baseIdentity = (raw: string, ownName: string): string => {
  const l = leaf(raw)
  if (raw.includes("\\") && l === ownName) {
    let i = 0
    while (i < raw.length && raw.charCodeAt(i) === 92) i++
    return raw.substring(i)
  }
  return l
}
const isPrivate = (member: any): boolean => {
  for (let i = 0; i < member.childCount; i++) {
    const c = member.child(i)
    if (c && c.type === "visibility_modifier" && String(c.text) === "private") return true
  }
  return false
}

/** EXACTLY the oracle's collection: type declarations, their DIRECT base_clause, and methods
 *  read from the type's own body. No recursion into nested types — that was the bug. */
function typesIn(root: any, rel: string): TypeInfo[] {
  const out: TypeInfo[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (TYPE_KINDS.has(String(n.type))) {
      const name = nameOf(n)
      if (name) {
        let baseNode: any = null
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "base_clause") { baseNode = c.namedChild(0) ?? null; break }
        }
        const methods = new Map<string, boolean>()
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || (c.type !== "declaration_list" && c.type !== "enum_declaration_list")) continue
          for (let j = 0; j < c.namedChildCount; j++) {
            const m = c.namedChild(j)
            if (!m) continue
            const mt = String(m.type)
            if (mt !== "method_declaration" && mt !== "abstract_method_declaration") continue
            const mn = nameOf(m)
            if (mn) methods.set(mn, isPrivate(m))
          }
        }
        out.push({
          name, base: baseNode ? baseIdentity(String(baseNode.text ?? ""), name) : null,
          methods, kind: String(n.type), rel,
        })
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return out
}

let parsed = 0
let typeCount = 0
for (const f of files) {
  let tree: any
  try { tree = parser.parse(readFileSync(f.abs, "utf8")) } catch { continue }
  parsed++
  const found = typesIn(tree.rootNode, f.rel)
  typesByFile.set(f.rel, found)
  for (const t of found) {
    typeCount++
    let arr = byLeaf.get(t.name)
    if (!arr) byLeaf.set(t.name, (arr = []))
    arr.push(t)
  }
  tree.delete?.()
}
console.log(`parsed ${parsed}/${files.length} files; ${typeCount} type declarations indexed`)

// ---------------------------------------------------------------- classify every direct base
// DEDUPED PER FILE ON `base.method`, the oracle's own unit — one edge per (base, method) per
// file, so a file with three subclasses of one base overriding the same method is ONE edge on
// both sides rather than three.
let sameFileEdges = 0, crossFileEdges = 0, crossUnambig = 0, crossAmbig = 0, externalBases = 0
let crossPairs = 0, crossAmbigPairs = 0, externalPairs = 0, typesWithBase = 0
const crossFileFiles = new Set<string>()
const sameFileDetail: string[] = []
const crossKindMix = new Map<string, number>()
const examples: string[] = []

for (const [tRel, list] of typesByFile) {
  const localByName = new Map(list.map((t) => [t.name, t]))
  // The oracle's unit: one edge per (base, method) PER FILE, so N subclasses in one file
  // overriding the same base method are ONE edge there and must be one here.
  const sameFileSeen = new Set<string>()
  for (const t of list) {
    if (!t.base) continue
    typesWithBase++
    const sameFileBase = localByName.get(t.base)
    if (sameFileBase) {
      for (const [m, priv] of sameFileBase.methods) {
        if (priv || !t.methods.has(m)) continue
        const key = `${sameFileBase.name}.${m}`
        if (sameFileSeen.has(key)) continue
        sameFileSeen.add(key)
        sameFileEdges++
        sameFileDetail.push(`${t.rel}: ${t.name}.${m} -> ${sameFileBase.name}.${m}`)
      }
      continue
    }
    const declaring = (byLeaf.get(t.base) ?? []).filter((d) => d.rel !== t.rel)
    if (declaring.length === 0) { externalBases++; externalPairs++; continue }
    const union = new Set<string>()
    for (const d of declaring) for (const [m, priv] of d.methods) if (!priv) union.add(m)
    const hits = [...t.methods.keys()].filter((m) => union.has(m))
    if (hits.length === 0) continue
    const uniq = new Set(hits.map((m) => `${t.base}.${m}`))
    crossFileEdges += uniq.size
    crossPairs++
    crossFileFiles.add(t.rel)
    const distinctFiles = new Set(declaring.map((d) => d.rel))
    crossKindMix.set(t.kind, (crossKindMix.get(t.kind) ?? 0) + uniq.size)
    if (distinctFiles.size === 1) crossUnambig += uniq.size
    else { crossAmbig += uniq.size; crossAmbigPairs++ }
    if (examples.length < 8) {
      examples.push(`${t.rel}: ${t.name} extends ${t.base} (declared in ${distinctFiles.size} file(s)) -> ${uniq.size} edge(s)`)
    }
  }
  void tRel
}

const controlOk = sameFileEdges === ORACLE_SAME_FILE_EDGES
console.log("\n=== overrides — the covered subset and the ruled-out one (DIRECT bases) ===")
console.log(`type declarations with a direct base       ${typesWithBase}`)
console.log(`SAME-FILE override edges (deduped)         ${sameFileEdges}   <- the analyzer's subset`)
console.log(`   CONTROL vs the oracle's committed total  ${ORACLE_SAME_FILE_EDGES}   ${controlOk ? "MATCH" : "*** MISMATCH — this walker is NOT the oracle's equal, do not read the cross-file number ***"}`)
console.log(`CROSS-FILE override edges (deduped)        ${crossFileEdges}   <- NOT emitted, by ruling`)
console.log(`   base leaf UNAMBIGUOUS (1 declaring file) ${crossUnambig}`)
console.log(`   base leaf AMBIGUOUS   (>1 declaring file) ${crossAmbig}`)
console.log(`EXTERNAL base clauses                       ${externalBases}  (no admitted file declares the base)`)
console.log(`distinct class/base pairs with cross sites  ${crossPairs} (ambiguous-base pairs ${crossAmbigPairs})`)
console.log(`files carrying a cross-file site            ${crossFileFiles.size}`)
console.log(`by declaring type kind                      ${[...crossKindMix].map(([k, v]) => `${k}:${v}`).join(" ")}`)
for (const e of examples) console.log(`   e.g. ${e}`)
console.log(`\nsame-file detail (all ${sameFileDetail.length}): ${sameFileDetail.join(" | ") || "(none)"}`)
for (const e of examples) void e

const out = {
  generatedAt: new Date().toISOString(),
  corpusRoot: CR,
  population: { admitted: files.length, parsed, typeDeclarations: typeCount },
  control: { oracleSameFileEdges: ORACLE_SAME_FILE_EDGES, thisWalkerSameFileEdges: sameFileEdges, match: controlOk },
  directBaseClauses: typesWithBase,
  sameFileOverrideEdges: sameFileEdges,
  crossFileOverrideEdges: crossFileEdges,
  crossFileUnambiguousBaseEdges: crossUnambig,
  crossFileAmbiguousBaseEdges: crossAmbig,
  externalBaseClauses: externalBases,
  pairs: { crossFile: crossPairs, ambiguousBase: crossAmbigPairs, external: externalPairs },
  crossFileFiles: crossFileFiles.size,
  crossKindMix: Object.fromEntries(crossKindMix),
  sameFileDetail,
  examples,
}
writeFileSync(path.join(ROOT, "validation/m14/fixtures/php/override-scope-census.json"), JSON.stringify(out, null, 2))
console.log(`artifact: validation/m14/fixtures/php/override-scope-census.json`)
if (!controlOk) process.exit(1)
