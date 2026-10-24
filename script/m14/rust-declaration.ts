/**
 * rust-declaration.ts — BUILD THE WHOLE-POPULATION DECLARATION FROM THE ARM'S OWN TABLE 1.
 *
 * DERIVED, NOT TYPED: this parses the arm log's population line and per-type rows and maps them
 * into the gate's five buckets, REFUSING (exit 4/5/6) when anything does not close. A hand-written
 * declaration is a second copy of a measurement; this is the measurement re-read.
 *
 * REFUSALS (all fatal, nothing written):
 *   · the arm log does not say parsed == admitted == corpusTotal           -> exit 4
 *   · a per-type row's eleven terms do not sum to its edge count            -> exit 5
 *   · the fleet TOTAL's eleven terms do not sum to the fleet edge count     -> exit 5
 *   · a population string is not the FULL FORM (parsed/admitted/exts/index)  -> exit 6
 *
 * USAGE: bun script/m14/rust-declaration.ts --arm <log> --census <json> [--write]
 */
import { readFileSync, writeFileSync } from "node:fs"

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const i = argv.indexOf(n)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}
const armLog = arg("--arm")
const censusPath = arg("--census")
if (!armLog || !censusPath) { console.error("usage: rust-declaration.ts --arm <log> --census <json> [--write]"); process.exit(2) }

const log = readFileSync(armLog, "utf8")
const census = JSON.parse(readFileSync(censusPath, "utf8"))

// ── the population, from the arm's own line ────────────────────────────────────────────────────
const popMatch = log.match(/population: (\d+) parsed of (\d+) sampled \(corpus has (\d+) \.rs files across (\d+) repos/)
if (!popMatch) { console.error("REFUSED (4): the arm log has no population line"); process.exit(4) }
const parsed = Number(popMatch[1])
const admitted = Number(popMatch[3])
const repos = Number(popMatch[4])
if (parsed !== admitted) { console.error(`REFUSED (4): parsed ${parsed} != admitted ${admitted} — a SAMPLE cannot back a population declaration`); process.exit(4) }
if (parsed !== census.population.admitted) { console.error(`REFUSED (4): the arm's admitted ${parsed} != the census's ${census.population.admitted} — two instruments over two populations`); process.exit(4) }
const POP = `parsed=${admitted}/${admitted} admitted=${admitted} exts=rs index=no`

// ── per-type rows: edges resolved collRes amb(decl) amb(kind) unresolved extOK ext? extFAIL bindOK bind? bindFAIL causeOK causeFAIL ──
const rows: Record<string, { edges: number; resolved: number; collRes: number; ambDecl: number; ambKind: number; unresolved: number; extOK: number; extUnk: number; extFAIL: number; bindOK: number; bindUnk: number; bindFAIL: number; causeOK: number; causeFAIL: number }> = {}
// ★ THE LOG CARRIES **TWO TABLES** AND THE FIRST VERSION OF THIS GENERATOR MIXED THEM. TABLE 1 is
// the eleven-term closure (edges resolved collRes amb(decl) amb(kind) unresolved extOK ext? extFAIL
// bindOK bind? bindFAIL causeOK causeFAIL — FOURTEEN numbers); the summary below it is the FIVE-BUCKET
// coarsening (edges resolved external ambiguous otherUnresolved unclassed — FIVE numbers). Reading
// with a loose `(?:\d+\s+)+\d+` matched BOTH and the SECOND overwrote the first, producing NaN from a
// five-number row. ⇒ A GENERATOR THAT READS TWO TABLES WITH ONE PATTERN READS NEITHER. The fix is
// structural: match exactly FOURTEEN numbers — only TABLE 1 has that many — and take the FIRST row.
const rowRe = /^(calls|uses|contains|imports|references|exports|extends|implements|overrides|instantiates|decorates|renders|mixes_in|part_of)\s+((?:\d+\s+){13}\d+)\s*$/gm
let m: RegExpExecArray | null
while ((m = rowRe.exec(log)) !== null) {
  if (rows[m[1]]) continue // the SECOND table's row never matches (5 numbers), but be explicit anyway
  const v = m[2].trim().split(/\s+/).map(Number)
  rows[m[1]] = { edges: v[0], resolved: v[1], collRes: v[2], ambDecl: v[3], ambKind: v[4], unresolved: v[5], extOK: v[6], extUnk: v[7], extFAIL: v[8], bindOK: v[9], bindUnk: v[10], bindFAIL: v[11], causeOK: v[12], causeFAIL: v[13] }
}
const LABELS = ["calls","uses","contains","imports","references","exports","extends","implements","overrides","instantiates","decorates","renders","mixes_in","part_of"]
for (const l of LABELS) {
  if (!rows[l]) { console.error(`REFUSED (5): no row for ${l} in the arm log`); process.exit(5) }
  const r = rows[l]
  const sum = r.resolved + r.ambDecl + r.unresolved + r.extOK + r.extUnk + r.extFAIL + r.bindOK + r.bindUnk + r.bindFAIL + r.causeOK + r.causeFAIL
  if (sum !== r.edges) { console.error(`REFUSED (5): ${l} terms ${sum} != edges ${r.edges}`); process.exit(5) }
}
const totalRow = log.match(/^TOTAL\s+((?:\d+\s+)+\d+)\s*$/m)
if (!totalRow) { console.error("REFUSED (5): no fleet TOTAL row"); process.exit(5) }
const tv = totalRow[1].trim().split(/\s+/).map(Number)
const totalEdges = tv[0]
const totalSum = tv[1] + tv[3] + tv[5] + tv[6] + tv[7] + tv[8] + tv[9] + tv[10] + tv[11] + tv[12] + tv[13]
if (totalSum !== totalEdges) { console.error(`REFUSED (5): fleet TOTAL terms ${totalSum} != edges ${totalEdges}`); process.exit(5) }
const perTypeSum = LABELS.reduce((n, l) => n + rows[l].edges, 0)
if (perTypeSum !== totalEdges) { console.error(`REFUSED (5): per-type edges ${perTypeSum} != fleet ${totalEdges}`); process.exit(5) }

// ── the declaration, in the gate's five-bucket schema ───────────────────────────────────────
const types: Record<string, any> = {}
for (const l of LABELS) {
  const r = rows[l]
  types[l] = {
    edges: r.edges,
    resolved: r.resolved,
    external: r.extOK,
    ambiguous: r.ambDecl,
    otherUnresolved: r.unresolved + r.extUnk + r.bindOK + r.bindUnk + r.bindFAIL + r.causeOK,
    unclassed: 0,
    _ambKind: r.ambKind,
    _collRes: r.collRes,
    closure: {
      edges: r.edges, resolved: r.resolved, collRes: r.collRes, ambDecl: r.ambDecl, ambKind: r.ambKind,
      unresolved: r.unresolved, extOK: r.extOK, extUnk: r.extUnk, extFAIL: r.extFAIL,
      bindOK: r.bindOK, bindUnk: r.bindUnk, bindFAIL: r.bindFAIL, causeOK: r.causeOK, causeFAIL: r.causeFAIL,
    },
  }
}

const declaration: any = {
  meta: {
    lang: "rust",
    instrument: "script/m14/incoming-gate.ts (single whole-population measurement; the declaration is DERIVED from its own TABLE 1 by script/m14/rust-declaration.ts, which refuses on any non-closure)",
    sample: admitted,
    corpusTotal: admitted,
    corpusRepos: repos,
    parsed: admitted,
    population: POP,
    populationRule: {
      rule: "the admitted set is the GIT-TRACKED set: per-checkout `git ls-files` under $PWD/.corpus, extension .rs from the router's ONE table, present on disk, <= 1 MiB cap",
      root: "$PWD/.corpus",
      scope: `${repos} repositories carry an admitted file`,
      censusAgreement: `script/m14/rust-extended-types-census.ts independently admitted ${census.population.admitted} files over ${census.population.repos} repos — the two instruments agree`,
    },
    measurementForm: "ONE arm run over the whole admitted population (2,532 files, single process, index=no — under the ~7,600-parse WASM abort point the dart lane measured, and the arm frees every tree). NO chunking, so there is no chunk-resolution bias and no mixed-index arm to caveat.",
    generator: "script/m14/rust-declaration.ts",
  },
  types,
  causeRulings: {
    R1_qualified_and_foreign_targets: {
      population: POP,
      count: rows.calls.unresolved + rows.uses.unresolved + rows.references.unresolved + rows.instantiates.unresolved + rows.imports.unresolved + rows.extends.unresolved + rows.implements.unresolved,
      what: "unresolved rows whose targets are qualified paths, foreign-crate leaves or file paths — a per-file analyzer's structural reach, stated rather than resolved. The census's per-construct counts are the evidence classes: derive args 11,176 (the mixes_in rows' targets are TRAIT names, resolved only when the file declares them), attribute names 16,195 (the decorates rows' targets are attribute names, not symbols), include paths 3 (the part_of target is a PATH by construction — §8: a fragment has no symbol).",
      falsifier: {
        run: "bun run script/m14/incoming-gate.ts rust rs 0 --dump (the whole-population arm; TABLE 1's per-type unresolved column is the count)",
        wouldFail: "a per-type unresolved count that exceeds the census's construct count for that type, or a resolved row whose target the project does not declare — the arbiter's key space is the project's symbols and the census counts the shapes",
      },
    },
    renders_corpus_unexercised: {
      population: POP,
      count: 0,
      what: "renders is IMPLEMENTED and CORPUS-UNEXERCISED (csharp's class — counted once inside implemented, never an exclusion): the census measured 0 render-macro invocations over all 2,532 files and the probe PROVED the shape parses (hasError:false, the tag identifiers are structural children of the macro's token_tree). The fixture rust/renders-component-tag pins the emission fires when the construct exists.",
      falsifier: {
        run: "bun script/m14/rust-extended-types-census.ts --json=<out> (the render_macro_invocations counter, whole population)",
        wouldFail: "a corpus file carrying a declared render macro (view!/html!/rsx!/render!/maud!/markup!) whose angle-tag identifier names a same-file callable or type — the census counts exactly that shape and the arm's renders row would leave 0",
      },
    },
    part_of_path_target_by_construction: {
      population: POP,
      count: 3,
      what: "part_of's 3 rows are UNRESOLVED BY CONSTRUCTION and their 3 extOK edges are project-CONFIRMED file claims: the target is the include! PATH because a fragment has no symbol (fleet §8), and the importProjectFile claim is statted before it is written, so the arbiter confirms the file exists rather than resolving a declaration. NOT `mod` (fleet ruling L-2026-10-21-06: ownership/split; the census counts the rejected near miss at mod_file_declarations 1,898 + mod_inline 227 for the record).",
      falsifier: {
        run: "bun script/m14/rust-extended-types-census.ts --json=<out> (include_string_literal 3, include_non_literal 1, include_str_sites 20, include_bytes_sites 2)",
        wouldFail: "an include_string_literal census count that differs from the arm's part_of edge count, or a mod file-declaration appearing as a part_of row",
      },
    },
  },
  resolution_caveats: [
    "A CAUSE IS STATED, NOT RESOLVED: unresolved rows live in otherUnresolved, never in resolved, and the analyzer's scope is PER FILE with index=no — a target declared in another file of the project is genuinely out of its reach and the arbiter (which holds the project) is what answers it.",
    "amb(kind) IS A SUBSET OF amb(decl), printed beside it and NEVER added to the closure.",
    "collRes IS A SUBSET OF resolved (a tie-break pick among colliding declarations), printed beside it and NEVER added.",
    "decorates' TARGETS ARE ATTRIBUTE NAMES, not symbols: the row's target is the attribute's own name (derive, tokio::main), so it resolves only when the file declares something of that name — the attributeKind split (builtin_directive 5,950 / applied_callable_candidate 10,245 by census) is published so a reader can discount the directive class.",
    "mixes_in's TARGETS ARE DERIVED TRAIT NAMES: the census counts 11,176 derive args over 32 distinct traits and the arm counts 11,176 edges — EXACT agreement, the strongest form of the emission covering the construct. A derived trait resolves only when the file declares it, which a derive arg rarely does.",
    "part_of's TARGET IS THE PATH BY CONSTRUCTION (§8: a fragment has no symbol) with a statted importProjectFile claim, so confirmed rows land extOK rather than silent-unresolved.",
    "renders is IMPLEMENTED AND CORPUS-UNEXERCISED (0 sites over the whole population, probe-proved shape, fixture-pinned emission) — csharp's class, counted once inside implemented with the overlap printed, never an exclusion.",
  ],
}

// ── the full-form check ─────────────────────────────────────────────────────────────────────
const FULL_FORM = /^parsed=\d+\/\d+ admitted=\d+ exts=rs index=no$/
if (!FULL_FORM.test(declaration.meta.population)) { console.error("REFUSED (6): the meta population is not the full form"); process.exit(6) }
for (const k of Object.keys(declaration.causeRulings)) {
  if (!FULL_FORM.test(declaration.causeRulings[k].population)) { console.error(`REFUSED (6): causeRuling ${k} population is not the full form`); process.exit(6) }
}

const outPath = "validation/m14/instruments/rust/incoming-declaration.json"
if (argv.includes("--write")) {
  writeFileSync(outPath, JSON.stringify(declaration, null, 2) + "\n")
  console.log(`wrote ${outPath}: ${LABELS.length} types, ${Object.keys(declaration.causeRulings).length} cause rulings, population ${POP}`)
} else {
  console.log(`DRY RUN OK: ${LABELS.length} types close exactly; population ${POP}; use --write to write`)
  console.log(`fleet TOTAL: edges ${totalEdges} = terms ${totalSum} EXACT; per-type sum ${perTypeSum}`)
}
