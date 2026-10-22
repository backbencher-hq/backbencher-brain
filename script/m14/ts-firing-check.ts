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
// So this copy makes exactly three changes and keeps everything else:
//
//   1. REPO resolves to this worktree, from the script's own location, so the
//      number describes the branch being reviewed.
//   2. The enum is read from `src/ast/engine.ts` — the namespace all 48
//      real-*-analyzer.ts files import — and the `src/ast/types.ts` spelling is
//      read too and printed beside it, so the split is visible in the output
//      instead of inferred from a SILENT line.
//   3. THE POPULATION IS THE ROUTER'S ONE TABLE AND THE GATE'S OWN ADMISSION RULE — 2026-10-22.
//
//   ⇒⇒⇒ WHY 3. This file carried its OWN per-language extension list, and the Lead's
//   `script/m14/shape-agreement-scan.ts` found it: the copy said `typescript: [".ts",
//   ".tsx"]` while the router's one table says `typescript: "ts,tsx,mts,cts"` — so this
//   instrument was measuring a population that EXCLUDED `.mts` and `.cts`, while the gate
//   and the denominators counted them. ⇒⇒⇒ **THE INSTRUMENT AND THE DENOMINATOR MUST COUNT
//   THE SAME POPULATION**, and a table duplicated in two places is one table that WILL
//   diverge. It did. The fix is not to edit the copy — it is that THERE IS NO SECOND COPY:
//   `script/m14/language-extensions.ts` is THE ONE TABLE and every consumer reads it.
//
//   ⇒⇒⇒ AND THE POPULATION WAS NOT EVEN REACHABLE. This file picked its corpus by a
//   directory NAMED AFTER THE LANE (`<corpus>/typescript`), and the corpus is REPO-NAMED
//   (202 repositories under `.corpus`) — so for the typescript lane there was no such
//   directory, and the instrument printed `TYPESCRIPT NO CORPUS under typescript` and
//   measured NOTHING. ⇒⇒⇒ **A CLEAN-LOOKING ZERO OVER AN EMPTY POPULATION**: the same shape
//   the one-table file's own header records for the cpp lane's heritage probe (a probe whose
//   hand-written map had no `cpp` entry, so it printed "population: 0 GIT-TRACKED admitted
//   files" and "UNCOVERED 0" and exited 0). ⇒⇒⇒ So the fix is BOTH: read the one table, AND
//   admit files the way the gate admits them — git-tracked, extension-admitted, at most the
//   gate's 1 MB SIZE_CAP, present on disk — over the corpus ROOT, not over a lane-named
//   directory.
//
//   ⇒⇒⇒ THE NUMBER BEFORE AND AFTER IS PRINTED BY THIS INSTRUMENT, from its own walk: the
//   admitted count per extension, the over-cap and absent exclusions, and the sample it
//   actually read. The BEFORE is in the record: the population was EMPTY.
//
// The tally logic and the 120-file sample are unchanged, so the labels this instrument
// reports are comparable to the master's. `--all` walks the same lane table.
//
// NO REGEX in anything this lane wrote: the file picker's directory skips use
// startsWith/endsWith/indexOf, and the analyzer-class probe reads the export name
// and tests its suffix with endsWith. (The shared original uses patterns in both
// places; that is its code and is reported, not edited.)
//
// Usage: bun run script/m14/ts-firing-check.ts [--files N] [--all]
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
// ⇒⇒⇒ THE TWO THINGS THIS INSTRUMENT USED TO KEEP ITS OWN COPY OF, IT NOW IMPORTS.
//
// 1. THE ROUTER'S ONE TABLE — `script/m14/language-extensions.ts` holds every lane's spellings and
//    exports `extensionsFor(language)`. `script/m14/incoming-gate.ts` — the gate that computes the
//    denominator — calls THAT function, so reading it here is not a convenience: it is the only
//    way this instrument's population can BE the denominator's population.
// 2. THE ADMISSION RULE — `script/m14/ts-corpus.ts` walks the corpus ROOT with the gate's own
//    rule (real git checkout, `git ls-files`, extension from the one table, the gate's 1 MB cap,
//    present on disk) and returns the population WITH ITS DIGEST. A second copy of that rule
//    would be a second copy of the denominator, which this lane has already paid for twice: a
//    hand-written extension map, and a lane-named corpus directory that did not exist.
//    ⇒⇒⇒ **ONE RULE, ONE PLACE.**
import { admitCorpusCached, extensionsFor, strideSample, populationLine } from "./ts-corpus"

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const NFILES = Number(process.env.NFILES ?? 120)

// ⇒⇒⇒ THE LANE TABLE CARRIES THE ANALYZER CLASS AND THE LANE NAME — AND NOTHING ELSE. The third
// element used to be a corpus directory named after the LANE, which was a SECOND, SILENT COPY OF
// THE POPULATION (the corpus is REPO-NAMED, so the typescript lane's directory did not exist and
// this instrument printed a clean-looking zero over an empty population).
const LANES = {
  TYPESCRIPT: ["typescript", "real-typescript-analyzer"],
  JAVASCRIPT: ["javascript", "real-javascript-analyzer"],
  VUE: ["vue", "real-vue-analyzer"],
  SVELTE: ["svelte", "real-svelte-analyzer"],
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
  const [lang, mod] = entry
  let Cls: any
  try {
    const m: any = await import(join(REPO, "src/ast", `${mod}.ts`))
    Cls = Object.values(m).find((v: any) => typeof v === "function" && String(v.name).endsWith("Analyzer"))
  } catch (e) { console.log(`${L} IMPORT FAIL ${String(e).slice(0, 80)}`); continue }
  if (!Cls) { console.log(`${L} NO ANALYZER CLASS EXPORTED`); continue }
  // ⇒⇒⇒ THE EXTENSION LIST IS THE ROUTER'S ONE TABLE, READ — NOT A COPY. `extensionsFor` is the
  // same function `script/m14/incoming-gate.ts` calls, so the instrument's population and the
  // denominator's population cannot drift apart: there is no second list to drift.
  const exts = extensionsFor(lang)
  const admitted = admitCorpusCached(CORPUS, exts, join(REPO, `.tmp-ts/admitted-${lang}.json`))
  const extRows = [...admitted.byExt.entries()].sort().map(([e, r]) =>
    `${e}: tracked ${r.tracked} · admitted ${r.admitted}${r.overCap ? ` · overCap ${r.overCap}` : ""}${r.absent ? ` · absent ${r.absent}` : ""}`).join("   |   ")
  console.log(`${L}  admitted extensions ${exts.join(" ")}  (THE ROUTER'S ONE TABLE, script/m14/language-extensions.ts — read, not copied)`)
  console.log(`   POPULATION: ${populationLine(admitted)}`)
  console.log(`   population digest: ${admitted.digest}  (sha256 of the sorted admitted paths — a COUNT is not an IDENTITY)`)
  console.log(`   per extension: ${extRows}`)
  if (!admitted.files.length) { console.log(`${L} NO ADMITTED FILES under ${CORPUS} — the population is EMPTY and every number below would be a zero over nothing`); continue }
  const files = strideSample(admitted.files, NFILES)
  console.log(`   sample: ${files.length} of ${admitted.files.length} files, a stride over the admitted set (not one repository)`)
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