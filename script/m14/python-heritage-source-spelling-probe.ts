/**
 * PYTHON HERITAGE — THE SOURCE-SPELLING CHECK, a companion to `python-heritage-probe.ts`.
 *
 * THE QUESTION. The heritage probe counts a base clause as covered only when an edge exists
 * with `source == className` (the RAW tree name) AND `target == leaf`. For an `attribute` base
 * (`class C(mod.Base)`) the probe reported 1,859 uncovered out of 6,388 — and the lookup DOES
 * name `attribute`. So either the emitter drops those edges, or the probe is comparing the
 * wrong SPELLING of the source endpoint.
 *
 * THE INSTRUMENT. For every uncovered clause, it asks the emitter's own output three questions,
 * in order, and buckets the answer:
 *
 *   A. is there an edge whose TARGET is the leaf, with ANY source?   ⇒ the edge EXISTS
 *   B. is the source the raw name, a QUALIFIED name (module.Class), or something else?
 *   C. is the leaf equal to the class's own name (the self-base, which the analyzer
 *      deliberately suppresses as a name-collision self-loop)?
 *
 * ⇒ THE BUCKETS SEPARATE "THE EMITTER DROPPED IT" FROM "THE PROBE MISSPELLED IT", and a reader
 * never has to guess which one the number is.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

import { getParser } from "../../src/ast/engine"
import { RealPythonAnalyzer } from "../../src/ast/real-python-analyzer"

const CORPUS_ROOT = path.resolve(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories")
const ADMITTED = [".py", ".pyi", ".pyw"]
const SIZE_CAP = 1024 * 1024

function discover(): string[] {
  const out: string[] = []
  let entries: string[] = []
  try { entries = readdirSync(CORPUS_ROOT) } catch { return out }
  for (const name of entries.sort()) {
    const dir = path.join(CORPUS_ROOT, name)
    let isDir = false
    try { isDir = statSync(dir).isDirectory() } catch { continue }
    if (!isDir) continue
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n")
    } catch { continue }
    const seen = new Set<string>()
    for (const rel of tracked) {
      if (!rel) continue
      if (!ADMITTED.some((e) => rel.endsWith(e))) continue
      const abs = path.join(dir, rel)
      let size = 0
      try { size = statSync(abs).size } catch { continue }
      if (size > SIZE_CAP) continue
      if (seen.has(abs)) continue
      seen.add(abs)
      out.push(abs)
    }
  }
  return out
}

async function main(): Promise<void> {
  const files = discover()
  console.log(`population: ${files.length} admitted files · ${CORPUS_ROOT}`)
  const parser = await getParser("python")
  const analyzer = new RealPythonAnalyzer() as any
  const baseClassLeaf = (n: any): string | undefined => analyzer.baseClassLeaf(n)

  const buckets: Record<string, number> = {
    edgeExistsAnySource: 0,
    sourceIsQualified: 0,
    sourceIsRaw: 0,
    sourceOther: 0,
    noEdgeAtAll: 0,
    selfBase: 0,
    leafIsEnum: 0,
  }
  const examples: string[] = []
  let clauses = 0
  let coveredRaw = 0

  for (const abs of files) {
    let content: string
    try { content = readFileSync(abs, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(content) } catch { continue }
    if (!tree) continue
    let result: any
    try { result = analyzer.analyze(tree.rootNode, content, abs) } catch { continue }
    const rels: any[] = Array.isArray(result?.relationships) ? result.relationships : []
    const byTarget = new Map<string, string[]>()
    for (const r of rels) {
      const t = String(r?.type ?? "")
      if (t !== "extends" && t !== "implements") continue
      const tgt = String(r?.target ?? "")
      const src = String(r?.source ?? "")
      const list = byTarget.get(tgt) ?? []
      list.push(src)
      byTarget.set(tgt, list)
    }
    const visit = (node: any): void => {
      if (node?.type === "class_definition") {
        const nameNode = node.childForFieldName?.("name")
        const rawName = nameNode?.text ?? ""
        const sup = node.childForFieldName?.("superclasses")
        if (sup) {
          for (let i = 0; i < sup.namedChildCount; i++) {
            const clause = sup.namedChild(i)
            if (!clause) continue
            clauses++
            const leaf = baseClassLeaf(clause)
            if (!leaf) continue
            if (leaf === rawName) { buckets.selfBase++; continue }
            const sources = byTarget.get(leaf)
            if (!sources || sources.length === 0) {
              buckets.noEdgeAtAll++
              if (examples.length < 25) examples.push(`NO-EDGE ${clause.type}: ${abs.replace(CORPUS_ROOT + "/", "")} :: ${rawName} -> ${leaf}`)
              continue
            }
            if (sources.includes(rawName)) { coveredRaw++; continue }
            // THE EDGE EXISTS, BUT ITS SOURCE IS SPELLED DIFFERENTLY.
            buckets.edgeExistsAnySource++
            const qualified = sources.find((s) => s.endsWith("." + rawName) || s.includes("." + rawName))
            if (qualified) buckets.sourceIsQualified++
            else buckets.sourceOther++
            if (examples.length < 25) {
              examples.push(`SPELLING ${clause.type}: ${abs.replace(CORPUS_ROOT + "/", "")} :: leaf=${leaf} sources=[${sources.slice(0, 4).join(", ")}] raw=${rawName}`)
            }
          }
        }
      }
      for (let i = 0; i < (node?.namedChildCount ?? 0); i++) {
        const c = node.namedChild(i)
        if (c) visit(c)
      }
    }
    visit(tree.rootNode)
    try { (tree as any)?.delete?.() } catch { /* freeing a tree that cannot be freed is not an error */ }
  }

  console.log("")
  console.log("THE SOURCE-SPELLING CHECK")
  console.log(`  clauses ${clauses} · covered with the RAW source spelling ${coveredRaw}`)
  for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(22)} ${v}`)
  console.log("")
  for (const e of examples.slice(0, 25)) console.log("  " + e)
}

await main()
