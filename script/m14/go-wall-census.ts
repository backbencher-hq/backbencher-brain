/**
 * GO WALL CENSUS — the D7 per-class disposition over the chunk dumps (task-38, lane `go`).
 *
 * WHAT IT IS. The go arm's shape is a CHUNKED UNION of per-repo gate runs
 * (`script/m14/go-baseline-driver.ts`); each chunk writes the gate's own per-edge DUMP to
 * `.tmp-go/dumps/<repo>.txt`. THE DUMP IS THE WHOLE NON-RESOLVED SET OF THAT CHUNK — every row the
 * arbiter did not resolve, with its outcome, its target spelling, its source file and line, and the
 * claim kind the analyzer published. This instrument reads those dumps and:
 *
 *   1. COUNTS every non-resolved row into a NAMED CLASS, by rules decidable from the dump alone
 *      (the arbiter's outcome × the target's construct × the claim kind);
 *   2. PROVES THE CLASSES PARTITION THE WALL — the per-class counts must sum EXACTLY to the wall,
 *      and the wall is re-derived from the chunk's own class columns (never taken on trust);
 *   3. REFUSES a chunk whose dump is TRUNCATED or BOUNDED, because a truncated dump is not the whole
 *      set and a census over it under-counts (the gate's own rule, `BB_DUMP_LIMIT`);
 *   4. PRINTS the arbiter's own class columns per chunk, so the reader can see the census's
 *      denominator and not only its numerator.
 *
 * WHY IT IS THE LANE'S AND NOT THE GATE'S. The gate is the ARBITER's authority and it is the
 * Lead's file (`script/m14/incoming-gate.ts`); this instrument READS the gate's output and adds no
 * verdict of its own. It never edits a dump and never re-classifies an edge: the outcome in the
 * dump is the arbiter's, verbatim.
 *
 * WHY THE CLASSES ARE SHAPE-BASED, AND WHAT THAT COSTS. This header's statement that "the gate's
 * DUMP carries no `metadata.reasonCode`" PREDATES THE LANDING and is now FALSE. The Lead landed
 * the reason columns in `script/m14/incoming-gate.ts` (commit 3122e7de6): a DUMP row is now NINE
 * tab-separated fields on EVERY line (BOUND markers included) —
 *
 *     0 DUMP · 1 label · 2 outcome · 3 target · 4 srcFile:line · 5 claim kind · 6 claim specifier
 *     7 BIND REASON      = relationship.metadata.bindReason   (verbatim, "-" when absent)
 *     8 CONFIDENCE REASON = relationship.metadata.reasonCode   (verbatim, "-" when absent)
 *
 * TWO COLUMNS, ONE QUESTION EACH, AND THEY ARE NOT THE SAME VOCABULARY. The BIND reason answers
 * "WHY DID THE ARBITER NOT BIND THIS EDGE's TARGET"; the CONFIDENCE reason answers "WHY IS THIS
 * EDGE BELOW CONFIDENCE 1.0". The BIND reason is the one that names a WALL ROW, because a wall row
 * is by definition a row the arbiter did not resolve — and the confidence reason is empty on
 * exactly those rows, because a wall row can be a whole-file-at-1.0 edge. So the classes here are
 * STILL decided by the target spelling and the claim kind, and the BIND reason now SPLITS each
 * class further. A dump written BEFORE the landing carries "-" in both fields; the census says so
 * rather than pretending the reason is known.
 *
 * USAGE
 *   bun run script/m14/go-wall-census.ts                       # census over every recorded chunk dump
 *   bun run script/m14/go-wall-census.ts --cap400 <dump>      # add a stride sample for cross-check
 *   bun run script/m14/go-wall-census.ts --json                # machine-readable
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : process.cwd()
const DUMPS = path.join(ROOT, ".tmp-go", "dumps")

/** THE ARBITER's outcomes, verbatim from `script/m14/incoming-rule.ts`'s `classifyEdge`. */
type Outcome =
  | "ambDeclOnly" | "ambBoth" | "unresolved"
  | "externalVerified" | "externalUnverified" | "externalRefuted"
  | "bindingVerified" | "bindingUnverified" | "bindingRefuted"
  | "causeDeclared" | "causeRefuted" | "resolved" | "unknown"

/** THE VERIFIED CLASS = the rows the arbiter BOUND to a declaration or CONFIRMED a claim on. */
const VERIFIED: Outcome[] = ["resolved", "externalVerified", "bindingVerified", "causeDeclared"]
/** THE WALL = everything else. A row is a wall unless the arbiter settled it. */
const WALL: Outcome[] = [
  "ambDeclOnly", "ambBoth", "unresolved",
  "externalUnverified", "externalRefuted",
  "bindingUnverified", "bindingRefuted", "causeRefuted",
]

/**
 * THE CONSTRUCT OF A TARGET, decidable from its spelling alone.
 *
 * `path`         — the target contains `/`: an IMPORT PATH. In Go a path is not a symbol, so the
 *                  arbiter's name lookup cannot answer it, and no name ever will.
 * `pkg-qualified`— the target contains a `.` whose first segment starts UPPER: a PACKAGE OR TYPE
 *                  qualifier (`fmt.Println`, `http.Client`).
 * `recv-qualified`— the target contains a `.` whose first segment starts lower: a RECEIVER
 *                  variable (`r.reader`, `t.Helper`) — the receiver's TYPE is not in the file.
 * `leaf-exported`— a bare name starting UPPER: Go's exported name.
 * `leaf-local`   — a bare name starting lower: Go's package-local name.
 */
type Construct = "path" | "pkg-qualified" | "recv-qualified" | "leaf-exported" | "leaf-local"

function constructOf(target: string): Construct {
  if (target.includes("/")) return "path"
  if (target.includes(".")) {
    const head = target.slice(0, target.indexOf("."))
    return head.length > 0 && head[0] === head[0].toUpperCase() && head[0] !== head[0].toLowerCase()
      ? "pkg-qualified" : "recv-qualified"
  }
  return target.length > 0 && target[0] === target[0].toUpperCase() && target[0] !== target[0].toLowerCase()
    ? "leaf-exported" : "leaf-local"
}

type Row = {
  type: string
  outcome: Outcome
  target: string
  construct: Construct
  claim: string
  reason: string
  confReason: string
  src: string
}

type Chunk = {
  name: string
  rows: Row[]
  truncated: boolean
  bound: number | null
}

/** A DUMP IS COMPLETE OR IT IS NOT — the gate's own rule, enforced here. */
function readChunk(file: string): Chunk {
  const name = path.basename(file)
  let text: string
  try { text = fs.readFileSync(file, "utf8") } catch { return { name, rows: [], truncated: true, bound: null } }
  const rows: Row[] = []
  let truncated = false
  let bound: number | null = null
  for (const line of text.split("\n")) {
    if (line.startsWith("DUMP TRUNCATED")) { truncated = true; continue }
    if (!line.startsWith("DUMP\t")) continue
    const f = line.split("\t")
    if (f[1] === "BOUND" && f[2] === "REACHED") { truncated = true; bound = Number(f[3]); continue }
    if (f.length < 5) continue
    const target = f[3] ?? ""
    rows.push({
      type: f[1]!,
      outcome: (f[2] ?? "unknown") as Outcome,
      target,
      construct: constructOf(target),
      claim: f[5] ?? "-",
      // FIELD 7 IS THE BIND REASON — `relationship.metadata.bindReason`, verbatim. It names WHY
      // the ARBITER could not bind this row's target, which is the question a WALL ROW needs
      // answered. A dump written before the Lead's landing (3122e7de6) carries "-" here, and the
      // census says so rather than pretending the reason is known.
      reason: f[7] ?? "-",
      // FIELD 8 IS THE CONFIDENCE REASON — `relationship.metadata.reasonCode`, verbatim. It names
      // WHY the edge is below confidence 1.0, which is a DIFFERENT question: it is empty on
      // exactly the whole-file-at-1.0 rows that are walls. Kept separate so no reader has to
      // guess which vocabulary a class is holding.
      confReason: f[8] ?? "-",
      src: f[4] ?? "",
    })
  }
  return { name, rows, truncated, bound }
}

/**
 * THE NAMED CLASS. The class NAME is the construct and the outcome, so the class is decidable by a
 * reader from the dump row itself; the DISPOSITION is a separate, stated judgement.
 */
function classOf(r: Row): string {
  let k = `${r.type} · ${r.outcome} · ${r.construct}`
  if (r.claim !== "-") k += ` · claim:${r.claim}`
  // THE CLASS NAME SAYS WHICH VOCABULARY IT IS HOLDING. `bind:` is the reason the ARBITER could
  // not bind the target (the wall question); `conf:` is the reason the edge is below confidence
  // 1.0 (a different question). They are different fields with different jobs, and a reader must
  // not have to guess which one a class is holding.
  if (r.reason !== "-") k += ` · bind:${r.reason}`
  if (r.confReason !== "-") k += ` · conf:${r.confReason}`
  return k
}

type Disposition = "RESOLVED" | "CLAIMED" | "INSTRUMENT GAP" | "RULED UNDECIDABLE" | "WALL"

const VERDICT_DISPOSITION: Record<string, Disposition> = {
  resolved: "RESOLVED",
  externalVerified: "CLAIMED",
  bindingVerified: "CLAIMED",
  causeDeclared: "CLAIMED",
  ambDeclOnly: "INSTRUMENT GAP",
  ambBoth: "INSTRUMENT GAP",
  unresolved: "INSTRUMENT GAP",
  externalUnverified: "INSTRUMENT GAP",
  externalRefuted: "INSTRUMENT GAP",
  bindingUnverified: "INSTRUMENT GAP",
  bindingRefuted: "INSTRUMENT GAP",
  causeRefuted: "INSTRUMENT GAP",
}

/**
 * THE D7 DISPOSITION, KEYED ON THE BIND REASON — and every entry CARRIES ITS PRICE.
 *
 * WHY A REASON-KEYED DISPOSITION AND NOT AN OUTCOME-KEYED ONE. The outcome says what the arbiter
 * did; the BIND REASON says WHICH STEP failed, and only the second one can be priced. An
 * outcome-keyed table maps every wall outcome to one verdict, which is a wall MERELY NAMED — the
 * failure mode the D7 rule exists to prevent. So the disposition is decided by the reason, and
 * the price is the instrument change that would decide the class for good.
 *
 * THE VOCABULARY IS THE ANALYZER's OWN (`src/ast/real-go-analyzer.ts`, `GO_SUB_UNIT_REASON`), read
 * verbatim out of the dump's field 7. A reason the table does not know is a DISCLOSED GAP, not a
 * silent default: it is reported as `INSTRUMENT GAP (UNPRICED)` so a reader can see the table
 * needs a row, instead of reading a default as a decision.
 */
const REASON_DISPOSITION: Record<string, { disposition: Disposition; price: string }> = {
  // ── THE LEAF-NAME CLASSES: the analyzer publishes a LEAF name and the owner that would
  // identify it is not resolved within the file the edge came from. The price is the analyzer
  // publishing the QUALIFIED name (pkg.Name / Type.Name) the arbiter can join, which is the
  // change that closed the exports/extends/implements labels at the arbiter's own-file tie-break.
  callee_recorded_as_a_leaf_name_whose_owner_is_not_resolved_per_file: {
    disposition: "INSTRUMENT GAP",
    price: "the analyzer would have to publish the call's QUALIFIED callee (pkg.Callee) instead of the leaf, and the arbiter would have to join it — the same two changes that closed three whole labels",
  },
  goroutine_call_recorded_as_a_leaf_name_whose_owner_is_not_resolved_per_file: {
    disposition: "INSTRUMENT GAP",
    price: "as above: the go keyword's callee would have to be published qualified",
  },
  deferred_call_recorded_as_a_leaf_name_whose_owner_is_not_resolved_per_file: {
    disposition: "INSTRUMENT GAP",
    price: "as above: the deferred callee would have to be published qualified",
  },
  used_identifier_recorded_as_a_leaf_whose_declaring_file_is_out_of_scope: {
    disposition: "INSTRUMENT GAP",
    price: "a project-wide declaration lookup for the used identifier — the same per-file owner limit as the call class",
  },
  field_leaf_read_whose_receiver_type_is_not_resolved_per_file: {
    disposition: "INSTRUMENT GAP",
    price: "the RECEIVER's TYPE would have to be resolved before the field can be bound; the edge does not carry it, so this needs a type step the analyzer does not take",
  },
  channel_leaf_read_without_its_element_type: {
    disposition: "INSTRUMENT GAP",
    price: "the channel's ELEMENT TYPE would have to be resolved — a type step, not a name step",
  },
  declared_type_leaf_whose_declaring_file_is_out_of_scope: {
    disposition: "INSTRUMENT GAP",
    price: "a project-wide declaration lookup for the referenced type",
  },
  qualified_type_reference_whose_declaring_file_is_out_of_scope: {
    disposition: "INSTRUMENT GAP",
    price: "a project-wide declaration lookup for the referenced type",
  },
  exported_name_recorded_as_a_leaf_whose_owning_package_is_not_the_target: {
    disposition: "INSTRUMENT GAP",
    price: "the export's OWNING PACKAGE would have to be published with the edge, so the arbiter can bind the name inside the package that owns it",
  },
  implemented_interface_recorded_as_a_leaf_whose_declaring_file_is_out_of_scope: {
    disposition: "INSTRUMENT GAP",
    price: "a project-wide declaration lookup for the implemented interface",
  },
  // ── THE MODULE-PATH CLASS: the target of an `imports` edge is a MODULE PATH, not a symbol.
  // No amount of name resolution can bind it to a declaration, because there is no declaration
  // on the other side of it. The class is a fact about the TYPE of the edge.
  target_is_a_module_path_not_a_symbol: {
    disposition: "INSTRUMENT GAP",
    price: "the project's own facts — the list of its modules — shared by the arbiter, so a module path can be resolved to the module it names; the STDLIB subset of this class is already CLAIMED by the truthful `isStdlib` evidence the analyzer publishes",
  },
  // ── THE EMBEDDING CLASSES: Go's embedding and interface inclusion are method-set
  // inclusions, not declared supertypes, so there is no supertype edge to resolve.
  promotion_by_embedding_not_a_declared_supertype: {
    disposition: "INSTRUMENT GAP",
    price: "the embedded type would have to be resolved to the field/method set it contributes — a set, not a declaration",
  },
  interface_method_set_inclusion_not_a_declared_supertype: {
    disposition: "INSTRUMENT GAP",
    price: "the included interface would have to be resolved to its method set — a set, not a declaration",
  },
  type_read_from_a_composite_literal_whose_declaration_may_be_in_another_file: {
    disposition: "INSTRUMENT GAP",
    price: "a project-wide declaration lookup for the composite literal's type",
  },
  // ── THE TWO CLASSES THAT NO INSTRUMENT IN THE TREE DECIDES.
  pascal_case_name_is_a_constructor_convention_with_no_declaration: {
    disposition: "RULED UNDECIDABLE",
    price: "NOTHING IN THE TREE DECIDES IT: a PascalCase name with no declaration is a CONVENTION (a constructor call), not a fact the analyzer can read. The falsifier is a project-wide declaration lookup that FINDS NO DECLARATION for the name — at which point the convention is confirmed and the row is a wall by construction, not by instrument gap",
  },
  promoted_method_recorded_with_its_qualified_owner_whose_declaring_file_is_out_of_scope: {
    disposition: "RULED UNDECIDABLE",
    price: "NOTHING IN THE TREE DECIDES IT: a promoted method is shadowed or not by whether the OUTER type declares it, and the outer type's declaring file is not resolved. The falsifier is the same project-wide owner resolution the other classes need — but even with it, the question is a METHOD SET question (does the outer type declare this name?), and no edge carries that",
  },
}

function main(): void {
  const args = process.argv
  const json = args.includes("--json")
  const capIdx = args.indexOf("--cap400")
  const cap400 = capIdx >= 0 ? args[capIdx + 1] ?? null : null

  const files: string[] = []
  try {
    for (const repo of fs.readdirSync(DUMPS)) if (repo.endsWith(".txt")) files.push(path.join(DUMPS, repo))
  } catch { /* no dumps recorded */ }
  files.sort()
  if (cap400) files.push(path.resolve(cap400))

  const chunks = files.map(readChunk)
  const perChunk: { name: string; rows: number; wall: number; verified: number; truncated: boolean; bound: number | null }[] = []
  const classCounts = new Map<string, number>()
  const classDispositions = new Map<string, Disposition>()
  const classPrices = new Map<string, string>()
  const typeTotals = new Map<string, { edges: number; wall: number; verified: number }>()
  let totalRows = 0, totalWall = 0, totalVerified = 0
  const refused: string[] = []
  let reasonCarried = 0
  let confCarried = 0

  for (const c of chunks) {
    let wall = 0, verified = 0
    for (const r of c.rows) {
      totalRows++
      const t = typeTotals.get(r.type) ?? { edges: 0, wall: 0, verified: 0 }
      t.edges++
      if (VERIFIED.includes(r.outcome)) { verified++; t.verified++ } else { wall++; t.wall++ }
      typeTotals.set(r.type, t)
      if (!VERIFIED.includes(r.outcome)) {
        const key = classOf(r)
        classCounts.set(key, (classCounts.get(key) ?? 0) + 1)
        if (!classDispositions.has(key)) {
          // THE DISPOSITION IS DECIDED BY THE BIND REASON when the row carries one. A row whose
          // reason the table does not know is reported as `INSTRUMENT GAP (UNPRICED)` — a
          // DISCLOSED GAP, not a silent default: a reader must be able to see that the table
          // needs a row, instead of reading a default as a decision.
          const d = r.reason !== "-" ? REASON_DISPOSITION[r.reason] : undefined
          if (d) {
            classDispositions.set(key, d.disposition)
            classPrices.set(key, d.price)
          } else if (r.reason !== "-") {
            classDispositions.set(key, "INSTRUMENT GAP")
            classPrices.set(key, "UNPRICED — this bind reason is not in the census's disposition table; the table needs a row for it")
          } else {
            classDispositions.set(key, VERDICT_DISPOSITION[r.outcome] ?? "INSTRUMENT GAP")
            classPrices.set(key, "the dump row carries NO bind reason, so the class can only be priced by its outcome")
          }
        }
        if (r.reason !== "-") reasonCarried++
        if (r.confReason !== "-") confCarried++
      }
    }
    totalWall += wall
    totalVerified += verified
    perChunk.push({ name: c.name, rows: c.rows.length, wall, verified, truncated: c.truncated, bound: c.bound })
    if (c.truncated) refused.push(c.name)
  }

  if (json) {
    console.log(JSON.stringify({
      chunks: perChunk, refusedTruncated: refused,
      classCounts: Object.fromEntries([...classCounts.entries()].sort()),
      dispositions: Object.fromEntries(classDispositions),
      prices: Object.fromEntries(classPrices),
      perType: Object.fromEntries([...typeTotals.entries()].sort()),
      totals: { rows: totalRows, wall: totalWall, verified: totalVerified, wallWithBindReason: reasonCarried, wallWithConfidenceReason: confCarried },
      closure: { classSum: [...classCounts.values()].reduce((a, b) => a + b, 0), wall: totalWall, exact: [...classCounts.values()].reduce((a, b) => a + b, 0) === totalWall },
    }, null, 1))
    process.exit(refused.length > 0 ? 2 : 0)
  }

  console.log("GO WALL CENSUS — the D7 per-class disposition over the recorded chunk dumps")
  console.log(`  dumps read: ${chunks.length} · dump rows: ${totalRows.toLocaleString("en-US")} · wall rows: ${totalWall.toLocaleString("en-US")} · verified rows: ${totalVerified.toLocaleString("en-US")}`)
  // TWO METRICS, EACH NAMING THE VOCABULARY IT IS HOLDING — the field 7 / field 8 split.
  console.log(`  wall rows carrying a BIND reason (field 7 · metadata.bindReason · why the arbiter could not bind the target): ${reasonCarried.toLocaleString("en-US")} of ${totalWall.toLocaleString("en-US")}${reasonCarried === 0 ? "  ** the dumps predate the reason columns — the classes below are SHAPE-ONLY **" : ""}`)
  console.log(`  wall rows carrying a CONFIDENCE reason (field 8 · metadata.reasonCode · why the edge is below 1.0): ${confCarried.toLocaleString("en-US")} of ${totalWall.toLocaleString("en-US")}${confCarried === 0 ? "  ** expected on a whole-file-at-1.0 wall: the confidence reason answers a DIFFERENT question **" : ""}`)
  console.log("")
  console.log("PER CHUNK (the denominator, per chunk):")
  for (const c of perChunk) {
    console.log(`  ${c.name.padEnd(26)} rows ${String(c.rows).padStart(9)} · wall ${String(c.wall).padStart(9)} · verified ${String(c.verified).padStart(8)}${c.truncated ? `  ** TRUNCATED${c.bound !== null ? ` at the ${c.bound}-row bound` : ""} — NOT A CENSUS **` : ""}`)
  }
  if (refused.length > 0) {
    console.log("")
    console.log(`** ${refused.length} chunk dump(s) ARE TRUNCATED OR BOUNDED — THE CENSUS BELOW IS **NOT** A COMPLETE CENSUS FOR THOSE CHUNKS **`)
  }
  console.log("")
  console.log("THE NAMED CLASSES (the wall, partitioned):")
  const sorted = [...classCounts.entries()].sort((a, b) => b[1] - a[1])
  for (const [k, n] of sorted) {
    console.log(`  ${String(n).padStart(9)}  ${classDispositions.get(k) ?? "INSTRUMENT GAP"}  ${k}`)
  }
  const classSum = sorted.reduce((a, [, n]) => a + n, 0)
  console.log("")
  console.log(`  CLASS SUM ${classSum.toLocaleString("en-US")}  ·  WALL ${totalWall.toLocaleString("en-US")}  ·  ${classSum === totalWall ? "** EXACT — THE CLASSES PARTITION THE WALL **" : "** MISMATCH — THE CLASSES DO NOT PARTITION THE WALL **"}`)
  console.log("")
  console.log("THE PRICE OF EACH CLASS (what instrument change would decide it for good):")
  for (const [k] of sorted) {
    console.log(`  ${(classDispositions.get(k) ?? "INSTRUMENT GAP").padEnd(20)} ${k}`)
    console.log(`  ${"".padEnd(20)}   PRICE: ${classPrices.get(k) ?? "UNPRICED"}`)
  }
  console.log("")
  console.log("PER TYPE (wall / verified):")
  for (const [t, v] of [...typeTotals.entries()].sort()) {
    console.log(`  ${t.padEnd(14)} edges ${String(v.edges).padStart(9)} · wall ${String(v.wall).padStart(9)} · verified ${String(v.verified).padStart(8)}`)
  }
  process.exit(refused.length > 0 ? 2 : 0)
}

main()
