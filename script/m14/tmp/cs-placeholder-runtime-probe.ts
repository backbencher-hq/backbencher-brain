// script/m14/tmp/cs-placeholder-runtime-probe.ts — R7's RUNTIME half, measured for
// one lane instead of asserted.
//
// The register's `runtimeOwed` field says the census proves a SOURCE site exists, not
// that no EMITTED row carries a placeholder. This probe answers the runtime question
// for csharp over both of its pinned corpora: walk every emitted name-bearing field
// (symbol names, owner names, parameter names, relationship source/target) and count
// the values that are a placeholder literal or a blank. Those are the only values a
// consumer could match, count and display while no such name exists in the file.
//
// It also settles the owner decision about `|| "anonymous"`: the csharp analyzer has
// 15 such fallbacks and the census's marker rule (`unknown` only) does not see them,
// so the question "can they fire on real code?" needs a measurement, not an opinion.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()
const CORPUS = "<corpus-root>/bb_tests/repositories"
// Only the literals an ANALYZER INVENTS. `null`/`none`/`undefined` are deliberately
// NOT here: the first run of this probe flagged 154 `relationship.target="Null"`
// entries, and every one was a real member named `Null` in
// powershell/test/xUnit/csharp/test_CommandLineParser.cs — a case-insensitive rule
// that includes `null` convicts real code. A blank string is its own case.
const PLACEHOLDER = /^(?:<|\(|\[)?unknown(?:\)|>|\])?$/i
const INVENTED_NAME = /^(?:anonymous|unnamed|anon|placeholder)$/i

async function main() {
  const cap = Number(process.argv[2] ?? 200)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const corpora = ["powershell", "fsharp"]
  let files = 0
  const hits: string[] = []
  const fieldCounts: Record<string, number> = {}
  const honest: Record<string, number> = {}

  for (const repo of corpora) {
    const dir = path.join(CORPUS, repo)
    const found: string[] = []
    const stack = [dir]
    while (stack.length > 0 && found.length < cap) {
      const d = stack.pop()!
      let entries: string[]
      try { entries = fs.readdirSync(d) } catch { continue }
      for (const e of entries) {
        if (e === "obj" || e === "bin" || e === ".git" || e === "node_modules") continue
        const p = path.join(d, e)
        let st: fs.Stats
        try { st = fs.statSync(p) } catch { continue }
        if (st.isDirectory()) stack.push(p)
        else if (e.endsWith(".cs") && !e.endsWith(".g.cs") && !e.endsWith(".Designer.cs") && found.length < cap) found.push(p)
      }
    }
    for (const file of found) {
      let src: string
      try { src = fs.readFileSync(file, "utf8") } catch { continue }
      let res: any
      try { res = await ASTEngine.parseFile(file, src) } catch { continue }
      files++
      // THE FABRICATION TEST, and the reason this probe is worth having: a name-shaped
      // literal is only a defect when the FILE DOES NOT WRITE IT. The first two runs of
      // this probe convicted 154 `Null` and 22 `Unknown`/`Anonymous` values, and every one
      // of them was a real member of powershell or fsharp (`Null` in an xUnit test, an
      // `Unknown` enum/util in PowerShell, `Anonymous` in Telemetry.cs) — a runtime rule
      // that matches the VALUE alone cannot tell an invented name from a real one. The
      // file's own text can: if the identifier appears in the source, the emission is
      // honest, whatever it is spelled. A blank name is its own case (nothing is written).
      const note = (field: string, value: unknown) => {
        if (typeof value !== "string") return
        if (!PLACEHOLDER.test(value) && !INVENTED_NAME.test(value) && value !== "") return
        honest[field] = (honest[field] ?? 0) + 1
        if (value === "" || !src.includes(value)) {
          fieldCounts[field] = (fieldCounts[field] ?? 0) + 1
          if (hits.length < 40) hits.push(`${path.relative(CORPUS, file)} ${field}=${JSON.stringify(value)}`)
        }
      }
      for (const s of res.symbols ?? []) {
        note("symbol.name", s.name)
        note("symbol.ownerName", s.ownerName)
        for (const p of s.parameters ?? []) note("parameter.name", p?.name)
      }
      for (const r of res.relationships ?? []) {
        note("relationship.source", r.source)
        note("relationship.target", r.target)
      }
      for (const i of res.imports ?? []) note("import.module", i.module)
    }
  }

  console.log(`scanned ${files} .cs files (cap ${cap}/corpus)`)
  console.log("name-shaped literals seen (any origin):", JSON.stringify(honest))
  console.log("FABRICATED (the file never writes the name):", JSON.stringify(fieldCounts))
  for (const h of hits) console.log("  ", h)
  if (!hits.length) console.log("  (none — no emitted name is a placeholder)")
}

main()
