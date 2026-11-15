/**
 * RUST lane — Master Review census: does a QUALIFIED call publish its receiver?
 *
 * THE QUESTION. `docs/M14-COMPLETENESS-LEDGER.md` carries a ratified owner
 * decision ("Dotted-name convention — RATIFIED"): analyzers emit FULL DOTTED
 * NAMES as relationship targets when types are qualified, because "full path
 * carries more information (last segment always extractable; path cannot be
 * reconstructed from segment alone)". The rust lane publishes the bare leaf for
 * a PATH-qualified call — `Vec::new()`, `String::from("x")`,
 * `crate::thing::Widget::assemble()` and a LOCAL `Local::from()` all publish
 * `new` / `from` / `assemble`, indistinguishable from each other and from an
 * unrelated local function of the same name. The lane's own fifth review cites
 * a "#419-B leaf-target contract" for `references` targets; no decision in
 * script/m14/spec/rust-completeness.json covers CALL targets, so this is an
 * UNDECLARED rule on a ratified surface.
 *
 * The M59.A7 line oracle cannot see it: Tier A checks that the callee's leaf
 * token appears on the claimed line, and it does (`new` is on line 6). The
 * information loss is in the TARGET, not the line.
 *
 * WHAT IT MEASURES, per file:
 *   1. bare-leaf `calls` edges whose source line really does contain a
 *      path-qualified call (`Path::leaf(`, `a::b::C::f(`, `Self::f(`) — the
 *      affected class, with the receiver read from the tree, not the text;
 *   2. receivers that are IN-FILE symbols, where the collapse does not merely
 *      lose information but points the edge at the wrong owner;
 *   3. how many DISTINCT receivers collapse onto one target — the multiplicity
 *      of the loss, which is the number that decides whether a consumer can
 *      use the edge at all.
 *
 * It is a census, not a verdict: the ratified convention names java/groovy/
 * kotlin/scala "uniformly", and a family decision can still be taken. What it
 * refuses to do is let the class pass unmeasured.
 *
 * CLI: npx tsx script/m14/tmp/rust-qualified-call-census.ts --repos=cargo,tokio --per-repo=200
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const CORPUS = arg("corpus") ?? "/home/sano/ishaq/bb_rust_corpora"
const REPOS = (arg("repos") ?? "cargo,tokio,serde,hyper,ripgrep").split(",").filter(Boolean)
const PER = Number(arg("per-repo") ?? "200")
const SHOW = Number(arg("show") ?? "10")

const SKIP = new Set([".git", "target", "node_modules", "vendor", ".cargo", "tests", "test", "benches", "examples"])

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".rs") && fs.statSync(p).size > 0) out.push(p)
  }
  return out
}

const childOfType = (n: any, t: string) => { for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && c.type === t) return c } return null }
const kids = (n: any): any[] => { const r: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) r.push(c) } return r }

/** A call whose CALLEE is a path: the receiver text and the leaf, read from the
 *  tree. Covers `Path::leaf(`, `a::b::C::f(`, `Self::f(`, `<T as Tr>::f(` and
 *  the turbofish/generic forms. A method call on a VALUE (`v.m()`) is NOT a
 *  path call and is excluded — a receiver that is a local has no type to
 *  qualify with. */
function pathCallAt(root: any, line: number): { receiver: string; leaf: string } | null {
  let hit: { receiver: string; leaf: string } | null = null
  const stack: any[] = [root]
  while (stack.length && !hit) {
    const n = stack.pop()
    if (n.startPosition.row + 1 !== line) { for (const c of kids(n)) stack.push(c); continue }
    if (n.type !== "call_expression") { for (const c of kids(n)) stack.push(c); continue }
    const fn = n.namedChild(0)
    if (!fn) continue
    if (fn.type === "scoped_identifier") {
      const p = fn.childForFieldName("path")
      const nm = fn.childForFieldName("name")
      if (p && nm) { hit = { receiver: p.text, leaf: nm.text }; break }
    }
    if (fn.type === "generic_function") {
      const inner = childOfType(fn, "scoped_identifier")
      if (inner) {
        const p = inner.childForFieldName("path")
        const nm = inner.childForFieldName("name")
        if (p && nm) { hit = { receiver: p.text, leaf: nm.text }; break }
      }
    }
  }
  return hit
}

async function main() {
  const mod: any = await import(path.join(ROOT, "src/ast/real-rust-analyzer.ts"))
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? (wts.default as any)?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))

  let filesDone = 0
  let totalCalls = 0, bareLeaf = 0, pathQualified = 0, receiverInFile = 0
  const targetReceivers = new Map<string, Set<string>>()
  const examples: string[] = []

  for (const repo of REPOS) {
    const dir = path.join(CORPUS, repo)
    if (!fs.existsSync(dir)) { console.log(`(no corpus ${repo})`); continue }
    const files = walk(dir).sort().slice(0, PER)
    const parser = new P(); parser.setLanguage(g)
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8")
      let res: any
      try {
        const tree = parser.parse(text)
        res = await new mod.RealRustAnalyzer().analyze(tree.rootNode, text, f)
      } catch { continue }
      const declared = new Set<string>()
      for (const s of res.symbols ?? []) declared.add(s.name)
      const lines = text.split("\n")
      let tree: any = null
      for (const rel of res.relationships ?? []) {
        if (rel.type !== "calls") continue
        totalCalls++
        const t = String(rel.target ?? "")
        if (t.indexOf(".") !== -1 || t.indexOf("::") !== -1 || t.indexOf("/") !== -1) continue
        bareLeaf++
        const line = rel.line_number ?? rel.line
        if (typeof line !== "number" || line < 1 || line > lines.length) continue
        if (!tree) tree = parser.parse(text).rootNode
        const pc = pathCallAt(tree, line)
        if (!pc) continue
        if (pc.leaf !== t) continue
        pathQualified++
        const recvLeaf = pc.receiver.split("::").filter(Boolean).pop() ?? pc.receiver
        const inFile = declared.has(recvLeaf) || declared.has(pc.receiver)
        if (inFile) receiverInFile++
        if (!targetReceivers.has(t)) targetReceivers.set(t, new Set())
        targetReceivers.get(t)!.add(pc.receiver)
        if (examples.length < SHOW * 6) {
          examples.push(`${path.relative(CORPUS, f)}:${line}  ${pc.receiver}::${t}  ->  calls -> ${t}${inFile ? "   [receiver IS an in-file symbol]" : ""}`)
        }
      }
      filesDone++
    }
  }

  const collapsed = [...targetReceivers.entries()].filter(([, s]) => s.size > 1).sort((a, b) => b[1].size - a[1].size)
  console.log(`\n######## RUST QUALIFIED-CALL CENSUS — files=${filesDone} corpora=${REPOS.join(",")}`)
  console.log(`  calls edges total                         ${totalCalls}`)
  console.log(`  of which a BARE LEAF target               ${bareLeaf} (${((bareLeaf / Math.max(1, totalCalls)) * 100).toFixed(1)}%)`)
  console.log(`  bare leaf that IS a path-qualified call   ${pathQualified} (${((pathQualified / Math.max(1, totalCalls)) * 100).toFixed(1)}% of all calls) — receiver dropped`)
  console.log(`  ... of those, receiver is an IN-FILE symbol ${receiverInFile} — the edge points at an unstated owner`)
  console.log(`  distinct leaf targets                     ${targetReceivers.size}`)
  console.log(`  leaf targets fed by >1 distinct receiver  ${collapsed.length} (the collapse is the loss)`)
  console.log(`  top collapses by distinct receivers:`)
  for (const [leaf, s] of collapsed.slice(0, 14)) {
    const list = [...s].sort()
    console.log(`    ${String(s.size).padStart(3)} receivers -> calls -> ${leaf.padEnd(16)} e.g. ${list.slice(0, 4).join(" , ")}${list.length > 4 ? " …" : ""}`)
  }
  console.log(`  examples:`)
  for (const e of examples.slice(0, SHOW)) console.log(`    ${e}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
