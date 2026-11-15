/**
 * companion-divergence — do the ORACLE's member closure and the ANALYZER's agree?
 *
 * ## The question this exists to settle
 *
 * `dart-missing-index-scope-ab.txt` measured, on a PINNED 120-file draw, that growing
 * the project index from 4,465 to 13,940 types makes the ORACLE derive 79 new truth
 * rows and covers NONE of them, while the analyzer's published edge count does not
 * move by one. The analyzer is handed the index (differential.ts:22092), so
 * "the index never reached it" is excluded by measurement.
 *
 * The next structural possibility is that the index reached it and the two sides read
 * DIFFERENT closures out of it:
 *
 *   ORACLE     gets `projectIndex.__closedMembers`  (differential.ts:21925)
 *   ANALYZER   builds its own, `dartCompanionFor()`, from
 *              `projectIndex.typeMembers` + `typeMembers`/`typeBases`
 *              (real-dart-analyzer.ts:273-293)
 *
 * Two constructions of "the members this type exposes", one object, two answers. If
 * they differ on any type, every `overrides` edge whose base is that type is derived
 * on one side and not the other — which is exactly the 79-row shape, and it is a
 * defect in a file this lane OWNS.
 *
 * ## What is measured
 *
 * For every type in the index, whether `companionExposes(t, m)` agrees with
 * `closedMembers.get(t)?.has(m)`, over every member named in EITHER closure. Types
 * where the two disagree are named with the members that differ.
 *
 * `GpsData.props -> Equatable.props` is the probe case, because `props` is NOT one of
 * Object's five own members, so the deliberate `Object` retarget
 * (real-dart-analyzer.ts:1602-1620) cannot explain it. `Equatable` declares
 * `List<Object?> get props => const [];` in the pub cache, and proxicall's
 * `.dart_tool/package_config.json` pins it to a version on disk.
 *
 * ## What a non-zero disagreement means and does not mean
 *
 * It means the analyzer's Pass 2 cannot see a member the oracle's Pass 2 does see, so
 * the analyzer falls through to Pass 3 or publishes nothing. It does NOT by itself
 * prove a wrong EDGE: the analyzer's fallback is separately gated on `@override` and
 * separately refuted against the index, and this probe does not exercise either.
 *
 * Population: the pinned dependency set the differential indexed for proxicall under
 * `--dart-deps=direct` — 68 direct dependencies' lib/ trees, plus the Dart SDK's own
 * lib/. The file list is DISCOVERED by this probe from the pub cache and the SDK, not
 * handed to it, and its size is printed so the population is never implicit.
 *
 * Run: npx tsx validation/m14/fixtures/dart/companion-divergence.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const PUB = path.join(process.env.HOME ?? "/root", ".pub-cache", "hosted", "pub.dev")
const SDK_LIB = "/home/ishaq2321/bb_tests/repositories/dart-sdk/sdk/lib"

const walk = (dir: string, out: string[] = []): string[] => {
  let es: fs.Dirent[]
  try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of es) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== ".dart_tool") walk(p, out) }
    else if (e.name.endsWith(".dart")) out.push(p)
  }
  return out
}

/** The ANALYZER's construction, transcribed from real-dart-analyzer.ts:273-293. */
const analyzerClosure = (index: any): Map<string, Set<string>> => {
  if (!index?.typeMembers) return new Map()
  const out = new Map<string, Set<string>>()
  const closure = (t: string, seen: Set<string>): Set<string> => {
    const cached = out.get(t)
    if (cached) return cached
    if (seen.has(t)) return new Set<string>()
    seen.add(t)
    const members = new Set<string>(index.typeMembers.get(t) ?? [])
    for (const b of index.typeBases?.get(t) ?? []) for (const m of closure(b, seen)) members.add(m)
    out.set(t, members)
    return members
  }
  for (const t of index.typeKinds?.keys() ?? []) closure(t, new Set())
  return out
}

const main = async (): Promise<void> => {
  console.log("# companion-divergence — oracle __closedMembers vs analyzer dartCompanionFor\n")

  const files: string[] = []
  const pkgs = fs.existsSync(PUB) ? fs.readdirSync(PUB).filter((d) => d.includes("-")).sort() : []
  // One version per package name: the pub cache holds both equatable-2.0.8 and
  // 2.1.0 and picking arbitrarily would make the population a coin toss. Sorted
  // first-wins, and the choice is printed.
  const byName = new Map<string, string>()
  for (const p of pkgs) {
    const at = p.lastIndexOf("-")
    const name = p.slice(0, at)
    if (!byName.has(name)) byName.set(name, p)
  }
  let pkgFiles = 0
  for (const p of byName.values()) {
    const n = walk(path.join(PUB, p, "lib"))
    pkgFiles += n.length
    files.push(...n)
  }
  const sdkFiles = walk(SDK_LIB)
  files.push(...sdkFiles)
  console.log(`pub-cache packages: ${byName.size} (one version each, sorted first-wins)`)
  console.log(`  dart files: ${pkgFiles} from lib/ trees, ${sdkFiles.length} from ${SDK_LIB}`)
  console.log(`  TOTAL population: ${files.length} files\n`)

  const mod: any = await import("../../../../src/ast/project-index")
  const index = await mod.buildProjectIndexStreaming(
    path.join(ROOT, "wasm", "tree-sitter-dart.wasm"), files, mod.DART_DECLARATION_SPEC,
  )
  mod.buildResolutionTables(index)

  const an = analyzerClosure(index)
  const closed: Map<string, Set<string>> = index.__closedMembers ?? new Map()
  const types = index.typeKinds?.keys() ?? []
  const allTypes = [...types]
  console.log(`types in index: ${allTypes.length}`)
  console.log(`analyzer closure entries: ${an.size}`)
  console.log(`oracle __closedMembers entries: ${closed.size}\n`)

  let compared = 0
  let agree = 0
  const diffs: { t: string; onlyOracle: string[]; onlyAnalyzer: string[] }[] = []

  for (const t of allTypes) {
    const a = an.get(t) ?? new Set<string>()
    const c = closed.get(t) ?? new Set<string>()
    if (a.size === 0 && c.size === 0) continue
    // Compare over the UNION, so a member present in one and absent in the other is
    // visible from either direction.
    const union = new Set<string>([...a, ...c])
    const onlyO: string[] = []
    const onlyA: string[] = []
    for (const m of union) {
      compared++
      const ha = a.has(m)
      const hc = c.has(m)
      if (ha === hc) agree++
      else if (hc) onlyO.push(m)
      else onlyA.push(m)
    }
    if (onlyO.length || onlyA.length) diffs.push({ t, onlyOracle: onlyO, onlyAnalyzer: onlyA })
  }

  console.log(`member comparisons: ${compared}`)
  console.log(`  agree: ${agree} (${((agree / Math.max(1, compared)) * 100).toFixed(2)}%)`)
  console.log(`  DISAGREE: ${compared - agree} across ${diffs.length} type(s)\n`)

  if (diffs.length === 0) {
    console.log("The two constructions agree on every member of every type. So the 79 uncovered")
    console.log("rows are NOT a closure-construction divergence, and the cause lies elsewhere.")
  } else {
    console.log("TYPES WHERE THE TWO CLOSURES DISAGREE (first 40):")
    for (const d of diffs.slice(0, 40)) {
      const o = d.onlyOracle.length ? `oracle-only[${d.onlyOracle.slice(0, 6).join(",")}${d.onlyOracle.length > 6 ? ",…" : ""}]` : ""
      const a = d.onlyAnalyzer.length ? `analyzer-only[${d.onlyAnalyzer.slice(0, 6).join(",")}${d.onlyAnalyzer.length > 6 ? ",…" : ""}]` : ""
      console.log(`  ${d.t}: ${o} ${a}`)
    }
    if (diffs.length > 40) console.log(`  … and ${diffs.length - 40} more`)
  }

  // The named probe case, printed whatever the aggregate says.
  console.log("\n## PROBE CASE: does the analyzer's closure expose Equatable.props?")
  for (const t of ["Equatable", "GpsData", "Object"]) {
    const a = an.get(t)
    const c = closed.get(t)
    console.log(`  ${t}`)
    console.log(`    analyzer closure: ${a ? `${a.size} members, has props = ${a.has("props")}` : "ABSENT"}`)
    console.log(`    oracle  closure: ${c ? `${c.size} members, has props = ${c.has("props")}` : "ABSENT"}`)
  }
  console.log(`\n  index.typeMembers.get("Equatable") = ${JSON.stringify([...(index.typeMembers?.get("Equatable") ?? [])].slice(0, 20))}`)
  console.log(`  index.typeBases?.get("Equatable")   = ${JSON.stringify(index.typeBases?.get("Equatable") ?? [])}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})