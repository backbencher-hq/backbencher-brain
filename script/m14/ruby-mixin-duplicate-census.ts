/**
 * THE MIXIN ROW DUPLICATION CENSUS — a qualified mixin target publishes TWO rows.
 *
 * ⇒ WHAT THE ROWS SHOWED. `extend(self::DefinitionMethods)` is published as
 * `DefinitionMethods mixes_in DefinitionMethods` TWICE. The argument is a `scope_resolution` node
 * (`self::DefinitionMethods`), and the mixes_in branch accepts BOTH `constant` and `scope_resolution`
 * — and the `scope_resolution`'s own child IS a `constant` (`DefinitionMethods`). **⇒ BOTH the
 * scope_resolution node AND its constant child are visited, and each publishes a row whose target is
 * the same leaf.**
 *
 * ⇒ THE MEASUREMENT. Over the whole admitted population: how many published `mixes_in` rows are
 * duplicated in this way — same source, same target, same keyword, more than once in the same file?
 *
 * EXIT CODE: 0 when the census runs; the counts are the answer either way.
 */
import { parseFile } from "../../src/ast/pool-worker"
import { getParser } from "../../src/ast/engine"
import { readFileSync, statSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? path.resolve(process.cwd(), ".corpus")
const MAX_BYTES = 1024 * 1024

const files: string[] = []
{
  let entries: string[] = []
  try { entries = readdirSync(CR) } catch { entries = [] }
  const seen = new Set<string>()
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[] = []
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    for (const rel of tracked) {
      if (!rel.endsWith(".rb")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
      if (seen.has(abs)) continue
      seen.add(abs)
      files.push(abs)
    }
  }
}

const keyOf = (r: any) => `${r.source}|${r.target}|${(r.metadata as any)?.mixinType}`
let total = 0
let parseFailures = 0
const dupFiles: { file: string; key: string; published: number; callSites: number }[] = []
let dupRows = 0
let genuineRepeatedSites = 0
let duplicatedByOneSite = 0
const perKeyword: Record<string, { rows: number; dupRows: number }> = {}

const parser = await getParser("ruby" as any)

/**
 * THE CALL SITES PER (file, keyword, target leaf). ⇒ THE DISCRIMINATOR BETWEEN "ONE SITE PUBLISHED
 * TWICE" AND "TWO GENUINE SITES OF THE SAME EDGE". A repeated edge is NOT automatically a defect: two
 * `include Foo` calls in one class are two facts about the class, and the campaign's own tie-break
 * doctrine (L-2026-10-21-03) is that movement is counted PER ROW, never as a difference of totals.
 * ⇒ SO THE COUNT IS: publishedRows − callSites, PER (file, keyword, target). A positive difference is
 * a duplication; zero is a genuine repeat.
 */
const callSitesBy = new Map<string, number>()
for (const abs of files) {
  const content = readFileSync(abs, "utf8")
  let root: any
  // ⇒ THE ROOT IS CHECKED, NOT ASSUMED: `parse()` returns `Tree | null`, and a null root is not a
  // file with no call sites — it is a file this census did not read. It is COUNTED, never cast.
  try { root = parser.parse(content)?.rootNode } catch { parseFailures++; continue }
  if (!root) { parseFailures++; continue }
  const rel = path.relative(CR, abs)
  const walk = (n: any) => {
    if (n.type === "call") {
      // ⇒ THE METHOD NODE IS THE ONE THE FIELD NAMES. `n.namedChild(0)` is the RECEIVER for a
      // receivered call (`cls.extend(X)` ⇒ children [identifier "cls", identifier "extend",
      // argument_list]), so reading namedChild(0) as the method name reads "cls" as the keyword and
      // SKIPS EVERY RECEIVERED CALL. The analyzer uses `childForFieldName("method")` and is right;
      // this census was wrong, and it is why its first run reported IMPOSTOR A = 0.
      const m = n.childForFieldName ? n.childForFieldName("method") : n.namedChild(0)
      const kw = m ? m.text : ""
      if (kw === "include" || kw === "extend" || kw === "prepend") {
        const args = n.namedChild(n.namedChildCount - 1)
        if (args && args.type === "argument_list") {
          for (let i = 0; i < args.namedChildCount; i++) {
            const a = args.namedChild(i)
            if (a && (a.type === "constant" || a.type === "scope_resolution")) {
              const leaf = (a.text.split(/[.:#]/).pop() ?? "").trim()
              const k = `${rel}|${kw}|${leaf}`
              callSitesBy.set(k, (callSitesBy.get(k) ?? 0) + 1)
            }
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(root)
}

for (const abs of files) {
  const res = await parseFile(abs, "ruby" as any)
  const rel = path.relative(CR, abs)
  const byKey = new Map<string, number>()
  for (const r of (res.relationships ?? []) as any[]) {
    if (r.type !== "mixes_in") continue
    total++
    const k = keyOf(r)
    byKey.set(k, (byKey.get(k) ?? 0) + 1)
    const kw = String((r.metadata as any)?.mixinType ?? "?")
    perKeyword[kw] ??= { rows: 0, dupRows: 0 }
    perKeyword[kw].rows++
  }
  for (const [k, c] of byKey) {
    if (c <= 1) continue
    const [source, target, kw] = k.split("|")
    const sites = callSitesBy.get(`${rel}|${kw}|${target}`) ?? 0
    const excess = c - sites
    dupRows += c
    if (excess > 0) { duplicatedByOneSite += excess; perKeyword[kw].dupRows += excess }
    else genuineRepeatedSites += c
    dupFiles.push({ file: rel, key: k, published: c, callSites: sites })
  }
}

const report = {
  population: { corpusRoot: CR, admitted: files.length },
  publishedMixesInRows: total,
  distinctSourceTargetKeywordTriples: total - dupRows + (dupFiles.length),
  rowsThatAreDuplicates: dupRows,
  duplicateGroups: dupFiles.length,
  rowsDuplicatedByOneSite: duplicatedByOneSite,
  rowsThatAreGenuineRepeatedSites: genuineRepeatedSites,
  perKeyword,
  examples: dupFiles.slice(0, 12),
  theDefect:
    "A mixin target written as a QUALIFIED name (`self::DefinitionMethods`, `Foo::Bar`) is a `scope_resolution` node whose own child is a `constant`. The mixes_in branch accepts BOTH shapes, so BOTH nodes publish a row with the same leaf target — the same edge, twice.",
  instrument: "script/m14/ruby-mixin-duplicate-census.ts",
}
mkdirSync(path.join(CR, "..", "validation", "m14", "measurements"), { recursive: true })
writeFileSync(path.join(CR, "..", "validation", "m14", "measurements", "ruby-mixin-duplicate-census-2026-10-21.json"), JSON.stringify(report, null, 2) + "\n")
console.log("RUBY mixes_in — THE ROW DUPLICATION CENSUS")
console.log(`  population ${files.length} · published mixes_in rows ${total}`)
console.log(`  files NOT READ (no root node): ${parseFailures} — declared, never counted as a file with no call sites`)
console.log(`  duplicate groups: ${dupFiles.length} · rows inside them: ${dupRows}`)
console.log(`  ⇒ rows DUPLICATED BY ONE SITE: ${duplicatedByOneSite}   · rows that are GENUINE repeated sites: ${genuineRepeatedSites}`)
console.log(`  per keyword: ${JSON.stringify(perKeyword)}`)
for (const e of dupFiles.slice(0, 10)) console.log(`      ${e.file}  ${e.key}  published x${e.published}  call sites ${e.callSites}`)
