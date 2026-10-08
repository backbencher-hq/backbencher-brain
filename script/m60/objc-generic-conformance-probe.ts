/**
 * script/m60/objc-generic-conformance-probe.ts — HOW MANY `implements` EDGES NAME A
 * LIGHTWEIGHT-GENERIC TYPE PARAMETER INSTEAD OF A PROTOCOL?
 *
 * Objective-C spells type parameters and protocol adoption with ONE token sequence:
 *
 *     @interface SDMemoryCache <KeyType, ObjectType> : NSCache <KeyType, ObjectType> <SDMemoryCache>
 *                ^^^^^^^^^^^^^^^^^^^^^^^^ generics   ^^^^^^^^^^^^^^^^^^^^^^^^ arguments  ^^^^^^^^^ protocols
 *
 * The pinned grammar emits `parameterized_arguments` for all three, and the analyzer reads
 * EVERY `parameterized_arguments` child of a `class_interface` as an adoption list. So
 * `implements SDMemoryCache -> KeyType` is published for a declaration that adopts no
 * protocol named KeyType — there is none, because KeyType is this class's own type
 * parameter. A fabricated edge is what `bb_graph` and `bb_impact` consume as fact.
 *
 * This probe partitions every `parameterized_arguments` list of every `class_interface` /
 * `class_implementation` by its POSITION relative to the `:` token and by whether its
 * members are the class's own type parameters, so the fix can be written against structure
 * and the size of the win can be read off rather than estimated.
 *
 *   class TYPE PARAMETERS    — before the `:`, i.e. no superclass clause was written
 *   SUPERCLASS TYPE ARGS     — after the `:`, every member is one of the type parameters
 *   PROTOCOL LIST            — everything else
 *
 * READ-ONLY. Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories/objc"
const files: { label: string; abs: string; dir: string; text: string; lines: string[] }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "ls-files", "-z"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel); let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "objective-c") continue
    files.push({ label: `${e}/${rel}`, abs, dir, text, lines: text.split("\n") })
  }
}
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default, L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-objc.wasm"))))

type Bucket = { n: number; files: Set<string>; members: Map<string, number>; sample: string[] }
const buckets = new Map<string, Bucket>()
const bump = (k: string, f: string, line: number, members: string[], srcName: string, declLine: string): void => {
  const b = buckets.get(k) ?? { n: 0, files: new Set<string>(), members: new Map<string, number>(), sample: [] }
  b.n++; b.files.add(f)
  for (const m of members) b.members.set(m, (b.members.get(m) ?? 0) + 1)
  if (b.sample.length < 6) b.sample.push(`${f}:${line} ${srcName} -> [${members.join(", ")}]  decl=${declLine.slice(0, 110)}`)
  buckets.set(k, b)
}
let genericClasses = 0
/** Every type-parameter name this corpus declares, gathered in a first pass so a
 *  protocol-list slot can be checked against them. `KeyType`/`ObjectType` are not
 *  hardcoded: the corpus decides what a type parameter is called. */
const TYPE_PARAM_NAMES = new Set<string>()
let idx = 0
await Promise.all(Array.from({ length: 6 }, async () => {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const t = parser.parse(f.text)
    if (!t) continue
    const v = (n: any): void => {
      if (n.type === "class_interface" || n.type === "class_implementation") {
        const kids: any[] = []
        for (let k = 0; k < n.childCount; k++) kids.push(n.child(k))
        const colonIdx = kids.findIndex((c) => c && !c.isNamed && c.type === ":")
        const parenIdx = kids.findIndex((c) => c && !c.isNamed && c.type === "(")
        const srcName = (() => { for (const c of kids) if (c && c.isNamed && c.type === "identifier") return c.text; return "?" })()
        const lists = kids.map((c, k) => ({ c, k })).filter(({ c }) => c && c.isNamed && c.type === "parameterized_arguments")
        const membersOf = (pa: any): string[] => {
          const out: string[] = []
          for (let p = 0; p < pa.namedChildCount; p++) {
            const pn = pa.namedChild(p)
            if (!pn) continue
            if (["type_identifier", "identifier", "type_name"].includes(pn.type)) out.push(pn.text)
          }
          return out
        }
        if (lists.length > 0) genericClasses++
        const ownTypeParams = colonIdx < 0 ? new Set<string>() : new Set(lists.filter(({ k }) => k < colonIdx).flatMap(({ c }) => membersOf(c)))
        for (const tp of ownTypeParams) TYPE_PARAM_NAMES.add(tp)
        const afterColon = lists.filter(({ k }) => k > colonIdx && k > parenIdx)
        let firstArgsUsed = false
        for (const { c, k } of lists) {
          const members = membersOf(c)
          let bucket: string
          if (k < colonIdx) bucket = "1. CLASS TYPE PARAMETERS (no superclass clause written)"
          else if (!firstArgsUsed && members.length > 0 && members.every((m) => ownTypeParams.has(m))) { bucket = "2. SUPERCLASS TYPE ARGUMENTS (all members are this class's own type parameters)"; firstArgsUsed = true }
          else { bucket = "3. PROTOCOL LIST"; if (k > colonIdx) firstArgsUsed = true }
          const dl = c.startPosition.row + 1
          bump(bucket, f.label, dl, members, srcName, f.lines[dl - 1]?.trim() ?? "")
          if (bucket.startsWith("3.") && members.some((m) => TYPE_PARAM_NAMES.has(m))) {
            const d = buckets.get("3b. PROTOCOL-LIST SLOT HOLDING A TYPE-PARAMETER NAME") ?? { n: 0, files: new Set<string>(), members: new Map<string, number>(), sample: [] }
            d.n++; d.files.add(f.label); for (const m of members) d.members.set(m, (d.members.get(m) ?? 0) + 1)
            if (d.sample.length < 12) d.sample.push(`${f.label}:${dl} ${srcName} -> [${members.join(", ")}]  decl=${(f.lines[dl - 1] ?? "").trim().slice(0, 120)}`)
            buckets.set("3b. PROTOCOL-LIST SLOT HOLDING A TYPE-PARAMETER NAME", d)
          }
        }
      }
      for (let k = 0; k < n.childCount; k++) { const c = n.child(k); if (c) v(c) }
    }
    v(t.rootNode)
    t.delete?.()
  }
}))
console.log(`generic/parameterized class declarations in the corpus: ${genericClasses}`)
console.log(`\nparameterized_arguments lists, partitioned by position:`)
for (const [k, b] of [...buckets].sort()) {
  console.log(`\n  ${k}`)
  console.log(`     lists=${b.n} files=${b.files.size} distinct members=${b.members.size}`)
  console.log(`     members: ${[...b.members].sort((x, y) => y[1] - x[1]).map(([m, c]) => `${m}=${c}`).join("  ")}`)
  for (const s of b.sample) console.log(`     e.g. ${s}`)
}
