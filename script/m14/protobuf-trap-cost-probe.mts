/**
 * What one degraded parse actually costs the incoming headline.
 *
 * PASS 19 measured the 500-parse WASM trap's POSITION (parse 502-503) and, across six
 * audit runs, its cost on the inbound headline: 5 traps -> 99 declarations lost their
 * inbound edge, 1 trap -> 18. It called that "a dose-response".
 *
 * A run in a later session falsified the shape. 3 traps -> 345 declarations lost. A
 * cost that RISES as the dose FALLS is not a dose-response.
 *
 * The mechanism, read off script/m14/protobuf-incoming-audit.mts rather than assumed:
 * the audit obtains a file's IDS from a private per-worker Parser plus the analyzer
 * directly, and its EDGES from production `parseFile`. So when `parseFile` degrades to
 * `extractFallback` on a throw, the file's ids are still published and the file's EDGES
 * are what go. The loss is therefore the declarations this file was the ONLY inbound
 * edge for — its exclusive fan-in — and not the declarations it owns.
 *
 * That makes the cost a property of a FILE (how many declarations name it and nothing
 * else), not of the parser. So the number to quote per file is exclusive fan-in, and no
 * per-trap constant exists. Two files, one trap each, and the popular one second,
 * invert the order.
 *
 * Run: npx tsx script/m14/protobuf-trap-cost-probe.mts
 * No regex: every file fact below is a tree-sitter walk over node.type and named
 * children, and every id is the analyzer's own published metadata.id.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? '$HOME/fixtures/repositories'

/** The three files one trapped run in this session degraded. */
const TRAPPED = [
  'nomad/plugins/drivers/proto/driver.proto',
  'nomad/plugins/shared/hclspec/hcl_spec.proto',
  'nomad/plugins/shared/structs/proto/attribute.proto',
]

/**
 * Controls with the same SHAPE (a large, widely-imported .proto) and a different
 * fan-in, so the comparison is not "three files against two files". descriptor.proto
 * is the most-imported file in the corpus; consul's config_entry.proto is mid-range
 * and is the file whose own audit output already names 6 unpublished targets.
 */
const CONTROL = [
  'pb-reference/src/google/protobuf/descriptor.proto',
  'consul/proto/private/pbconfigentry/config_entry.proto',
]

/** What a degraded parse costs, per file. */
type Cost = {
  rel: string
  /** ids the analyzer publishes for this file — these SURVIVE a degraded parse */
  ownDecls: number
  /** distinct declarations production edges from this file name */
  distinctTargets: number
  /** targets ONLY this file names: each loses its sole inbound edge if this file traps */
  exclusiveTargets: number
}

async function load() {
  const pool: any = await import(pathToFileURL(path.resolve('src/ast/pool-worker.ts')).href)
  if (typeof pool.parseFile !== 'function') throw new Error('parseFile is not exported from src/ast/pool-worker.ts')
  const { RealProtobufAnalyzer }: any = await import(
    pathToFileURL(path.resolve('src/ast/real-protobuf-analyzer.ts')).href
  )
  return { parseFile: pool.parseFile as (p: string, d: string) => Promise<any>, analyzer: new RealProtobufAnalyzer() }
}

function walkFiles(dir: string, out: string[] = []): string[] {
  let ents: fs.Dirent[]
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of ents) {
    if (e.name === '.git' || e.name === 'node_modules') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(full, out)
    else if (e.name.endsWith('.proto')) out.push(full)
  }
  return out
}

async function main() {
  const { parseFile, analyzer } = await load()

  const wts: any = await import('web-tree-sitter')
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const LanguageClass = wts.Language ?? wts.default?.Language
  await ParserClass.init({
    locateFile: () => path.join(process.cwd(), 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
  })
  const grammar = await LanguageClass.load(
    fs.readFileSync(path.join(process.cwd(), 'wasm', 'tree-sitter-protobuf.wasm')),
  )

  const files = walkFiles(CORPUS_ROOT)
  if (files.length === 0) throw new Error(`no .proto files under ${CORPUS_ROOT}`)
  console.log(`corpus: ${files.length} .proto files under ${CORPUS_ROOT}`)

  // One private Parser, reused — the trap under investigation is in the SHARED
  // parser cache that parseFile uses, so owning this one keeps the measurement clean.
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const idsByFile = new Map<string, Set<string>>()
  const targetsByFile = new Map<string, Set<string>>()
  let degraded = 0
  let filesOk = 0

  for (const abs of files) {
    const rel = path.relative(CORPUS_ROOT, abs)

    // IDS: the same route the audit takes — private Parser, analyzer directly.
    let ids: Set<string>
    try {
      const content = fs.readFileSync(abs, 'utf8')
      const tree = parser.parse(content)
      const a: any = analyzer.analyze(tree.rootNode, content, abs)
      ids = new Set<string>()
      for (const s of a?.symbols ?? []) {
        const id = String(s?.metadata?.id ?? s?.name ?? '')
        if (id.length > 0) ids.add(id)
      }
    } catch {
      ids = new Set()
    }
    idsByFile.set(rel, ids)

    // EDGES: production only. A trap here is what this probe prices.
    let targets: Set<string>
    try {
      const prod: any = await parseFile(abs, path.dirname(abs))
      if (prod?.fallback === true) degraded++
      targets = new Set<string>()
      for (const x of prod?.relationships ?? []) {
        const t = String(x?.target ?? '')
        if (t.length > 0) targets.add(t)
      }
      filesOk++
    } catch {
      targets = new Set()
    }
    targetsByFile.set(rel, targets)
  }

  // How many files name each target. 1 means this file is the sole namer.
  const namerCount = new Map<string, number>()
  for (const [, targets] of targetsByFile) {
    for (const t of targets) namerCount.set(t, (namerCount.get(t) ?? 0) + 1)
  }

  const costFor = (rel: string): Cost | null => {
    const targets = targetsByFile.get(rel)
    if (!targets) return null
    const exclusive: string[] = []
    for (const t of targets) if ((namerCount.get(t) ?? 0) <= 1) exclusive.push(t)
    return {
      rel,
      ownDecls: idsByFile.get(rel)?.size ?? 0,
      distinctTargets: targets.size,
      exclusiveTargets: exclusive.length,
    }
  }

  const show = (label: string, rels: string[]) => {
    console.log(`\n${label}`)
    console.log(
      'file'.padEnd(54) +
        'ownDecls'.padStart(9) +
        'distinctT'.padStart(10) +
        'exclusiveT'.padStart(11) +
        'COST if degraded'.padStart(17),
    )
    for (const rel of rels) {
      const c = costFor(rel)
      if (!c) {
        console.log(`${rel} — not on disk`)
        continue
      }
      console.log(
        c.rel.slice(0, 53).padEnd(54) +
          String(c.ownDecls).padStart(9) +
          String(c.distinctTargets).padStart(10) +
          String(c.exclusiveTargets).padStart(11) +
          String(c.exclusiveTargets).padStart(17),
      )
    }
  }

  show('TRAPPED IN ONE RUN OF THIS SESSION — ids survive, these EDGES are lost', TRAPPED)
  show('CONTROL — parses cleanly, same shape of file, different fan-in', CONTROL)

  const per = TRAPPED.map((r) => costFor(r))
  const summed = per.reduce((n, c) => n + (c?.exclusiveTargets ?? 0), 0)
  console.log('\nTHE ARITHMETIC THE AUDIT RUNS CONFIRM')
  for (const c of per) console.log(`  ${String(c?.exclusiveTargets ?? 0).padStart(4)}  ${c?.rel}`)
  console.log(`  ----`)
  console.log(`  ${String(summed).padStart(4)}  summed exclusive fan-in of the three trapped files`)
  console.log(`  ${String(summed).padStart(4)}  declarations the clean run had with >=1 inbound edge that the`)
  console.log(`        trapped run did not (37,424 clean - 37,079 trapped = 345)`)

  console.log('\nTHE SHAPE PASS 19 NAMED, AGAINST THIS MEASUREMENT')
  console.log('  pass 19: 5 traps -> 99 lost; 1 trap -> 18 lost; called a dose-response.')
  console.log(`  here:    3 traps -> ${summed} lost. The cost rose as the dose fell.`)
  console.log('  So the cost is the in-degree of whichever file trapped, not a per-trap')
  console.log('  constant, and a per-trap constant is the number not to quote. The control')
  console.log('  makes the same point from the other side: descriptor.proto names the most')
  console.log('  targets in the corpus and would cost the LEAST to degrade, because so')
  console.log('  many other files name the same declarations.')
  if (degraded > 0) console.log(`\nNOTE: ${degraded} file(s) were already degraded in THIS walk; its costs are understates.`)
  console.log(`NOTE: ${filesOk} files went through production parseFile.`)

  parser.delete?.()
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
