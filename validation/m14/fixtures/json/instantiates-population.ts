/**
 * HOW MUCH CORPUS DOES THE `instantiates` PROBE ACTUALLY LOOK AT?
 *
 * ## The question
 *
 * `script/m14/json-ruled.ts`'s one entry is instrument B with a TWO-PASS probe: pass 1 asks
 * "does this DOCUMENT declare types" (a `class` string, or an LSP `{"kind":"reference"}`
 * literal), and **pass 2 returns early unless pass 1 fired** — `if (!declaresTypes) return`.
 *
 * So the probe's real population is the set of type-declaring documents, not the admitted
 * population. The ruling reports "0 over N admitted files", and N is the WALK's population
 * while the PROBE examined a much smaller set. That gap is the shape the round brief calls
 * a thin ruling wearing a confident label: the number quoted is reproducible, but it does not
 * mean what a reader takes it to mean.
 *
 * This file measures the gap instead of arguing about it, in three numbers:
 *
 *   1. admitted files the walk reached;
 *   2. documents that pass the pass-1 gate — the population pass 2 actually examines;
 *   3. the UNGATED population: constructor-named keys bound to an object, anywhere, with no
 *      `declaresTypes` precondition — i.e. the ruling with its precondition removed.
 *
 * (3) is the number that decides whether the ruling is sound or merely narrow. If (3) is 0
 * then the ruling is correct and its precondition is redundant. If (3) is non-zero the
 * ruling is asserting absence over a population it did not examine, which is a finding about
 * the probe, not about the language.
 *
 * It also reports a value-role split for every constructor-named key found, because the
 * ruling's own reasoning turns on the role of the value and a bare count would collapse the
 * distinction that made it correct: `"constructor": ["index"]` in duckdb is a DECLARATION
 * (parameter names) and `"constructor": {...}` would be instance state.
 *
 * Regex-free: keys and value node types come off the tree, never off the text.
 * Read-only with respect to the corpus; writes only to `--out`.
 *
 * Usage: npx tsx validation/m14/fixtures/json/instantiates-population.ts [--slots N] [--max-bytes N] [--out f.json]
 *
 * `--max-bytes 0` asks for the uncapped SUPERSET (14,095 files) and is the stronger test,
 * because it adds the documents the census excludes. It is not the default: a double parse-
 * tree scan over documents above the 512 KB cap did not finish inside a 40-minute budget,
 * and a population that only completes on some runs is not one to quote a number from. The
 * default is therefore the census cap — the same 13,951-file population the gate and
 * `edge-ledger.ts` report — and the number below states which one it walked.
 */
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { admittedFiles, DEFAULT_MAX_BYTES } from "./admitted-files"

/** The same list the ruling uses, restated so this file cannot silently audit a different rule. */
const CONSTRUCTOR_KEYS = ["new", "constructor", "__init__", "__new__", "init", "instantiate", "create", "factory"]

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string, d: number) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d
}
const SLOTS = argOf("--slots", 6)
const MAX_BYTES = argOf("--max-bytes", DEFAULT_MAX_BYTES)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : ""

type Role = { key: string; valueType: string; gated: boolean; label: string }

async function main(): Promise<void> {
  const walk = admittedFiles(CR, MAX_BYTES)
  const files = walk.files
  console.log(`admitted: ${files.length} files across ${walk.repos.length} repos  (maxBytes=${MAX_BYTES || "uncapped superset"})`)
  console.log(`slots: ${SLOTS}`)

  const wts: any = await import("web-tree-sitter")
  const Parser = wts.Parser ?? wts.default
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const wasm = readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-json.wasm"))

  const lang = await Language.load(wasm)
  const make = async (): Promise<any> => {
    const p = new Parser()
    p.setLanguage(lang)
    return p
  }
  let slots: any[] = await Promise.all(Array.from({ length: SLOTS }, make))
  let nextSlot = 0

  const scan = (root: any, fn: (n: any) => void) => {
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()
      fn(n)
      for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
    }
  }
  const unquote = (t: string): string => {
    const v = t.trim()
    return v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"' ? v.slice(1, -1) : v
  }
  const keyOf = (pair: any): string | null => {
    if (pair?.type !== "pair") return null
    const k = pair.childForFieldName?.("key")
    if (!k) return null
    const c = k.namedChildren?.find((x: any) => x.type === "string_content")
    return c ? String(c.text ?? "") : unquote(String(k.text ?? ""))
  }
  const valueOf = (pair: any): any => pair?.childForFieldName?.("value")
  const stringValueOf = (pair: any): string | null => {
    const v = valueOf(pair)
    return v?.type === "string" ? unquote(String(v.text ?? "")) : null
  }

  let declaredTypeDocs = 0
  let parsed = 0
  let threw = 0
  /** Ungated: every constructor-named key with its value's node type, keyed by role. */
  const ungated = new Map<string, { count: number; label: string }>()
  /** The overlap the ruling actually examines: constructor-named key bound to an OBJECT. */
  const objectBound: Role[] = []

  for (const f of files) {
    const text = readFileSync(f.abs, "utf8")
    const label = `${f.repo}/${f.rel}`
    let tree: any
    try {
      const s = slots[nextSlot]
      nextSlot = (nextSlot + 1) % slots.length
      tree = s.parse(text)
    } catch {
      // A parser instance that throws is DISCARDED and replaced, so a trap costs one slot
      // rather than the whole walk. This is the technique `trap-scan.ts` uses.
      threw++
      try {
        slots[nextSlot] = await make()
      } catch { /* a slot that cannot be rebuilt simply stays dead */ }
      continue
    }
    if (!tree) continue
    parsed++
    let declaresTypes = false
    scan(tree.rootNode, (n) => {
      if (n.type !== "pair") return
      const k = keyOf(n)
      if (k === "class" && stringValueOf(n) !== null) declaresTypes = true
      if (k === "kind" && stringValueOf(n) === "reference") declaresTypes = true
    })
    if (declaresTypes) declaredTypeDocs++
    scan(tree.rootNode, (n) => {
      if (n.type !== "pair") return
      const k = keyOf(n)
      if (k === null || !CONSTRUCTOR_KEYS.includes(k)) return
      const vt = String(valueOf(n)?.type ?? "?")
      const ck = `${k} -> ${vt}`
      const cur = ungated.get(ck)
      if (cur) cur.count++
      else ungated.set(ck, { count: 1, label })
      if (vt === "object") objectBound.push({ key: k, valueType: vt, gated: declaresTypes, label })
    })
    tree.delete?.()
  }

  const gatedObj = objectBound.filter((r) => r.gated)
  const ungatedObj = objectBound.filter((r) => !r.gated)

  console.log("")
  console.log(`parsed ${parsed}   threw ${threw}   slots left ${slots.filter(Boolean).length}`)
  console.log("")
  console.log("(1) admitted files the walk reached : " + files.length)
  console.log("(2) documents passing the pass-1 `declaresTypes` gate : " + declaredTypeDocs)
  console.log("    -> this is the population the ruling's pass 2 EXAMINES.")
  console.log(`    -> ${declaredTypeDocs === 0 ? "ZERO" : ((declaredTypeDocs / files.length) * 100).toFixed(3) + "%"} of the admitted population`)
  console.log("(3) constructor-named key bound to an OBJECT:")
  console.log(`      inside a type-declaring document (the ruling's population) : ${gatedObj.length}`)
  console.log(`      ANYWHERE, precondition removed (the ungated population)   : ${ungatedObj.length}`)
  console.log("")
  console.log("every constructor-named key by the node type of its value (ungated, whole corpus):")
  for (const [k, v] of [...ungated].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${k.padEnd(26)} ${String(v.count).padStart(6)}   first: ${v.label}`)
  }
  if (objectBound.length) {
    console.log("")
    console.log(`all ${objectBound.length} object-bound constructor keys, first 20:`)
    for (const r of objectBound.slice(0, 20)) console.log(`  ${r.key}  gated=${r.gated}  ${r.label}`)
  }

  const verdict =
    ungatedObj.length === 0
      ? "SOUND AND NOT NARROW: the precondition removes nothing — 0 with it, 0 without it. The ruling's 0 is a fact about the whole admitted population."
      : gatedObj.length === 0
        ? `NARROW, AND CORRECTLY SO: ${ungatedObj.length} object-bound constructor key(s) exist, all OUTSIDE any type-declaring document, so they are not constructions. The ruling is right and its precondition is doing work.`
        : `CONTRADICTED: ${gatedObj.length} object-bound constructor key(s) inside type-declaring documents.`
  console.log("")
  console.log("VERDICT: " + verdict)

  if (OUT) {
    writeFileSync(
      OUT,
      JSON.stringify({ corpus: CR, maxBytes: MAX_BYTES, admitted: files.length, parsed, threw, declaredTypeDocs, objectBound, ungated, verdict }, null, 2),
    )
    console.log("wrote " + OUT)
  }
}

await main()