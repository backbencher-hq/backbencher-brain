/**
 * EX-A9 / EX-A11 measurement — tree-only census, no analyzer call:
 *   raise-sites      : `raise`/`reraise` whose first argument names a module
 *                      (alias or __MODULE__) — a struct construction with no edge.
 *   protocol-callbacks: `def` heads inside a `defprotocol` body (bodiless
 *                      declarations) and `@callback`/`@macrocallback` attributes.
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const REPO = arg("repo") ?? "elixir"
const SAMPLE = Number(arg("sample") ?? "200")

function walk(d: string, out: string[] = []): string[] {
  let e: fs.Dirent[]
  try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { return out }
  for (const x of e) {
    if ([".git", "_build", "deps", "node_modules"].includes(x.name)) continue
    const p = path.join(d, x.name)
    if (x.isDirectory()) walk(p, out)
    else if (x.name.endsWith(".ex") || x.name.endsWith(".exs")) out.push(p)
  }
  return out
}

function firstId(n: any): any {
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && c.type === "identifier") return c }
  return null
}
function findChild(n: any, pred: (c: any) => boolean): any {
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && pred(c)) return c }
  return null
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
  const p = new P(); p.setLanguage(g)
  const files = walk(path.join(CORPUS_ROOT, REPO)).sort()
  const picked = SAMPLE > 0 && SAMPLE < files.length ? files.slice(0, SAMPLE) : files
  let raiseAlias = 0, raiseModule = 0, raiseDynamic = 0, raiseFiles = 0
  const raiseEx: string[] = []
  let protocolDefs = 0, protocolBodies = 0, callbackAttrs = 0, protocolFiles = 0
  const cbEx: string[] = []
  for (const f of picked) {
    const text = fs.readFileSync(f, "utf8")
    const root = p.parse(text).rootNode
    const stack: any[] = [root]
    let inProtocol = 0
    const protocolStack: boolean[] = []
    while (stack.length) {
      const n = stack.pop()
      if (n.type === "call") {
        const id = firstId(n)
        if (id && id.text === "defprotocol") protocolStack.push(true)
        else if (id && (id.text === "defmodule" || id.text === "defimpl")) protocolStack.push(false)
        if (id && id.text === "def" && protocolStack[protocolStack.length - 1] === true) {
          protocolDefs++
          const hasBody = findChild(n, (c) => c.type === "do_block") !== null
          if (hasBody) { protocolBodies++; if (cbEx.length < 6) cbEx.push(`${path.relative(CORPUS_ROOT, f)}:${n.startPosition.row + 1} ${n.text.slice(0, 60).replace(/\n/g, " ")}`) }
        }
        if (id && (id.text === "raise" || id.text === "reraise")) {
          const args = findChild(n, (c) => c.type === "arguments")
          const first = args && args.namedChildCount > 0 ? args.namedChild(0) : null
          if (!first) raiseDynamic++
          else if (first.type === "alias") { raiseAlias++; if (raiseEx.length < 8) raiseEx.push(`${path.relative(CORPUS_ROOT, f)}:${n.startPosition.row + 1} raise ${first.text}`) }
          else if (first.type === "identifier" && first.text === "__MODULE__") { raiseModule++; if (raiseEx.length < 8) raiseEx.push(`${path.relative(CORPUS_ROOT, f)}:${n.startPosition.row + 1} raise __MODULE__`) }
          else raiseDynamic++
        }
      }
      if (n.type === "unary_operator" && n.child(0)?.text === "@") {
        const c = n.child(1)
        if (c && c.type === "call") {
          const cid = firstId(c)
          if (cid && (cid.text === "callback" || cid.text === "macrocallback")) {
            callbackAttrs++
            if (cbEx.length < 12) cbEx.push(`${path.relative(CORPUS_ROOT, f)}:${n.startPosition.row + 1} @${cid.text} ${c.text.slice(0, 50).replace(/\n/g, " ")}`)
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
      // keep the protocol stack honest: pop when the defprotocol node is done
      if (protocolStack.length > 0 && n.type === "call") {
        const id = firstId(n)
        if (id && (id.text === "defprotocol" || id.text === "defmodule" || id.text === "defimpl")) {
          // the node itself was pushed; its own children are visited next
        }
      }
    }
    void inProtocol
  }
  console.log(JSON.stringify({ REPO, files: picked.length, raiseAlias, raiseModule, raiseDynamic, protocolDefHeads: protocolDefs, protocolHeadsWithBody: protocolBodies, callbackAttrs, raiseEx, cbEx }, null, 1))
}
main().catch((e) => { console.error(e); process.exit(1) })
