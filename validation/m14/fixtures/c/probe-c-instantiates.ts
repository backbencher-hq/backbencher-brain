/**
 * probe-c-instantiates.ts — the hand-read evidence for the `instantiates` fix.
 *
 * Author: Muhammad Ishaq Khan. Probe, read-only.
 *
 * Reproduces the incoming gate's `.c` 400-file stride EXACTLY (git ls-files per
 * repo, `.c` admission, 1 MB cap, sorted, stride floor(total/400)) and parses
 * each picked file through the gate's own path (`engine.parseFile`, content
 * passed). It then prints every emitted `instantiates` edge with:
 *   - file:line of the allocation call,
 *   - the allocator callee and the emitted type target,
 *   - the SAME FILE's own declaration of that type (symbol + line), i.e. the
 *     declaration the edge is supposed to name.
 * Any edge whose type is NOT declared in the same file is printed as
 * `NO-SAME-FILE-DECL` — that is the assertion the hand-read is checking.
 *
 * Run: bun run validation/m14/fixtures/c/probe-c-instantiates.ts
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const CAP = Number(process.env.CAP ?? "400")  // 0 = the WHOLE admitted .c population

// --- discovery, copied in shape from script/m14/incoming-gate.ts -----------
const found: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".c")) continue
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > SIZE_CAP) continue
    } catch { continue }
    found.push(abs)
  }
}
found.sort()
const total = found.length
const stride = CAP > 0 ? Math.max(1, Math.floor(total / CAP)) : 1
const files: string[] = []
if (CAP <= 0) {
  files.push(...found)
} else {
  for (let i = 0; i < found.length && files.length < CAP; i += stride) files.push(found[i])
}
console.log("# population: " + files.length + " of " + total + " .c files" + (CAP > 0 ? ", stride " + stride + " (gate's own rule)" : " — WHOLE admitted .c population (CAP=0)"))

let edges = 0
let withDecl = 0
for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { continue }
  let r: any
  try { r = await ASTEngine.parseFile(f, content) } catch { continue }
  if (!r || !r.relationships) continue
  const byName = new Map<string, any[]>()
  for (const s of r.symbols ?? []) {
    const n = String(s.name ?? "")
    if (!byName.has(n)) byName.set(n, [])
    byName.get(n)!.push(s)
  }
  for (const rel of r.relationships) {
    if (String(rel.type) !== "instantiates") continue
    edges++
    const target = String(rel.target ?? "")
    const candidates = byName.get(target) ?? []
    const declKinds = candidates.filter((s) => ["struct", "type", "union", "enum"].includes(String(s.kind)))
    const line = (s: any): number => s?.range?.startLine ?? s?.range?.start?.line ?? -1
    if (declKinds.length > 0) withDecl++
    const repo = f.split("/repositories/")[1] ?? f
    console.log(
      `EDGE ${repo}:${rel.line_number}  ${rel.source} -> ${target}` +
      `  allocator=${(rel.metadata as any)?.allocator ?? "?"}` +
      `  evidenceClass=${(rel.metadata as any)?.evidenceClass ?? "?"}` +
      `  decl=${declKinds.length > 0 ? `${target} ${declKinds[0].kind}@${line(declKinds[0])}` : "NO-SAME-FILE-DECL"}`
    )
  }
}
console.log(`# instantiates edges: ${edges} · with a same-file type declaration: ${withDecl} · without: ${edges - withDecl}`)
process.exit(edges > 0 && withDecl === edges ? 0 : 1)
