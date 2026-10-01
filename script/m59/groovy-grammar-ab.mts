// Grammar A/B for two groovy wasm builds: is a REBUILD behaviourally identical to
// the one already shipped?
//
// Why behaviour and not a hash:
//
//   The lane's older record (`reviews/m49-w8-groovy-class-body-dot-continuation.md`)
//   measured that `tree-sitter build --wasm` is NOT byte-reproducible, and this script
//   was written for that world. It no longer holds for the toolchain now pinned below:
//   two independent builds of identical source, and the committed artifact, all produce
//   the same sha256. That older measurement was taken with the historical emscripten
//   toolchain, so it was true of that build and false of this one.
//
//   A hash is therefore a valid FIRST check now, and cheap. This stays the check that
//   survives a toolchain change, because it compares what the parser actually does
//   rather than what the linker happened to emit: it parses every corpus file with both
//   wasms and compares, per file, the count of ERROR/MISSING nodes and a hash of the
//   tree's node-type sequence. Zero differences across 7,114 files means the toolchain
//   in use is the one the shipped wasm was built with, which is the precondition for
//   trusting ANY grammar change measured against it -- and it is the only check that
//   catches a change that holds the error total flat while reshaping the tree.
//
// This also pins the toolchain, which `grammars/tree-sitter-groovy/package.json`
// still does not record:
//   tree-sitter-cli    0.25.1   (0.26.9's prebuilt binary needs GLIBC 2.39 and
//                                cannot run on this host; 0.25.1 reproduces the
//                                shipped wasm's behaviour exactly)
//   tree-sitter-java   0.23.5   (required by `grammar.js`'s `require("tree-sitter-java/grammar.js")`)
//
// Usage: tsx script/m59/groovy-grammar-ab.mts [/path/to/rebuild.wasm] [--top N]
//   default rebuild: /tmp/groovy-rebuild.wasm
import * as fs from "node:fs"
import { execSync } from "node:child_process"
import { createHash } from "node:crypto"

const REPO = "$HOME/backbencher-brain"
const SHIPPED = `${REPO}/wasm/tree-sitter-groovy.wasm`
const CORPUS = process.env.GROOVY_CORPUS ?? "$HOME/fixtures/xml/repos/grails-core"

async function main(): Promise<void> {
  const positional = process.argv.slice(2).filter(a => !a.startsWith("--"))
  const topIdx = process.argv.indexOf("--top")
  const top = topIdx >= 0 ? Number(process.argv[topIdx + 1]) : 15
  const REBUILT = positional[0] ?? "/tmp/groovy-rebuild.wasm"
  if (!fs.existsSync(REBUILT)) throw new Error(`no rebuild to compare: ${REBUILT}`)

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })

  const files = execSync(`git -C ${JSON.stringify(CORPUS)} ls-files '*.groovy'`, {
    encoding: "utf8", maxBuffer: 1 << 28,
  }).split("\n").filter(Boolean)

  // Errors + node-type sequence. The hash is what makes this a *behavioural*
  // identity check rather than a pass/fail count: a grammar change can leave the
  // error total flat while reshaping the tree, and that is exactly the kind of
  // edit that silently rewrites a lane's edge counts.
  const shape = (parser: any, src: string): { errors: number; hash: string } => {
    const t = parser.parse(src)
    let errors = 0
    const h = createHash("sha256")
    const w = (n: any): void => {
      if (n.type === "ERROR" || n.isMissing) errors++
      h.update(n.type).update("\0")
      for (let i = 0; i < n.childCount; i++) w(n.child(i))
    }
    w(t.rootNode)
    return { errors, hash: h.digest("hex") }
  }

  const pS = new P(); pS.setLanguage(await L.load(fs.readFileSync(SHIPPED)))
  const pR = new P(); pR.setLanguage(await L.load(fs.readFileSync(REBUILT)))

  let same = 0, differ = 0, errS = 0, errR = 0
  const diffs: Array<{ file: string; s: number; r: number }> = []
  for (const rel of files) {
    let src: string
    try { src = fs.readFileSync(`${CORPUS}/${rel}`, "utf8") } catch { continue }
    const a = shape(pS, src)
    const b = shape(pR, src)
    errS += a.errors; errR += b.errors
    if (a.hash === b.hash) same++
    else { differ++; if (diffs.length < top) diffs.push({ file: rel, s: a.errors, r: b.errors }) }
  }

  console.log("groovy grammar A/B — behaviour, not bytes")
  console.log(`  files compared       : ${same + differ}`)
  console.log(`  identical parse tree : ${same}`)
  console.log(`  DIFFERENT            : ${differ}   <- must be 0 before any grammar change`)
  console.log(`  ERROR/MISSING nodes  — shipped ${errS}   rebuilt ${errR}   delta ${errR - errS}`)
  for (const d of diffs) console.log(`    ${d.file}  shipped=${d.s} rebuilt=${d.r}`)
  console.log(`\n  verdict: ${differ === 0
    ? "rebuild is behaviourally identical to the shipped wasm on every file — this toolchain built the artifact"
    : "rebuild parses differently; a grammar change now would ship a parser no measurement can vouch for"}`)
  if (differ > 0) process.exitCode = 1
}
main().catch((e) => { console.error(e); process.exit(1) })
