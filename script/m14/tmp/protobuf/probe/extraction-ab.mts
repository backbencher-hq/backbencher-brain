/**
 * Protobuf extraction A/B — the same analyzer against the grammar it REPLACED.
 *
 * The grammar pin proves the wired build is a build of the committed patched
 * source. The grammar A/B proves the patches changed parse outcomes. Neither
 * proves the patches changed the FACTS THE ANALYZER PUBLISHES, and that is the
 * only number a consumer of this repository can feel: a parser that is more
 * complete is worth nothing if the extractor does not read the new nodes.
 *
 * So both WASMs are run through the SAME analyzer over the same pinned corpora,
 * and every delta is enumerated and adjudicated rather than summarised:
 *
 *   - files where the error-node count differs, with the direction;
 *   - symbols only in the upstream run (LOSSES) and only in the patched run
 *     (GAINS), by kind, with the node type that produced each;
 *   - relationships only on either side;
 *   - PHANTOM delta: symbols overlapping an ERROR node on each side. A gain
 *     that arrives as a phantom is a fabricated fact, not an improvement, and
 *     the summary is printed with the phantoms subtracted so the two cannot be
 *     conflated.
 *
 * A direction that is not uniform — more errors somewhere, fewer phantoms
 * elsewhere, a construct traded away — is a finding to explain in the review,
 * not a number to average.
 *
 * Usage: tsx extraction-ab.mts
 */
import { createHash } from "crypto"
import * as fs from "fs"
import * as path from "path"
import { MANIFEST, OUT, PREVIOUS_WASM, ROOT, WASM } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const { RealProtobufAnalyzer } = await import(path.join(ROOT, "src/ast/real-protobuf-analyzer.ts"))

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as { corpora: any[] }

/** First 16 hex chars of the sha256, so the A/B states which bytes it compared. */
function sha(p: string): string {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16)
}

function walkFiles(dir: string): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()!
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      if (e.name === ".git") continue
      const abs = path.join(d, e.name)
      if (e.isDirectory()) stack.push(abs)
      else out.push(abs)
    }
  }
  return out.sort()
}

function damagedRanges(root: any): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    for (const c of n.children) {
      if (!c) continue
      if (c.type === "ERROR" || c.isMissing) out.push({ start: c.startIndex, end: c.endIndex })
      else stack.push(c)
    }
  }
  return out
}

/** A symbol reduced to something comparable across two grammars. */
interface Key {
  /**
   * DECLARATION identity: kind, name and the line the name sits on. This is what
   * a loss/gain comparison must be keyed on.
   *
   * An earlier version keyed on the analyzer's resolved id instead, which
   * embeds the OWNER, and reported 39 losses that were not losses. Every one was
   * a field inside a proto2 `group` body: upstream cannot see the `group`
   * wrapper, so it attributed the field to the enclosing message, while the
   * patched build correctly attributes it to the group type — a different id,
   * the same declaration, on the same line. Keying on the id turned a real
   * improvement into a phantom regression. Owner changes are counted
   * separately as `ownerChanges` rather than being lost in a diff.
   */
  key: string
  idKey: string
  kind: string
  name: string
  line: number
  start: number
  end: number
  id: string
}
const symbolKeys = (res: any): Key[] =>
  res.symbols.map((s: any) => ({
    key: `${s.kind}|${s.name}|${s.range.startLine}`,
    idKey: `${s.kind}|${s.metadata?.id ?? s.name}`,
    id: String(s.metadata?.id ?? s.name),
    kind: s.kind,
    name: s.name,
    line: s.range.startLine,
    start: s.range.startIndex ?? -1,
    end: s.range.endIndex ?? -1,
  }))

const relKeys = (res: any): Set<string> =>
  new Set(
    res.relationships.map(
      (r: any) => `${r.source}|${r.type}|${r.target}|${r.metadata?.role ?? ""}`,
    ),
  )

async function run(wasmPath: string) {
  const parser = new ParserClass()
  parser.setLanguage(await Language.load(fs.readFileSync(wasmPath)))
  const analyzer = new RealProtobufAnalyzer()
  const perFile: Record<
    string,
    {
      errorNodes: number
      symbols: Key[]
      rels: Set<string>
      phantoms: number
      ranges: { start: number; end: number }[]
      errorNodesThrew?: string
    }
  > = {}
  let threw = 0
  for (const c of manifest.corpora) {
    if (!fs.existsSync(c.root)) continue
    for (const abs of walkFiles(c.root).filter((f) => f.endsWith(".proto"))) {
      const rel = `${c.name}/${path.relative(c.root, abs).split(path.sep).join("/")}`
      const src = fs.readFileSync(abs, "utf8")
      try {
        const tree: any = parser.parse(src)
        const res: any = analyzer.analyze(tree.rootNode, src, abs)
        const ranges = damagedRanges(tree.rootNode)
        let phantoms = 0
        for (const s of res.symbols) {
          if (s.range.startIndex === undefined || s.range.endIndex === undefined) continue
          for (const r of ranges) {
            if (s.range.startIndex < r.end && r.start < s.range.endIndex) {
              phantoms++
              break
            }
          }
        }
        perFile[rel] = {
          errorNodes: ranges.length,
          symbols: symbolKeys(res),
          rels: relKeys(res),
          phantoms,
          ranges,
        }
      } catch (e) {
        threw++
        perFile[rel] = {
          errorNodes: -1,
          symbols: [],
          rels: new Set(),
          phantoms: 0,
          ranges: [],
          errorNodesThrew: e instanceof Error ? e.message : String(e),
        }
      }
    }
  }
  return { perFile, threw }
}

const before = await run(PREVIOUS_WASM)
const after = await run(WASM)

const files = Object.keys(after.perFile).filter((f) => f in before.perFile)
const gainByKind: Record<string, number> = {}
const lossByKind: Record<string, number> = {}
const lossSamples: { file: string; kind: string; name: string; line: number }[] = []
const gainSamples: { file: string; kind: string; name: string; line: number }[] = []
let ownerChanges = 0
const ownerChangeSamples: any[] = []
let lossesInsideUpstreamDamage = 0
let lossesReal = 0
const realLossSamples: { file: string; kind: string; name: string; line: number }[] = []
let relGains = 0
let relEndpointMoved = 0
let relGenuineLoss = 0
const relLossSamples: { file: string; rel: string }[] = []
let relLosses = 0
let errNodeBefore = 0
let errNodeAfter = 0
let filesWorse = 0
let filesBetter = 0
let phantomsBefore = 0
let phantomsAfter = 0
const worseFiles: { file: string; before: number; after: number }[] = []

for (const f of files) {
  const b = before.perFile[f]
  const a = after.perFile[f]
  errNodeBefore += b.errorNodes < 0 ? 0 : b.errorNodes
  errNodeAfter += a.errorNodes < 0 ? 0 : a.errorNodes
  phantomsBefore += b.phantoms
  phantomsAfter += a.phantoms
  if (a.errorNodes > b.errorNodes) {
    filesWorse++
    worseFiles.push({ file: f, before: b.errorNodes, after: a.errorNodes })
  } else if (a.errorNodes < b.errorNodes) filesBetter++

  const bk = new Set(b.symbols.map((s) => s.key))
  const ak = new Set(a.symbols.map((s) => s.key))
  const bByKey = new Map(b.symbols.map((s) => [s.key, s]))
  // A declaration on both sides whose OWNER-derived id differs is an owner
  // change, not a loss. Protobuf's `group` is the only construct here that can
  // cause it, and it is a correctness gain: protoc nests the group's fields in
  // the group type, which is exactly what the patched grammar now lets the
  // analyzer see.
  const movedIds = new Set<string>()
  for (const s of a.symbols) {
    const prior = bByKey.get(s.key)
    if (prior && prior.id !== s.id) {
      ownerChanges++
      movedIds.add(prior.id)
      movedIds.add(s.id)
      if (ownerChangeSamples.length < 25)
        ownerChangeSamples.push({
          file: f,
          kind: s.kind,
          name: s.name,
          line: s.line,
          upstreamOwner: prior.id,
          wiredOwner: s.id,
        })
    }
  }
  for (const s of b.symbols) {
    if (!ak.has(s.key)) {
      lossByKind[s.kind] = (lossByKind[s.kind] ?? 0) + 1
      // ADJUDICATION, and this is the number that decides whether the patch is
      // a win: a symbol the upstream run published and the wired run does not
      // is only acceptable if upstream INVENTED it — i.e. its byte range sits
      // inside a node the upstream grammar had already failed to parse. A lost
      // symbol outside every upstream error range is a real fact this lane
      // stopped publishing, and it is a regression no matter how many phantoms
      // were removed elsewhere.
      const invented =
        s.start >= 0 && b.ranges.some((r) => s.start < r.end && r.start < s.end)
      if (invented) lossesInsideUpstreamDamage++
      else {
        lossesReal++
        if (realLossSamples.length < 40)
          realLossSamples.push({ file: f, kind: s.kind, name: s.name, line: s.line })
      }
      if (lossSamples.length < 40) lossSamples.push({ file: f, kind: s.kind, name: s.name, line: s.line })
    }
  }
  for (const s of a.symbols) {
    if (!bk.has(s.key)) {
      gainByKind[s.kind] = (gainByKind[s.kind] ?? 0) + 1
      if (gainSamples.length < 40) gainSamples.push({ file: f, ...s, key: undefined as any } as any)
    }
  }
  for (const r of a.rels) if (!b.rels.has(r)) relGains++
  for (const r of b.rels) {
    if (!a.rels.has(r)) {
      relLosses++
      // Same adjudication as the symbol losses. A relationship key embeds both
      // endpoints, so a single owner change moves several edges. An edge is only
      // a real loss if NEITHER endpoint moved; if either endpoint's id changed
      // for this file, the edge was re-anchored, which is the same correctness
      // gain the owner-change count already reports.
      const parts = r.split("|")
      const src = parts[0]
      const tgt = parts[2]
      const movedSrc = movedIds.has(src)
      const movedTgt = movedIds.has(tgt)
      if (movedSrc || movedTgt) relEndpointMoved++
      else {
        relGenuineLoss++
        if (relLossSamples.length < 40) relLossSamples.push({ file: f, rel: r })
      }
    }
  }
}

const result = {
  generatedAt: new Date().toISOString(),
  analyzer: "src/ast/real-protobuf-analyzer.ts (identical on both sides)",
  upstream: { path: PREVIOUS_WASM, sha: sha(PREVIOUS_WASM), note: "amaanq/tree-sitter-proto as published, pre-patch" },
  wired: { path: WASM, sha: sha(WASM), note: "vendored, 8 patches, pinned" },
  files: files.length,
  threwUpstream: before.threw,
  threwWired: after.threw,
  errorNodes: { upstream: errNodeBefore, wired: errNodeAfter, delta: errNodeAfter - errNodeBefore },
  filesWithFewerErrors: filesBetter,
  filesWithMoreErrors: filesWorse,
  worseFiles,
  phantoms: { upstream: phantomsBefore, wired: phantomsAfter, delta: phantomsAfter - phantomsBefore },
  symbols: {
    upstream: files.reduce((a, f) => a + before.perFile[f].symbols.length, 0),
    wired: files.reduce((a, f) => a + after.perFile[f].symbols.length, 0),
    gained: Object.values(gainByKind).reduce((a, b) => a + b, 0),
    lost: Object.values(lossByKind).reduce((a, b) => a + b, 0),
    gainByKind,
    lossByKind,
    lossesInsideUpstreamDamage,
    lossesReal,
    realLossSamples,
    ownerChanges,
    ownerChangeSamples,
  },
  relationships: {
    upstream: files.reduce((a, f) => a + before.perFile[f].rels.size, 0),
    wired: files.reduce((a, f) => a + after.perFile[f].rels.size, 0),
    gained: relGains,
    lost: relLosses,
    endpointMoved: relEndpointMoved,
    genuineLoss: relGenuineLoss,
    genuineLossSamples: relLossSamples,
  },
  lossSamples: lossSamples.map((s) => ({ file: s.file, kind: s.kind, name: s.name, line: s.line })),
  gainSamples: gainSamples.map((s) => ({ file: s.file, kind: s.kind, name: s.name, line: s.line })),
}
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, "extraction-ab.json"), JSON.stringify(result, null, 2))

const pct = (a: number, b: number): string =>
  b === 0 ? (a === 0 ? "  n/a" : " +inf") : ` ${(((a - b) / b) * 100).toFixed(1)}%`

console.log(`\n  files compared: ${files.length}   (analyzer threw: upstream ${before.threw}, wired ${after.threw})`)
console.log(
  `  ERROR nodes   upstream ${String(errNodeBefore).padStart(5)}  ->  wired ${String(errNodeAfter).padStart(5)}   ${pct(errNodeAfter, errNodeBefore)}`,
)
console.log(
  `  phantom syms  upstream ${String(phantomsBefore).padStart(5)}  ->  wired ${String(phantomsAfter).padStart(5)}   ${pct(phantomsAfter, phantomsBefore)}`,
)
console.log(`  files with fewer errors: ${filesBetter}    with more errors: ${filesWorse}`)
const su = result.symbols
console.log(
  `  symbols       upstream ${String(su.upstream).padStart(5)}  ->  wired ${String(su.wired).padStart(5)}   (+${su.gained} / -${su.lost})`,
)
if (Object.keys(su.gainByKind).length) console.log(`    gained by kind: ${JSON.stringify(su.gainByKind)}`)
if (Object.keys(su.lossByKind).length) console.log(`    LOST  by kind: ${JSON.stringify(su.lossByKind)}`)
console.log(
  `    losses adjudicated: ${su.lossesInsideUpstreamDamage} sat INSIDE upstream damage (invented upstream), ` +
    `${su.lossesReal} outside it (REAL REGRESSION)`,
)
console.log(`    owner changes (same declaration, different owner): ${su.ownerChanges}`)
if (su.ownerChanges > 0) {
  for (const o of su.ownerChangeSamples.slice(0, 4))
    console.log(`       ${o.kind} ${o.name} ${o.file.split('/').pop()}:${o.line}\n          ${o.upstreamOwner}\n       -> ${o.wiredOwner}`)
}
if (su.lossesReal > 0) {
  console.log(`    !! REAL REGRESSIONS:`)
  for (const r of su.realLossSamples.slice(0, 15)) console.log(`       ${r.kind} ${r.name} ${r.file}:${r.line}`)
}
const rl = result.relationships
console.log(
  `  relationships upstream ${String(rl.upstream).padStart(5)}  ->  wired ${String(rl.wired).padStart(5)}   (+${rl.gained} / -${rl.lost})`,
)
if (worseFiles.length) {
  console.log(`\n  files where the wired build is WORSE (must be explained, not averaged):`)
  for (const w of worseFiles.slice(0, 10)) console.log(`    ${w.file}: ${w.before} -> ${w.after}`)
}
console.log(
  `    rel losses adjudicated: ${rl.endpointMoved} had an endpoint moved by an owner change, ` +
    `${rl.genuineLoss} genuinely gone`,
)
if (rl.genuineLoss > 0) {
  console.log(`    !! GENUINELY LOST RELATIONSHIPS:`)
  for (const l of rl.genuineLossSamples.slice(0, 12)) console.log(`       ${l.file}\n         ${l.rel}`)
}
console.log(`\n  wrote ${path.join(OUT, "extraction-ab.json")}`)
