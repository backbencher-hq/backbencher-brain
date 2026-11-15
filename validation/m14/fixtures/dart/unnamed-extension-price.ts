/**
 * WHAT DO DART'S UNNAMED EXTENSIONS DO TO A NAME-KEYED GRAPH? — dart lane, priced before built.
 *
 * `extension on Object? { void f() {} }` is legal Dart: an extension with NO name. The analyzer
 * gives it one — the TARGET TYPE — "so their members keep an owner scope"
 * (`case "extension_declaration"` in `real-dart-analyzer.ts`), and marks the row
 * `metadata.isUnnamedExtension`. The intent is sound; the consequence is a NAME-KEYED lie:
 *
 *   the symbol table of the project then contains a symbol named `Object` (or `String`, or
 *   `TestFactory`) that is not that declaration, its members publish `Object.f` as a qualified
 *   name, and every edge or claim whose evidence is "the project does not declare `Object`"
 *   reads the other way.
 *
 * MEASURED, and this is the instrument that found it (`riverpod`, 1,295 files, `--index`):
 *
 *   packages/riverpod/test/feature/offline_test.dart:884  `extension on Object? { ... }`
 *   -> the project publishes a symbol  kind=extension name="Object" qname="Object"
 *   -> `overrides` extFAIL = 31, and all 31 are `Object.operator ==` / `Object.hashCode` /
 *      `Object.toString` rows the analyzer retargeted to the dart:core Object interface and
 *      marked `isExternalBase`, which the arbiter verifies by looking the OWNER up. It finds
 *      `Object` (the anonymous extension) and refutes a claim that is true.
 *   The same file also has `extension on AnyNotifier<Object?, Object?>` — whose "name" is not an
 *   identifier at all, so its members publish targets no key can ever match.
 *
 * WHAT THIS MEASURES — and the reason it does not read the analyzer's own marker.
 *
 * The analyzer marks the row `metadata.isUnnamedExtension` (verified: calling
 * `RealDartAnalyzer.analyze` directly on `offline_test.dart` prints
 * `{"isExtension":true,"targetType":"Object","isUnnamedExtension":true}`). Going through
 * `pool-worker.parseFile` the SAME symbol comes back with `metadata: undefined`, because the pool
 * projects symbols onto the DB's column set and hoists only `fqn`/`complexity`/`ownerKind`. That is
 * the designed contract, not a defect — but it means a CONSUMER cannot see the marker, so this
 * instrument must not depend on it either, and neither can any future fix: what a consumer sees is
 * the NAME, which is exactly what this price measures.
 *
 * So the harm is measured where it is visible: an extension symbol whose NAME is also published by
 * a non-extension kind in the same project. That is a collision, and a collision is what makes a
 * claim or a resolution read the wrong way. Plus how many such names are not identifier-shaped at
 * all (a target type carrying generics), whose members no key can ever match.
 *
 * MEASURED AFTER THE FIX — same instrument, same three projects, still calling the analyzer
 * directly (`/tmp/dartgate/unnamed-ext-price-after.log`):
 *
 *   dart-http   2 unnamed extensions  →  0 colliding with a real declaration, 0 synthesized-name
 *                                        collisions, 0 edges naming a synthesized member key
 *   riverpod   42 unnamed extensions  →  0 colliding with a real declaration (was 19), 14 sharing
 *                                        their synthesized name with ANOTHER unnamed extension,
 *                                        4 edges naming a synthesized member key
 *   proxicall   1 unnamed extension   →  0 colliding, 0 shared, 0 edges
 *
 * Three parts of that are worth reading carefully.
 *
 *   (1) 41 → 42 is the fix's own footprint, not corpus drift. An unnamed extension whose `on` type
 *       is not an identifier (`extension on AnyNotifier<Object?, Object?>` — `extensionTargetType`
 *       answers only for `type_identifier`/`void_type`) used to publish NO symbol at all, so its
 *       members leaked into whatever scope enclosed it; it now publishes the bare
 *       `unnamed_extension` and owns them, which is java's `anonymous_class` fallback.
 *   (2) 19 → 0 is the harm, and it is the whole point. The `Object` row is gone: no project now
 *       publishes a declaration named after a type it merely extends.
 *   (3) 14 is the RESIDUAL, and it is stated rather than argued away. Two `extension on String` in
 *       one project publish ONE synthesized name, exactly as two `new Comparator() {}` both publish
 *       `anonymous_Comparator` in java (real-java-analyzer.ts). Removing it would need a line- or
 *       path-derived name, which is the artifact spelling `isIndexArtifactName` exists to reject.
 *       It is a separate census below (census (b)) so it is a number and not an assumption; the
 *       edges that could be affected are the 4, and the gate is what says whether they resolve.
 *
 * Run: npx tsx validation/m14/fixtures/dart/unnamed-extension-price.ts [repo,repo,...]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import * as WTS from "web-tree-sitter"
import { RealDartAnalyzer } from "../../../../src/ast/real-dart-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CONC = Number(process.env.BB_DART_CONC ?? 4)
const repos = (process.argv[2] ?? "dart-http,riverpod,proxicall").split(",")

function filesOf(name: string): string[] | null {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) return null } catch { return null }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { return null }
  return tracked.filter((r) => r.endsWith(".dart")).map((r) => path.join(dir, r))
}

type Row = {
  file: string
  name: string
  target: string
  identifierShaped: boolean
  /** the members this extension publishes, so an edge that targets one can be found */
  members: string[]
}
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

// A PRICE calls the analyzer DIRECTLY: the pool projection drops symbol metadata (see the header),
// and `metadata.isUnnamedExtension` is the only thing that distinguishes an extension the SOURCE
// named from one the ANALYZER named. Sequential, one parser and one analyzer instance per file.
const wts: any = WTS
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang: any = await L.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-dart.wasm")))
const parser = new P()
parser.setLanguage(lang)

for (const repoName of repos) {
  const files = filesOf(repoName)
  if (files === null || files.length === 0) continue
  const repo = path.join(CR, repoName)
  const rows: Row[] = []
  /** every name the project publishes, with the KINDS that publish it — the collision census */
  const published = new Map<string, Set<string>>()
  /** every edge the project emits, as `target` — to find edges that name an extension's member */
  const targets: { src: string; tgt: string; type: string; file: string }[] = []
  let parsed = 0
  for (const f of files) {
    let out: any
    try {
      const content = readFileSync(f, "utf8")
      const tree = parser.parse(content)
      if (!tree) continue
      out = new RealDartAnalyzer().analyze(tree.rootNode, content, f, { projectRoot: repo } as any)
    } catch {
      continue
    }
    parsed++
    const syms = (Array.isArray(out?.symbols) ? out.symbols : []) as any[]
    const byOwner = new Map<string, string[]>()
    for (const s of syms) {
      const n = String(s?.name ?? "")
      if (!n) continue
      let set = published.get(n)
      if (!set) published.set(n, (set = new Set()))
      set.add(String(s?.kind ?? ""))
      const owner = String(s?.ownerName ?? "")
      if (owner) {
        const l = byOwner.get(owner) ?? []
        l.push(n)
        byOwner.set(owner, l)
      }
      if (String(s?.kind ?? "") !== "extension") continue
      if (s?.metadata?.isUnnamedExtension !== true) continue
      rows.push({
        file: path.relative(repo, f),
        name: n,
        target: String(s?.metadata?.targetType ?? ""),
        identifierShaped: IDENT.test(n),
        members: byOwner.get(n) ?? [],
      })
    }
    for (const r of (Array.isArray(out?.relationships) ? out.relationships : []) as any[]) {
      const tgt = String(r?.target ?? "")
      if (tgt) targets.push({ src: String(r?.source ?? ""), tgt, type: String(r?.type ?? ""), file: path.relative(repo, f) })
    }
  }
  // TWO CENSUSES, because the fix splits one harm into two and only one of them is gone.
  //
  //   (a) COLLIDING WITH A REAL DECLARATION — the name the extension borrowed belongs to a
  //       declaration that is NOT an extension. This is the harm: it makes a true external claim
  //       about the owner refutable, and it makes the owner's member targets ambiguous.
  //   (b) SHARED BY TWO UNNAMED EXTENSIONS — the residual. Two `extension on Object?` in one
  //       project publish the SAME synthesized name by construction, exactly as two
  //       `new Comparator(){}` both publish `anonymous_Comparator` in java
  //       (real-java-analyzer.ts). It cannot be removed without a line- or path-derived name,
  //       which is the artifact spelling `isIndexArtifactName` exists to reject; it is measured
  //       here so it is a number rather than an assumption.
  const collisions = new Map<string, Row[]>()
  const shared = new Map<string, Row[]>()
  let notIdentifier = 0
  for (const row of rows) {
    if (!row.identifierShaped) notIdentifier++
    const realKinds = [...(published.get(row.name) ?? [])].filter((k) => k !== "extension")
    if (realKinds.length > 0) {
      const list = collisions.get(row.name) ?? []
      list.push(row)
      collisions.set(row.name, list)
    }
    const sibs = shared.get(row.name) ?? []
    sibs.push(row)
    shared.set(row.name, sibs)
  }
  // THE REGRESSION SIDE: an edge that targets `<extension name>.<member>` resolves today, and a
  // rename would leave it naming nothing. Counted, not argued away — it is the cost of the fix.
  const extensionMemberKeys = new Set<string>()
  for (const row of rows) for (const m of row.members) extensionMemberKeys.add(`${row.name}.${m}`)
  const dependent = targets.filter((t) => extensionMemberKeys.has(t.tgt))
  console.log(`\n${repoName}: ${parsed} files parsed, ${rows.length} UNNAMED extension(s) published`)
  console.log(`  not identifier-shaped (members can never be matched by any key): ${notIdentifier}`)
  console.log(`  COLLIDING with a real declaration in the same project: ${[...collisions.values()].reduce((a, r) => a + r.length, 0)}`)
  for (const [name, list] of [...collisions.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8)) {
    const kinds = [...(published.get(name) ?? [])].join("|")
    console.log(`     "${name}" (published here as ${kinds})  x${list.length}`)
    for (const r of list.slice(0, 3)) console.log(`        ${r.file}  →  extension on ${r.target}  members: ${r.members.slice(0, 5).join(", ")}`)
  }
  const sharedNames = [...shared.entries()].filter(([, l]) => l.length > 1)
  console.log(`  SHARING their synthesized name with another unnamed extension: ${sharedNames.reduce((a, [, l]) => a + l.length, 0)}`)
  for (const [name, list] of sharedNames.sort((a, b) => b[1].length - a[1].length).slice(0, 5)) {
    console.log(`     "${name}"  x${list.length}`)
    for (const r of list.slice(0, 3)) console.log(`        ${r.file}  →  extension on ${r.target}`)
  }
  console.log(`  edges naming one of these extensions' members (the rename's cost): ${dependent.length}`)
  for (const d of dependent.slice(0, 5)) console.log(`     ${d.type} ${d.src} -> ${d.tgt}   [${d.file}]`)
}
