// #924 cpp row 3: every `calls` target that carries whitespace is source text, not
// a name. Which callee SHAPE produces it, and how many sites are there?
// Applies the analyzer's own unwrap rule and reports the node type the descent
// stopped on.
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { getParser } from "../run-fixtures"

const ROOTS: Array<[string, string, string[]]> = [
  ["fmt:cpp", "/home/ishaq2321/bb_tests/repositories/fmt", ["*.h", "*.cc", "*.cpp"]],
  ["nlohmann-json:cpp", "/home/ishaq2321/bb_tests/repositories/nlohmann-json", ["*.hpp", "*.cpp", "*.h"]],
]
function files(root: string, exts: string[]): string[] {
  const names = exts.map((e) => `-name '${e}'`).join(" -o ")
  return execSync(`find ${root} -type f \\( ${names} \\) -not -path '*/build/*' -not -path '*/.git/*'`, { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n").filter(Boolean).sort()
}

const NAME_BEARING = new Set(["identifier", "field_identifier", "type_identifier", "operator_name", "destructor_name", "namespace_identifier"])

function stopNode(n: any): any {
  let cur = n
  let guard = 0
  while (cur && guard++ < 8) {
    const t = cur.type
    if (t === "field_expression") {
      const f = cur.childForFieldName("field") ?? cur.namedChild(cur.namedChildCount - 1)
      if (!f) return cur
      cur = f
      continue
    }
    if (t === "template_function" || t === "template_method") {
      const base = cur.namedChild(0)
      if (!base) return cur
      cur = base
      continue
    }
    if (t === "dependent_name" && cur.namedChildCount >= 1) {
      const inner = cur.namedChild(0)
      if (inner && (inner.type === "template_method" || inner.type === "template_function" || inner.type === "identifier" || inner.type === "field_identifier")) { cur = inner; continue }
      return cur
    }
    if (t === "qualified_identifier" && cur.namedChildCount >= 1) { cur = cur.namedChild(cur.namedChildCount - 1); continue }
    if (t === "parenthesized_expression" && cur.namedChildCount >= 1) { cur = cur.namedChild(0); continue }
    return cur
  }
  return cur
}

const byStop = new Map<string, number>()
const samples: string[] = []
let callsTotal = 0
let wsCalls = 0
let filesScanned = 0

for (const [, root, exts] of ROOTS) {
  for (const f of files(root, exts)) {
    const src = readFileSync(f, "utf8")
    const tree: any = (await getParser("cpp")).parse(src)
    filesScanned++
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "call_expression") {
        callsTotal++
        const fn = n.childForFieldName("function") || n.namedChild(0)
        if (fn) {
          const stop = stopNode(fn)
          const txt = String(stop?.text ?? "")
          if (/\s/.test(txt)) {
            wsCalls++
            const key = `${stop.type}${NAME_BEARING.has(stop.type) ? " (name-bearing!)" : ""}`
            byStop.set(key, (byStop.get(key) ?? 0) + 1)
            if (samples.length < 14) samples.push(`${f.replace("/home/ishaq2321/bb_tests/repositories/", "")} L${n.startPosition.row + 1} [${stop.type}] ${JSON.stringify(txt.length > 60 ? txt.slice(0, 60) + "…" : txt)}`)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
}
console.log(`files=${filesScanned} call_expressions=${callsTotal} whitespace-callee=${wsCalls}`)
console.log("stop node types:", JSON.stringify([...byStop.entries()].sort((a, b) => b[1] - a[1])))
for (const s of samples) console.log("  " + s)
