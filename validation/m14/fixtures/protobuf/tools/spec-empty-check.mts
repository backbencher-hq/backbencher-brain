/**
 * DO THE OTHER DECLARATION SPECS HAVE THE SAME TWO TRAPS? — a fleet question, measured.
 *
 * The protobuf spec exists because (1) the grammar names a declaration in a CHILD node
 * (`message_name`), not a `name` field the generic extractor reads, and (2) a `package`/scope node can
 * be a SIBLING rather than an ancestor. Either trap makes a spec index the right SHAPE and hold an
 * EMPTY string: a key space that looks alive and answers nothing.
 *
 * The test is direct and it needs no grammar knowledge: BUILD AN INDEX WITH EACH SPEC and count the
 * names. A spec that yields 0 names over its own language's files is empty, whatever its docstring says.
 *
 *   npx tsx validation/m14/fixtures/protobuf/tools/spec-empty-check.mts [--files=60]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const N = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=60").split("=")[1])
const mod: any = await import(path.join(ROOT, "src/ast/project-index.ts"))
const { PROTOBUF_DECLARATION_SPEC } = await import(path.join(ROOT, "src/ast/real-protobuf-analyzer.ts"))

const CASES: { lang: string; exts: string[]; wasm: string; spec: any }[] = [
  { lang: "solidity", exts: ["sol"], wasm: "wasm/tree-sitter-solidity.wasm", spec: mod.SOLIDITY_DECLARATION_SPEC },
  { lang: "fsharp", exts: ["fs", "fsi", "fsx"], wasm: "wasm/tree-sitter-fsharp.wasm", spec: mod.FSHARP_DECLARATION_SPEC },
  { lang: "python", exts: ["py"], wasm: "wasm/tree-sitter-python.wasm", spec: mod.PYTHON_DECLARATION_SPEC },
  { lang: "dart", exts: ["dart"], wasm: "wasm/tree-sitter-dart.wasm", spec: mod.DART_DECLARATION_SPEC },
  { lang: "protobuf", exts: ["proto"], wasm: "wasm/tree-sitter-protobuf.wasm", spec: PROTOBUF_DECLARATION_SPEC },
]

for (const c of CASES) {
  const files: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    for (const rel of tracked) {
      if (!c.exts.includes(rel.slice(rel.lastIndexOf(".") + 1).toLowerCase())) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue }
      files.push(abs)
    }
    if (files.length >= N) break
  }
  const wasm = path.join(ROOT, c.wasm)
  try {
    const built = await mod.buildProjectIndexFromDisk(wasm, files.slice(0, N), c.spec)
    const verdict = built.symbolNames.size === 0
      ? "EMPTY — the spec indexes the right SHAPE and holds NOTHING"
      : `yields names`
    console.log(`${c.lang.padEnd(10)} ${String(files.slice(0, N).length).padStart(4)} files · symbolNames ${String(built.symbolNames.size).padStart(6)} · typeKinds ${String(built.typeKinds.size).padStart(5)}   ${verdict}`)
  } catch (e: any) {
    console.log(`${c.lang.padEnd(10)} ${String(files.slice(0, N).length).padStart(4)} files · THREW: ${e?.message ?? String(e)}`)
  }
}
