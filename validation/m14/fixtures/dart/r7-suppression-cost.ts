/**
 * What M60 rule R7's filter costs, measured now that its stated premise is false.
 *
 * The filter is one term at `src/ast/real-dart-analyzer.ts:663`: drop any row
 * whose source or target is the literal string `unknown`. Its header justified
 * that with a measurement — "`symbolsNamedUnknown 0` in both AFTER runs: no
 * sampled file publishes a symbol named `unknown`, because
 * `src/ast/pool-worker.ts` `keepSymbol`'s UNIVERSAL denylist rejects the name for
 * every language. So every one of those rows was an endpoint NOTHING COULD BIND."
 *
 * Two things moved under that sentence and neither is this analyzer's code:
 *
 *   1. `src/ast/pool-worker.ts` split the denylist. Names reserved in only SOME
 *      languages left the unconditional drop list, and `unknown` is a legal Dart
 *      identifier, so Dart declarations carrying it are now PUBLISHED. This lane
 *      measures that at `symbolsNamedUnknown 74` over 4,788 files.
 *   2. So the filter's name test no longer separates "a fallback that had nothing
 *      truthful to say and wrote the pipeline's sentinel" from "a Dart declaration
 *      literally named `unknown`". It drops both.
 *
 * The differential found this without being told: at rotation 81 the truth
 * derivation published `contains AppLocalizationsBn -> unknown`
 * (`proxicall/lib/l10n/generated/app_localizations_bn.dart:304`, `String get unknown
 * => '...'`), the analyzer published the SYMBOL for it and no EDGE, and the row
 * landed in MISSING. That is a true edge suppressed by a criterion, which is the
 * one trade the honesty contract does not allow to be silent.
 *
 * This probe sizes the population. For every sampled file it compares the member
 * symbols `parseFile` PUBLISHED against the `contains` edges it published, and
 * files the difference by the missing target's name. A member symbol with no
 * `contains` edge is a suppressed edge; the name says which filter did it.
 *
 * There is no regex here: the comparison is over the published symbol and
 * relationship rows, which is the same surface every other figure in this lane
 * reads. No tree walk is needed to answer the question, because `contains` is
 * emitted FROM the member symbol — so a member with no edge is exactly a
 * suppression, and the name partitions the cause.
 *
 *   BB_DART_CONC=1 npx tsx validation/m14/fixtures/dart/r7-suppression-cost.ts
 *   BB_DART_PER_REPO=40 npx tsx ...   # smaller draw, same shape
 */
import { readdirSync, statSync } from "node:fs"
import path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const PER_REPO = Number(process.env.BB_DART_PER_REPO ?? 600)
const REPOS = (process.env.BB_DART_REPOS ?? "proxicall,riverpod,flutter-packages,dart-sdk,dart-http").split(",").map(s => s.trim()).filter(Boolean)
const CONCURRENCY = Number(process.env.BB_DART_CONC ?? 1)

const relType = (r: any): string => String(r?.type ?? r?.relationshipType ?? "")

async function main() {
  const files: { abs: string; repo: string; rel: string }[] = []
  for (const repo of REPOS) {
    let tracked: string[] = []
    try {
      tracked = (await import("node:child_process")).execFileSync("git", ["ls-files", "*.dart"], {
        cwd: path.join(CR, repo),
        encoding: "utf8",
        maxBuffer: 1 << 28,
      }).split("\n").filter(Boolean)
    } catch {
      console.log(`  ${repo}: no git ls-files, skipped`)
      continue
    }
    // FLOOR, matching `census.ts`'s stride exactly. An earlier revision of this
    // file used `Math.ceil`, which drew 2,531 files where the census draws 2,735
    // (riverpod: 432 vs 600) — so two instruments both describing "the census
    // sample" were sampling different file sets and their per-file rates were not
    // comparable. Same method, same files, comparable numbers.
    const stride = Math.max(1, Math.floor(tracked.length / PER_REPO))
    let drawn = 0
    for (let i = 0; i < tracked.length && drawn < PER_REPO; i += stride) {
      files.push({ abs: path.join(CR, repo, tracked[i]), repo, rel: `${repo}/${tracked[i]}` })
      drawn++
    }
  }

  // name -> how many member symbols carry it but publish no `contains` edge
  const missingByName = new Map<string, number>()
  const exampleByName = new Map<string, string[]>()
  const ownerByName = new Map<string, Set<string>>()
  let memberSymbols = 0
  let containsEdges = 0
  let filesWithUnknownSymbol = 0
  let filesParsed = 0
  let parseFailures = 0
  let unknownNamedSymbols = 0
  const symbolOwners = new Map<string, Set<string>>()

  const handle = async (f: { abs: string; repo: string; rel: string }) => {
    let st: any
    try {
      st = statSync(f.abs)
    } catch {
      return
    }
    if (!st.isFile() || st.size > 1024 * 1024) return
    let r: any
    try {
      r = await parseFile(f.abs, path.join(CR, f.repo))
    } catch {
      parseFailures++
      return
    }
    filesParsed++
    const syms: any[] = r?.symbols ?? []
    const rels: any[] = r?.relationships ?? []

    for (const s of syms) {
      if (s?.name === "unknown") {
        unknownNamedSymbols++
        if (s.ownerName) {
          const set = symbolOwners.get(s.ownerName) ?? new Set<string>()
          set.add("unknown")
          symbolOwners.set(s.ownerName, set)
        }
      }
    }
    const hasUnknown = syms.some((s: any) => s?.name === "unknown")
    if (hasUnknown) filesWithUnknownSymbol++

    // one `contains` edge per (owner, member) — a Set, because the analyzer may
    // publish the same pair for a field and its accessor at different confidences.
    // The pair is joined on U+0000, which no Dart identifier can contain, so a
    // member whose NAME is `unknown` still keys on a pair distinct from a
    // fallback that merely wrote the sentinel.
    const contained = new Set<string>()
    for (const e of rels) {
      if (relType(e) !== "contains") continue
      containsEdges++
      contained.add(`${e.source ?? e.from}\u0000${e.target ?? e.to}`)
    }
    // A member is a published symbol with an owner. Counting members and
    // comparing against the edge set is what turns "no edge" into "suppressed".
    //
    // NOTE, and it is the reason an earlier revision of this file was WRONG:
    // excluding `enum_member` and `property` here looks like tidying and is in
    // fact fatal. Every `unknown` member in the corpus is one of those two kinds,
    // so excluding them deleted precisely the rows that carry the R7 finding and
    // made that finding read 0 on a sample where it is not 0. A measurement whose
    // filter removes the effect it is looking for is not a measurement. All
    // owned non-local kinds are counted; the NAME partitions the cause.
    for (const s of syms) {
      if (!s?.ownerName || !s?.name) continue
      // only container-level ownership produces `contains`; skip a symbol whose
      // owner is itself a member scope (a local, a parameter)
      if (s.kind === "variable" || s.kind === "parameter") continue
      memberSymbols++
      const key = `${s.ownerName}\u0000${s.name}`
      if (contained.has(key)) continue
      missingByName.set(s.name, (missingByName.get(s.name) ?? 0) + 1)
      const ex = exampleByName.get(s.name) ?? []
      if (ex.length < 3) {
        ex.push(`${f.rel}: ${s.ownerName} -> ${s.name} (kind=${s.kind})`)
        exampleByName.set(s.name, ex)
      }
      const ow = ownerByName.get(s.name) ?? new Set<string>()
      ow.add(String(s.ownerName))
      ownerByName.set(s.name, ow)
    }
  }

  const t0 = Date.now()
  if (CONCURRENCY <= 1) {
    for (const f of files) await handle(f)
  } else {
    let i = 0
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (i < files.length) await handle(files[i++])
    })
    await Promise.all(workers)
  }

  console.log(`r7-suppression-cost — ${filesParsed} files parsed of ${files.length} drawn`)
  console.log(`  concurrency ${CONCURRENCY}  wallMs ${Date.now() - t0}  parseFailures ${parseFailures}`)
  console.log(`  member symbols with an owner ${memberSymbols}   contains edges ${containsEdges}`)
  console.log(`  files publishing a symbol named "unknown" ${filesWithUnknownSymbol}   such symbols ${unknownNamedSymbols}`)
  console.log(`  distinct owner/member pairs published as a symbol but carrying NO contains edge:`)
  const rows = [...missingByName.entries()].sort((a, b) => b[1] - a[1])
  if (rows.length === 0) {
    console.log(`    (none)`)
  } else {
    for (const [name, n] of rows.slice(0, 25)) {
      const owners = [...(ownerByName.get(name) ?? [])]
      console.log(`    ${String(n).padStart(6)}  ${name}   owners: ${owners.slice(0, 4).join(", ")}${owners.length > 4 ? ` (+${owners.length - 4} more)` : ""}`)
      for (const e of exampleByName.get(name) ?? []) console.log(`              ${e}`)
    }
    console.log(`    distinct missing names ${rows.length}   total suppressed pairs ${rows.reduce((a, b) => a + b[1], 0)}`)
    const unknownRows = missingByName.get("unknown") ?? 0
    console.log(`  OF WHICH the literal "unknown": ${unknownRows} suppressed pairs — the R7 filter's own doing.`)
    // Partition by character, not by a pattern. The question is "does this name
    // contain an angle bracket", and `includes` asks it directly; a regex here
    // would be the lane's only one and the lane's regex census holds it at 0.
    const angleTotal = rows
      .filter(([n]) => n.startsWith("operator ") && (n.includes("<") || n.includes(">")))
      .reduce((a, [, c]) => a + c, 0)
    console.log(`  OF WHICH angle-bracket operator members: ${angleTotal} suppressed pairs — filterNoiseRelationships' leaf ban, not this analyzer.`)
    console.log(`  Residual after both named causes: ${rows.reduce((a, b) => a + b[1], 0) - unknownRows - angleTotal} pairs.`)
  }
}

await main()