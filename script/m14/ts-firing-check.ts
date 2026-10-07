// TYPESCRIPT LANE FIRING CHECK — this worktree's copy of the M14 firing test.
//
// WHY A LANE COPY, and what it changes and does not.
//
// `script/m14/firing-check.mjs` is MASTER-owned and hardcodes
// `const REPO = "$HOME/backbencher-brain"`, so it always measures the
// MAIN checkout — not the branch under review. It also reads the enum from
// `src/ast/types.ts`, whose `Imports` member is `"brain_import"`, a value no
// analyzer emits and a SQL table name (`schema-ddl.ts:131`). Measured on
// 2026-10-04 through that harness itself, all 23 lanes it exercises report
// `brain_import` in its SILENT line, and 3 of them (GO, HASKELL, TYPESCRIPT) list
// it as the ONLY silent type — which reads as "those three lanes close every gap
// except imports" and means nothing of the kind.
//
// So this copy makes exactly two changes and keeps everything else:
//
//   1. REPO resolves to this worktree, from the script's own location, so the
//      number describes the branch being reviewed.
//   2. The enum is read from `src/ast/engine.ts` — the namespace all 48
//      real-*-analyzer.ts files import — and the `src/ast/types.ts` spelling is
//      read too and printed beside it, so the split is visible in the output
//      instead of inferred from a SILENT line.
//
// The traversal, the corpus draw, the 120-file sample and the tally logic are
// unchanged, so the two numbers are comparable. `--all` walks the same lane table.
//
// NO REGEX in anything this lane wrote: the file picker's directory skips use
// startsWith/endsWith/indexOf, and the analyzer-class probe reads the export name
// and tests its suffix with endsWith. (The shared original uses patterns in both
// places; that is its code and is reported, not edited.)
//
// Usage: bun run script/m14/ts-firing-check.ts [--files N] [--all]
import { readdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const NFILES = Number(process.env.NFILES ?? 120)

const LANES = {
  TYPESCRIPT: ["typescript", "real-typescript-analyzer", "typescript"],
  JAVASCRIPT: ["javascript", "real-javascript-analyzer", "lodash"],
  VUE: ["vue", "real-vue-analyzer", "vuejs"],
  SVELTE: ["svelte", "real-svelte-analyzer", "shadcn-svelte"],
}
const EXTS = {
  typescript: [".ts", ".tsx"],
  javascript: [".js", ".mjs"],
  vue: [".vue"],
  svelte: [".svelte"],
}
const SKIP_DIRS = ["node_modules", ".git", "testdata", "fixtures", "dist", "build", "coverage"]

function pickFiles(dir: string, exts: string[], want: number, cap = 400): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    if (out.length >= want || depth > 7) return
    let ents: { name: string; isDirectory(): boolean }[]
    try { ents = readdirSync(d, { withFileTypes: true }) as any } catch { return }
    for (const e of ents) {
      if (out.length >= want) return
      const p = join(d, e.name)
      if (e.isDirectory()) { if (!SKIP_DIRS.some((s) => e.name === s || e.name.startsWith(s))) walk(p, depth + 1) }
      else if (exts.some((x) => e.name.endsWith(x))) {
        try { if (statSync(p).size < 400_000) out.push(p) } catch {}
      }
    }
  }
  walk(dir, 0)
  return out.slice(0, cap)
}

const { readFileSync } = await import("node:fs")
const engineMod: any = await import(join(REPO, "src/ast/engine.ts"))
const { getParser } = engineMod
// `RelationshipType` lives INSIDE `namespace ASTEngine` in engine.ts, so it is
// reached as `engineMod.ASTEngine.RelationshipType`. Reading it off the module's
// own exports yields undefined, which is worth stating because it is exactly the
// kind of silent-empty a gate can print a result from.
const ENGINE_ENUM: any = engineMod.ASTEngine?.RelationshipType
const typesMod: any = await import(join(REPO, "src/ast/types.ts"))
const TYPES_ENUM: any = typesMod.RelationshipType
if (!ENGINE_ENUM || !TYPES_ENUM) {
  console.error(`could not read both enums: engine.ts ASTEngine.RelationshipType=${ENGINE_ENUM ? "ok" : "MISSING"} types.ts RelationshipType=${TYPES_ENUM ? "ok" : "MISSING"}`)
  process.exit(6)
}
const engineImports = String((ENGINE_ENUM as any).Imports)
const typesImports = String((TYPES_ENUM as any).Imports)
const ALL = [...new Set(Object.values(ENGINE_ENUM as any).map(String))].sort()
const ALL_TYPES_SPELLING = [...new Set(Object.values(TYPES_ENUM as any).map(String))].sort()
console.log(`repo ${REPO}`)
console.log(`engine.ts enum (what every analyzer imports): ${ALL.length} values — ${ALL.join(" ")}`)
console.log(`types.ts enum: ${ALL_TYPES_SPELLING.length} values — ${ALL_TYPES_SPELLING.join(" ")}`)
console.log(`Imports: engine.ts="${engineImports}"  types.ts="${typesImports}"  agree=${engineImports === typesImports}`)
console.log(`  a value in engine.ts but NOT in types.ts: ${ALL.filter((v) => !ALL_TYPES_SPELLING.includes(v)).join(", ") || "(none)"}`)
console.log(`  a value in types.ts but NOT in engine.ts: ${ALL_TYPES_SPELLING.filter((v) => !ALL.includes(v)).join(", ") || "(none)"}\n`)

const argv = process.argv.slice(2)
const all = argv.includes("--all")
const named = argv.find((a) => a.endsWith("=lane"))?.slice("=lane".length)
const targets: string[] = all ? Object.keys(LANES) : named ? [named] : ["TYPESCRIPT"]

for (const L of targets) {
  const entry = LANES[L as keyof typeof LANES]
  if (!entry) { console.log(`${L}: no lane entry`); continue }
  const [lang, mod, corpusDir] = entry
  let Cls: any
  try {
    const m: any = await import(join(REPO, "src/ast", `${mod}.ts`))
    Cls = Object.values(m).find((v: any) => typeof v === "function" && String(v.name).endsWith("Analyzer"))
  } catch (e) { console.log(`${L} IMPORT FAIL ${String(e).slice(0, 80)}`); continue }
  if (!Cls) { console.log(`${L} NO ANALYZER CLASS EXPORTED`); continue }
  const dir = join(CORPUS, corpusDir)
  const files = pickFiles(dir, EXTS[lang as keyof typeof EXTS] ?? [], NFILES)
  if (!files.length) { console.log(`${L} NO CORPUS under ${corpusDir}`); continue }
  const tally = new Map<string, number>()
  const errs: string[] = []
  let parsed = 0
  for (const f of files) {
    try {
      const content = readFileSync(f, "utf8")
      const parser = await getParser(lang)
      const pr = await parser.parse(content, f)
      const res: any = new Cls().analyze(pr.rootNode, content, f)
      parsed++
      for (const r of res.relationships ?? []) {
        const t = r.relationshipType ?? r.type
        if (!t) continue
        tally.set(String(t), (tally.get(String(t)) ?? 0) + 1)
      }
    } catch (e) { errs.push(String(e).slice(0, 40)) }
  }
  const fired = [...tally.entries()].filter(([, n]) => n > 0).map(([t]) => t).sort()
  const firedInEnum = fired.filter((t) => ALL.includes(t))
  const firedOutsideEnum = fired.filter((t) => !ALL.includes(t))
  console.log(`${L.padEnd(13)} ${fired.length} labels fired   ${parsed}/${files.length} parsed${errs.length && !parsed ? `  ALL FILES FAILED: ${errs[0]}` : ""}`)
  console.log(`   ${fired.map((t) => `${t}:${tally.get(t)}`).join("  ")}`)
  console.log(`   in engine.ts enum: ${firedInEnum.length}/${ALL.length}   SILENT: ${ALL.filter((t) => !fired.includes(t)).join(" ") || "(none)"}`)
  if (firedOutsideEnum.length) console.log(`   OUTSIDE the enum (an 11th type): ${firedOutsideEnum.join(" ")}`)
  console.log("")
}
console.log("NOTE ON DIRECTION: every number above is OUTGOING ONLY. An analyzer emits edges")
console.log("from the file being analyzed; resolving who points AT a symbol is a separate")
console.log("subsystem (src/ast/graph.ts builds no reverse edges and the schema stores none),")
console.log("so a project can be 10/10 here and still have an empty incoming side.")