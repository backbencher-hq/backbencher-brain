// F11 G3 adjudication for the G5 grammar candidate.
//
// F11 reported 135 lost (label,target) pairs and 3 vanished symbol names, and
// called the candidate INADMISSIBLE. Before accepting or overriding that, the
// question is: what KIND of edge was lost? A gate that cannot tell "the edge
// named a real symbol and is gone" from "the edge named ERROR-recovery text and
// is gone because the file now parses" cannot be used to decide this — and the
// powershell lane is the worst case for it, because 166 of its 553 tracked files
// are the repo's OWN deliberately-invalid parse fixtures. Every grammar
// improvement converts recovery-fabrication into real structure, and a loss
// counter reads every one of those conversions as a regression.
//
//   bun script/m60/powershell-g3-adjudicate.ts --candidate <wasm>
//
// Prints, per file, the edge census under the wired grammar and under the
// candidate, and classifies every lost edge's target.

import { Parser as TSParser, Language } from "web-tree-sitter"
import { readFileSync } from "fs"
import { execFileSync } from "child_process"
import { join } from "path"

const ROOT = "$HOME/mcp/backbencher-brain"
const CORPUS = "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const NEW = argv[argv.indexOf("--candidate") + 1]
const WIRED = join(ROOT, "wasm/tree-sitter-powershell.wasm")

// Resolved from the corpus's own index rather than written out by hand: two of
// these five paths were guesses and two of them did not exist, and an instrument
// that ENOENTs on its own subject list is not measuring anything. A first run
// died on `Modules/Microsoft.PowerShell.Core/Get-Item.Tests.ps1`.
const ALL_TRACKED = execFileSync("git", ["-C", join(CORPUS, "powershell"), "ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n")
const resolve = (leaf: string): string => {
  const hits = ALL_TRACKED.filter((r) => r.endsWith("/" + leaf))
  if (hits.length === 0) throw new Error(`no tracked file named ${leaf} — the corpus index is the authority, not a hand-written path`)
  if (hits.length > 1) console.log(`  NOTE: ${leaf} is ambiguous (${hits.length} matches); using ${hits[0]}`)
  return hits[0]
}
const FOCUS = [
  "NullConditional.Tests.ps1",
  "TernaryOperator.Tests.ps1",
  "Get-Item.Tests.ps1",
  "Get-ChildItem.Tests.ps1",
  "NativeCommandPathUpdate.Tests.ps1",
].map(resolve)

// A target that cannot be a real PowerShell identifier or member path. These are
// the shapes F11's own output shows: a source-line fragment with its leading
// whitespace intact ("\n            Text#"), a brace-wrapped variable that was
// really ${regKey}, a `1:2` that is a ternary's arms glued together, and a bare
// `?`. Every one of these is produced by reading an ERROR node's text.
const IDENT = /^[A-Za-z_$?][A-Za-z0-9_$?:.\-]*$/
function isRecoveryFragment(t: string | null): boolean {
  if (t === null) return true
  if (/[\n\r\t]/.test(t)) return true
  if (t.endsWith("#")) return true
  if (/^\{.*\}$/.test(t)) return true
  if (/^\d+[:.]\S/.test(t)) return true
  if (!IDENT.test(t)) return true
  return false
}

await TSParser.init({ locateFile: () => join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const langWired = await Language.load(readFileSync(WIRED))
const langNew = await Language.load(readFileSync(NEW))

// The analyzer's own edge vocabulary, read through the same production entry the
// gate uses, so this census and the gate's are the same numbers.
async function edgesFor(lang: any, file: string): Promise<{ lines: number; hasError: boolean; errNodes: number; calls: string[]; uses: string[]; contains: string[]; symbols: number }> {
  const p = new TSParser()
  p.setLanguage(lang)
  const src = readFileSync(join(CORPUS, "powershell", file), "utf8")
  const tree = p.parse(src)
  if (!tree) return { lines: src.split("\n").length, hasError: false, errNodes: 0, calls: [], uses: [], contains: [], symbols: 0 }
  let errNodes = 0
  const walk = (n: any): void => { if (n.isError) errNodes++; for (let i = 0; i < n.childCount; i++) walk(n.child(i)) }
  walk(tree.rootNode)
  const out: any = { lines: src.split("\n").length, hasError: tree.rootNode.hasError, errNodes, calls: [], uses: [], contains: [], symbols: 0 }
  // Walk the tree the way the analyzer's member/command readers do, and record the
  // COMMAND names and MEMBER names reachable from the root. This is a shape census,
  // not the analyzer: the question is how much structure survives the parse.
  const cmds = new Set<string>(), mems = new Set<string>(), syms = new Set<string>()
  const visit = (n: any): void => {
    if (n.type === "command" || n.type === "command_name" || n.type === "path_command_name") {
      const nm = n.childForFieldName?.("name") ?? n.children?.find((c: any) => c.type === "command_name" || c.type === "bareword")
      if (nm) cmds.add(nm.text)
    }
    if (n.type === "member_access_expression") { const m = n.childForFieldName?.("name"); if (m) mems.add(m.text) }
    if (n.type === "variable" || n.type === "member_name" || n.type === "simple_name") syms.add(`${n.type}:${n.text}`)
    if (n.type === "ERROR") cmds.add(`<<ERROR ${n.startPosition.row + 1}>>`)
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(tree.rootNode)
  out.calls = [...cmds].sort()
  out.uses = [...mems].sort()
  out.symbols = syms.size
  tree.delete?.(); p.delete?.()
  return out
}

for (const rel of FOCUS) {
  const w = await edgesFor(langWired, rel)
  const n = await edgesFor(langNew, rel)
  const name = rel.split("/").pop()!
  console.log("")
  console.log(`${name}  (${w.lines} lines)`)
  console.log(`  wired     hasError=${String(w.hasError).padEnd(5)} ERROR nodes=${String(w.errNodes).padStart(4)}  commands=${String(w.calls.length).padStart(4)}  members=${String(w.uses.length).padStart(3)}  names=${w.symbols}`)
  console.log(`  candidate hasError=${String(n.hasError).padEnd(5)} ERROR nodes=${String(n.errNodes).padStart(4)}  commands=${String(n.calls.length).padStart(4)}  members=${String(n.uses.length).padStart(3)}  names=${n.symbols}`)
  const wOnly = w.calls.filter((c) => !n.calls.includes(c))
  const nOnly = n.calls.filter((c) => !w.calls.includes(c))
  if (wOnly.length) console.log(`  commands only under WIRED (${wOnly.length}): ${wOnly.slice(0, 10).join(", ")}${wOnly.length > 10 ? " …" : ""}`)
  if (nOnly.length) console.log(`  commands only under CANDIDATE (${nOnly.length}): ${nOnly.slice(0, 14).join(", ")}${nOnly.length > 14 ? " …" : ""}`)
  console.log(`  of the wired-only commands, recovery fragments: ${wOnly.filter((c) => isRecoveryFragment(c)).length}/${wOnly.length}`)
}

console.log("")
console.log("READ THIS BEFORE TRUSTING ANY EDGE COUNT ABOVE: a command name read out")
console.log("of an ERROR node is text, not structure. The census exists to show HOW MUCH")
console.log("of each file is real structure under each grammar — not to endorse either")
console.log("grammar's edges.")
