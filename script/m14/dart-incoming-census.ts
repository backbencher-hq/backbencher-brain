/**
 * dart-incoming-census — WHAT the dart lane's non-resolved edges ARE, by cause, with counts.
 *
 * WHY THIS EXISTS. The incoming gate's TABLE 1 says `calls unresolved 438` on a cap-50 run. A
 * number like that cannot be worked: it does not say whether the backlog is (a) a receiver the
 * analyzer cannot type, (b) a declaration that lives in a file the stride sample did not admit,
 * (c) a dependency this checkout does not carry, or (d) a target the analyzer spells badly. This
 * file turns the gate's non-resolved rows into NAMED CAUSE FAMILIES.
 *
 * IT IS NOT A SECOND INSTRUMENT. The row set is not re-derived here: this file READS THE GATE'S
 * OWN `--dump` ROWS (`DUMP\t<label>\t<outcome>\t<target>\t<srcFile>:<line>\t<claim>`), so the
 * population, the resolution rule and the outcome of every row are the gate's, by construction.
 * What this file adds is the ANALYZER'S OWN METADATA for each of those rows — read by re-parsing
 * each dumped source file through the same `parseFile(f, repoRoot, { projectRoot: repoRoot })` call
 * the gate makes — because the gate's dump deliberately prints only the claim KIND, not the
 * receiver-typing cut that produced a bare target.
 *
 * THREE CONTROLS, all of which can fail (the programme's rule: a probe that cannot fail is not a
 * measurement):
 *
 *   1  EVERY dumped row must match a relationship in the re-parse of its own file, on
 *      (label, target, line). A mismatch means the dump and this file's parse describe different
 *      emissions — the census refuses to report (exit 3) rather than print families for a walk
 *      nobody else can see.
 *   2  EVERY dumped row must be classified into a named family. An unclassified row is a cause
 *      this file does not understand, and it is named as `UNCLASSIFIED` and exits 3, because a
 *      bucket called "other" that nobody reads is how a backlog number becomes furniture.
 *   3  IF a gate `--json` capture is supplied, this file's per-type outcome counts (computed from
 *      the same dump rows) must equal the gate's. Two instruments over one population disagreeing
 *      is the failure mode `docs/M14-HONESTY-CONTRACT.md` names.
 *
 * WHAT IT CANNOT ANSWER, stated so the table is not read as stronger than it is: a cap-50 run has
 * 50 files admitted, so a target declared in an UNSAMPLED file of the same project and a target
 * that nothing declares are the same thing to this run. The families below therefore separate
 * "the analyzer could not type/spell it" (a claim about the analyzer, provable here) from "the
 * declaration is not in this key space" (a claim about the POPULATION, which only a whole-project
 * arm can settle — `--repo=`). For path targets the distinction IS provable here, because the
 * checkout itself can be asked whether the named file exists.
 *
 * Usage:
 *   bun run script/m14/incoming-gate.ts dart dart 50 --dump > /tmp/dump.tsv   # once
 *   BB_DART_DUMP=/tmp/dump.tsv bun run script/m14/dart-incoming-census.ts [--json]
 *   (or: --dump=/tmp/dump.tsv, --gate-json=/tmp/gate.json)
 *
 * Output: per-label table of named cause families with occurrence / distinct-target counts.
 * Exit:   0 census printed · 2 environment (no dump) · 3 A CONTROL DID NOT FIRE.
 */
import { existsSync, readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const argOf = (name: string): string | undefined => {
  const withEq = argv.find((a) => a.startsWith(`${name}=`))
  if (withEq) return withEq.slice(name.length + 1)
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const DUMP_PATH = argOf("--dump") ?? process.env.BB_DART_DUMP ?? ""
const GATE_JSON_PATH = argOf("--gate-json") ?? process.env.BB_DART_GATE_JSON ?? ""

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
  // 2026-10-18: the canonical vocabulary added stored labels this lane now emits; a census that
  // did not read them would classify their rows as UNCLASSIFIED (control 2) — the correct failure,
  // and the reason the labels are listed here rather than assumed absent.
  "mixes_in", "part_of",
] as const
type Type = (typeof ALL_TYPES)[number]

// Copied from incoming-gate.ts's LABEL_ALIASES, so the two agree about which spelling is a label.
const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls",
  uses: "uses",
  // `part_of` MOVED 2026-10-18, exactly as in the gate's own map: it used to collapse to
  // `contains`, on the pre-ruling ontology claim that "part-of is containment". That claim is
  // measured false for the construct the spelling denotes (a Dart `part` directive includes a
  // compile unit; it contains no symbol), and the canonical value now exists. Leaving the
  // collapse would make every emitted `part_of` read as a `contains` edge — a wrong measurement
  // that still adds up.
  //
  // THIS MAP CARRIED BOTH SPELLINGS, and a DUPLICATE OBJECT KEY IS LEGAL JAVASCRIPT: the LAST one
  // wins, so the stale `part_of: "contains"` was dropped with no error anywhere and the map read
  // as if the collapse were still in force. The value the runtime used was the CORRECT one
  // (`part_of` → `part_of`), so no number this census printed was wrong — but the source said
  // something the runtime did not do, which is the class of defect this fix removes.
  contains: "contains", composition: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
  mixes_in: "mixes_in", part_of: "part_of",
}
const ontologyName = (raw: string): Type | null => (LABEL_ALIASES[raw] as Type) ?? null

/** One row of the gate's --dump: exactly the six fields it prints. */
type DumpRow = {
  label: Type
  outcome: string
  target: string
  srcFile: string
  line: number
  claimKind: string
}

/** A cause family. `status` says what KIND of statement the family is, which is what keeps the
 *  table from being read as one uniform backlog:
 *    analyzer   the analyzer could not type/spell the site — a fix in THIS lane's code
 *    population the declaration is not in this run's key space — only a whole-project arm settles it
 *    external   the target is provably outside the checkout (a path, a package it does not carry)
 *    claim      the analyzer declared a cause (bucket 3) — neither resolved nor a gap
 *    spelling   the target is already as specific as the family's key space allows
 */
type Classified = { family: string; status: "analyzer" | "population" | "external" | "claim" | "spelling"; detail?: string }

const repoRootOf = (file: string): string => {
  const rel = file.startsWith(CR) ? file.slice(CR.length + 1) : file
  return path.join(CR, rel.split(path.sep)[0])
}
const repoRelOf = (file: string): string => {
  const root = repoRootOf(file)
  return path.relative(root, file).split(path.sep).join("/")
}

function readDump(file: string): DumpRow[] {
  const rows: DumpRow[] = []
  const text = readFileSync(file, "utf8")
  for (const line of text.split("\n")) {
    if (!line.startsWith("DUMP\t")) continue
    const p = line.split("\t")
    if (p.length < 6) continue
    const label = ontologyName(p[1])
    if (label === null) continue
    const loc = p[4]
    const colon = loc.lastIndexOf(":")
    const srcFile = colon > 1 ? loc.slice(0, colon) : loc
    const lineNo = colon > 1 ? Number(loc.slice(colon + 1)) || 0 : 0
    rows.push({ label, outcome: p[2], target: p[3], srcFile, line: lineNo, claimKind: p[5] })
  }
  return rows
}

/** The metadata the gate's dump does not print: the cut that left a target bare, the claim that
 *  moved a row out of `unresolved`. Keyed off ONE parse per dumped file, through the SAME call. */
type ParsedFile = {
  metadataByKey: Map<string, Record<string, unknown>[]>
  /** type names declared in this file (ownerName === "" && kind is a type kind) */
  types: Set<string>
  /** every symbol owned by this file, as `Owner.name` — used only for detail lines */
  owners: Set<string>
  /** every DECLARATION KEY this file contributes: a symbol's name, plus its qualifiedName when
   *  that is a different spelling. Exactly the gate's `countKey` increments (incoming-gate.ts:1035),
   *  so the ambiguity bucket below counts the same declarations the gate counts per project. */
  decls: string[]
}

const TYPE_KINDS = new Set(["class", "mixin", "enum", "extension", "type_alias", "extension_type"])

async function parseOne(file: string): Promise<ParsedFile> {
  const root = repoRootOf(file)
  const r: any = await parseFile(file, root, { projectRoot: root } as any)
  const metadataByKey = new Map<string, Record<string, unknown>[]>()
  const types = new Set<string>()
  const owners = new Set<string>()
  const decls: string[] = []
  for (const s of Array.isArray(r?.symbols) ? r.symbols : []) {
    const kind = String(s?.kind ?? "")
    const name = String(s?.name ?? "")
    const owner = String(s?.ownerName ?? "")
    if (name.length === 0) continue
    decls.push(name)
    const qual = String(s?.qualifiedName ?? "")
    if (qual.length > 0 && qual !== name) decls.push(qual)
    if (owner.length === 0 && TYPE_KINDS.has(kind)) types.add(name)
    if (owner.length > 0) owners.add(`${owner}.${name}`)
  }
  for (const rel of Array.isArray(r?.relationships) ? r.relationships : []) {
    const label = ontologyName(String(rel?.type ?? rel?.relationshipType ?? ""))
    if (label === null) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    const line = Number(rel?.line_number ?? rel?.lineNumber ?? rel?.line ?? 0) || 0
    const key = `${label}\u0001${tgt}\u0001${line}`
    const md = (rel?.metadata ?? {}) as Record<string, unknown>
    const list = metadataByKey.get(key)
    if (list) list.push(md)
    else metadataByKey.set(key, [md])
  }
  return { metadataByKey, types, owners, decls }
}

/** Is the target spelled as a FILE PATH (a relative/absolute path, or `.*` specifier form)? */
const isSpecifierStar = (t: string): boolean => t.endsWith(":*")
const isPathTarget = (t: string): boolean => t.includes("/") || t.endsWith(".dart") || t.endsWith(".g.dart")

/** A bare lowercase identifier: a member/function/property name the family's key space spells. */
const isBareLower = (t: string): boolean => /^[a-z_$][A-Za-z0-9_$]*$/.test(t)
const isBareUpper = (t: string): boolean => /^[A-Z][A-Za-z0-9_$]*$/.test(t)
const isDotted = (t: string): boolean => t.includes(".")
const targetOwner = (t: string): string | null => (t.includes(".") ? t.slice(0, t.indexOf(".")) : null)

function classifyUnresolved(
  row: DumpRow, md: Record<string, unknown> | undefined, parsed: ParsedFile,
): Classified {
  const t = row.target
  switch (row.label) {
    case "imports":
    case "exports": {
      if (isSpecifierStar(t)) {
        return { family: "specifier-not-in-project", status: "external", detail: "the checkout does not carry the named dependency/part" }
      }
      if (isPathTarget(t)) {
        const abs = path.join(repoRootOf(row.srcFile), t)
        return existsSync(abs)
          ? { family: "path-target-not-admitted", status: "population", detail: "the named file IS on disk in this repo but is outside this populated set" }
          : { family: "path-target-absent-from-disk", status: "external", detail: "dangling internal reference: the checkout declares it and the file is not there" }
      }
      return { family: "import-target-odd-shape", status: "analyzer", detail: `target=${JSON.stringify(t)}` }
    }
    case "calls":
    case "uses": {
      const cause = md?.receiverCause
      if (typeof cause === "string" && cause.length > 0) {
        return { family: `receiver-cut:${cause}`, status: "analyzer", detail: "analyzer cut the receiver and published the bare leaf" }
      }
      if (typeof md?.baseBeyondRunScope === "string") {
        return { family: "cause-claim-in-unresolved", status: "analyzer", detail: "a cause claim should have classified as causeDeclared" }
      }
      if (isBareLower(t)) {
        // No cut: the analyzer left the leaf as the source wrote it. Either a library-scope
        // declaration (Dart's unqualified callee resolves to the library, whose spelling IS the
        // bare name) or a member of a type this file never named.
        const declaredInFile = parsed.types.has(t) || (parsed.owners.has(t) as boolean)
        return {
          family: declaredInFile ? "bare-leaf-declared-in-file" : "bare-leaf-library-scope",
          status: declaredInFile ? "analyzer" : "population",
          detail: declaredInFile
            ? "the file declares this name yet the target stayed bare — look at the site"
            : "library-scope leaf; resolves iff the project's file-scope declaration is in this key space",
        }
      }
      if (isBareUpper(t)) {
        return { family: "bare-upper-call", status: "analyzer", detail: "a capitalized bare target in calls/uses — a type in a value position" }
      }
      // A POSITIONAL RECORD FIELD (`rec.$1`) is Dart's own name for a record position, and no
      // declaration can answer it (DARTGAP4 ruled the shape). It is spelled correctly and the
      // absent member is the language's, not the analyzer's — a `spelling` family, not a gap.
      if (/^\$[0-9]+$/.test(t)) {
        return { family: "positional-record-field-read", status: "spelling", detail: "Dart's positional record field ($1, $2) — a real name with no declaration to bind" }
      }
      return { family: "call-use-other", status: "analyzer", detail: `target=${JSON.stringify(t)}` }
    }
    case "instantiates": {
      if (isBareUpper(t)) {
        return { family: "type-target-not-in-key-space", status: "population", detail: "a capitalized construction; resolves iff the type's declaration is admitted here" }
      }
      if (isDotted(t)) {
        return { family: "qualified-construction", status: "analyzer", detail: `target=${JSON.stringify(t)}` }
      }
      return { family: "instantiate-other", status: "analyzer", detail: `target=${JSON.stringify(t)}` }
    }
    case "references": {
      if (md?.isAnnotation === true) {
        return { family: "annotation-type-not-in-key-space", status: "population", detail: "the annotation's TYPE is declared outside this run's key space (a library annotation such as @override/@pragma, or a package annotation)" }
      }
      if (md?.isMixinOn === true) {
        return { family: "mixin-on-type-not-in-key-space", status: "population", detail: "the mixin's `on` constraint names a type outside this run" }
      }
      return { family: "type-mention-not-in-key-space", status: "population", detail: "an ordinary type mention whose declaration is outside this run" }
    }
    case "mixes_in": {
      if (isBareUpper(t)) {
        return { family: "mixin-type-not-in-key-space", status: "population", detail: "an applied mixin whose declaration is not admitted here" }
      }
      return { family: "mixin-target-other", status: "analyzer", detail: `target=${JSON.stringify(t)}` }
    }
    case "part_of": {
      if (isPathTarget(t) || !t.includes("/")) {
        return { family: "part-target-not-in-key-space", status: "population", detail: "a part/library target (path or named library) whose symbol is not admitted here" }
      }
      return { family: "part-target-other", status: "analyzer", detail: `target=${JSON.stringify(t)}` }
    }
    case "extends":
    case "implements": {
      if (isBareUpper(t)) {
        return { family: "heritage-type-not-in-key-space", status: "population", detail: "the base/interface name; resolves iff its declaration is admitted here" }
      }
      return { family: "heritage-other", status: "analyzer", detail: `target=${JSON.stringify(t)}` }
    }
    case "overrides": {
      const owner = targetOwner(t)
      const inFile = owner !== null && parsed.types.has(owner)
      return {
        family: inFile ? "override-base-declared-in-file" : "override-base-outside-key-space",
        status: inFile ? "analyzer" : "population",
        detail: inFile
          ? "the base type is declared in this same file — the member might be missing from its surface"
          : "the base's declaration is not in this key space",
      }
    }
    default:
      return { family: "UNCLASSIFIED", status: "analyzer", detail: `label=${row.label}` }
  }
}

function classifyAmbiguous(row: DumpRow, decls: number): Classified {
  return {
    family: `ambiguous-by-declaration-count:${decls >= 5 ? "5+" : decls}`,
    status: "population",
    detail: "the bare name denotes more than one declaration in this project's sampled key space",
  }
}

function classifyCause(row: DumpRow, md: Record<string, unknown> | undefined): Classified {
  const base = typeof md?.baseBeyondRunScope === "string" ? String(md.baseBeyondRunScope) : null
  if (base !== null) {
    const kind = row.label === "overrides" ? "override-base" : "receiver-type"
    return {
      family: `declared-cause:${kind}`,
      status: "claim",
      detail: `base= ${base} — claimed beyond this run; resolves iff the project index can see the type`,
    }
  }
  return { family: "declared-cause:unnamed", status: "claim", detail: "causeDeclared with no baseBeyondRunScope in the re-parse" }
}

function classifyBinding(): Classified {
  return { family: "binding-spelled (not a gap, not a resolution)", status: "spelling", detail: "the target carries BINDING_SEP: a local binding read, the family's honest spelling" }
}

type Fam = { occurrences: number; names: Set<string>; statuses: Set<string>; detail?: string }
const fam = (): Fam => ({ occurrences: 0, names: new Set(), statuses: new Set() })

async function main(): Promise<void> {
  if (DUMP_PATH === "" || !existsSync(DUMP_PATH)) {
    console.error("usage: BB_DART_DUMP=<gate --dump capture> bun run script/m14/dart-incoming-census.ts [--json]")
    console.error("  (also accepts --dump=<path>, --gate-json=<path>; the dump must be produced by")
    console.error("   the SAME command line as the --gate-json capture, or controls 1 and 3 fail)")
    process.exit(2)
  }
  const rows = readDump(DUMP_PATH)
  if (rows.length === 0) {
    console.error(`FATAL: ${DUMP_PATH} contains no DUMP rows — was the gate run with --dump?`)
    process.exit(2)
  }
  const gateJson: any = GATE_JSON_PATH !== "" && existsSync(GATE_JSON_PATH)
    ? JSON.parse(readFileSync(GATE_JSON_PATH, "utf8"))
    : null

  // ---- parse each dumped file once, through the gate's own call ----
  const files = [...new Set(rows.map((r) => r.srcFile))].sort()
  const parsedByFile = new Map<string, ParsedFile>()
  for (const f of files) {
    try {
      parsedByFile.set(f, await parseOne(f))
    } catch (e) {
      console.error(`FATAL: could not parse ${f} for its metadata: ${String(e)}`)
      process.exit(2)
    }
  }

  // ---- declaration counts over the SAMPLED population, for ambiguity buckets ----
  // PER PROJECT, because that is the scope the gate's verdict resolves in (production's
  // `WHERE s.project_id`). Each dumped file contributes its name keys once per symbol, exactly as
  // the gate's own `countKey` does, so the bucket counts the same declarations the gate counts.
  const declCountByRepo = new Map<string, Map<string, number>>()
  for (const [file, p] of parsedByFile) {
    const repo = repoRootOf(file)
    let m = declCountByRepo.get(repo)
    if (!m) declCountByRepo.set(repo, (m = new Map()))
    for (const k of p.decls) m.set(k, (m.get(k) ?? 0) + 1)
  }
  const declCountFor = (row: DumpRow): number =>
    declCountByRepo.get(repoRootOf(row.srcFile))?.get(row.target) ?? 0

  // ---- controls ----
  const unmatched: string[] = []
  const outcomes = new Map<string, Map<string, number>>()
  for (const t of ALL_TYPES) outcomes.set(t, new Map())
  const families = new Map<Type, Map<string, Fam>>()
  for (const t of ALL_TYPES) families.set(t, new Map())
  const globalFam = new Map<string, Fam>()
  const causeBases = new Map<string, number>()

  for (const row of rows) {
    const perType = outcomes.get(row.label)!
    perType.set(row.outcome, (perType.get(row.outcome) ?? 0) + 1)
    const parsed = parsedByFile.get(row.srcFile)!
    const key = `${row.label}\u0001${row.target}\u0001${row.line}`
    const mdList = parsed.metadataByKey.get(key)
    // CONTROL 1: every dumped row must exist in the re-parse of its own file.
    if (mdList === undefined) {
      unmatched.push(`${row.label}\t${row.outcome}\t${row.target}\t${row.srcFile}:${row.line}`)
      continue
    }
    const md = mdList[0]
    let c: Classified
    switch (row.outcome) {
      case "unresolved":
        c = classifyUnresolved(row, md, parsed)
        break
      case "ambBoth":
      case "ambDeclOnly":
        c = classifyAmbiguous(row, declCountFor(row))
        break
      case "causeDeclared":
        c = classifyCause(row, md)
        if (typeof md?.baseBeyondRunScope === "string") {
          const b = String(md.baseBeyondRunScope)
          causeBases.set(b, (causeBases.get(b) ?? 0) + 1)
        }
        break
      case "bindingVerified":
      case "bindingRefuted":
      case "bindingUnverified":
        c = classifyBinding()
        break
      case "externalVerified":
      case "externalUnverified":
      case "externalRefuted":
        c = { family: `external-claim:${row.outcome}`, status: "external", detail: "the import/export claim path; not a bare-target gap" }
        break
      default:
        c = { family: "UNCLASSIFIED", status: "analyzer", detail: `outcome=${row.outcome}` }
    }
    const m = families.get(row.label)!
    const bump = (map: Map<string, Fam>, k: string, detail?: string) => {
      let f = map.get(k)
      if (!f) { f = fam(); map.set(k, f) }
      f.occurrences++
      f.names.add(row.target)
      f.statuses.add(c.status)
      if (detail) f.detail = detail
    }
    bump(m, c.family, c.detail)
    bump(globalFam, c.family, c.detail)
  }

  // CONTROL 1 result
  if (unmatched.length > 0) {
    console.error(`FATAL: control 1 FAILED — ${unmatched.length} of ${rows.length} dumped row(s) do not exist in the re-parse of their own file.`)
    for (const u of unmatched.slice(0, 10)) console.error(`  ${u}`)
    console.error("The dump and this census describe different emissions. Re-run both from the same tree.")
    process.exit(3)
  }

  // CONTROL 2: every row reached a named family.
  const unclassified = [...globalFam.entries()].filter(([k]) => k === "UNCLASSIFIED").reduce((n, [, v]) => n + v.occurrences, 0)
  if (unclassified > 0) {
    console.error(`FATAL: control 2 FAILED — ${unclassified} row(s) fell into UNCLASSIFIED; a cause this file does not understand must be named, not bucketed.`)
    process.exit(3)
  }

  // CONTROL 3: against the gate's own JSON capture, if supplied. The dump prints only rows whose
  // outcome is NOT `resolved`, so the reconstructible quantity is exactly
  // `edges - resolved` plus each non-resolved class — not `edges`, and not `resolved`.
  const diffs: string[] = []
  let control3 = "not supplied"
  if (gateJson !== null) {
    control3 = "PASS"
    for (const t of ALL_TYPES) {
      const theirs = gateJson.perType?.[t]
      if (!theirs) { diffs.push(`${t}: gate has no row`); continue }
      const mine = outcomes.get(t)!
      const sums = (names: string[]): number => names.reduce((n, x) => n + (mine.get(x) ?? 0), 0)
      const pairs: [string, number, number][] = [
        ["nonResolvedRows", [...mine.values()].reduce((a, b) => a + b, 0), theirs.edges - theirs.project.resolved],
        ["ambiguous", sums(["ambBoth", "ambDeclOnly"]), theirs.project.ambiguousByDecl],
        ["unresolved", mine.get("unresolved") ?? 0, theirs.project.unresolved],
        ["external", sums(["externalVerified", "externalUnverified", "externalRefuted"]), theirs.project.externalVerified + theirs.project.externalUnverified + theirs.project.externalRefuted],
        ["cause", mine.get("causeDeclared") ?? 0, theirs.project.causeDeclared],
        ["binding", sums(["bindingVerified", "bindingRefuted", "bindingUnverified"]), theirs.project.bindingVerified + theirs.project.bindingRefuted + theirs.project.bindingUnverified],
      ]
      for (const [k, a, b] of pairs) if (a !== b) diffs.push(`${t}.${k}: census ${a} != gate ${b}`)
    }
    if (diffs.length > 0) {
      console.error("FATAL: control 3 FAILED — the dump's rows do not reconstruct the gate's own JSON counts.")
      for (const d of diffs.slice(0, 20)) console.error(`  ${d}`)
      console.error("A dump captured with --dump LACKS the resolved rows BY DESIGN, so `edges` and")
      console.error("`resolved` are not comparable; a disagreement above is about the non-resolved")
      console.error("classes, which means the two captures were made with different flags or populations.")
      process.exit(3)
    }
  }

  const sorted = (m: Map<string, Fam>): [string, Fam][] => [...m.entries()].sort((a, b) => b[1].occurrences - a[1].occurrences)
  const byStatus = (m: Map<string, Fam>): Record<string, { occurrences: number; distinctNames: number }> => {
    const out: Record<string, { occurrences: number; distinctNames: number }> = {}
    for (const [f, v] of sorted(m)) {
      out[f] = { occurrences: v.occurrences, distinctNames: v.names.size }
    }
    return out
  }
  const perLabel = Object.fromEntries([...families.entries()].map(([t, m]) => [t, byStatus(m)]))
  // The status split is counted per ROW, not per family, because one family can contain rows the
  // classifier assigns different statuses to — and a family table read as a backlog needs the
  // per-row arithmetic to add up to the row count. Re-walk with the SAME classifier, so the two
  // tallies cannot disagree.
  const statusByRow: Record<string, number> = {}
  for (const row of rows) {
    const parsed = parsedByFile.get(row.srcFile)!
    const mdList = parsed.metadataByKey.get(`${row.label}\u0001${row.target}\u0001${row.line}`)!
    const md = mdList[0]
    let c: Classified | null = null
    if (row.outcome === "unresolved") c = classifyUnresolved(row, md, parsed)
    else if (row.outcome === "ambBoth" || row.outcome === "ambDeclOnly") c = classifyAmbiguous(row, declCountFor(row))
    else if (row.outcome === "causeDeclared") c = classifyCause(row, md)
    else if (row.outcome.startsWith("binding")) c = classifyBinding()
    else if (row.outcome.startsWith("external")) c = { family: `external-claim:${row.outcome}`, status: "external" }
    if (c) statusByRow[c.status] = (statusByRow[c.status] ?? 0) + 1
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({
      instrument: "script/m14/dart-incoming-census.ts",
      dump: DUMP_PATH,
      gateJson: GATE_JSON_PATH || null,
      population: { dumpedRows: rows.length, filesDumped: files.length },
      controls: {
        everyRowMatchesItsOwnFile: { ok: true, checked: rows.length },
        everyRowNamed: { ok: true, unclassified: 0 },
        reconstructsGateJson: control3,
      },
      outcomesByType: Object.fromEntries([...outcomes.entries()].map(([t, m]) => [t, Object.fromEntries(m)])),
      statusByRow,
      perTypeFamilies: perLabel,
      causeBases: Object.fromEntries([...causeBases.entries()].sort((a, b) => b[1] - a[1])),
    }, null, 2))
  } else {
    const w = (s: string | number, n: number) => String(s).padEnd(n)
    console.log(`dart incoming census — ${rows.length} non-resolved row(s) from ${files.length} dumped file(s)`)
    console.log(`dump: ${DUMP_PATH}`)
    console.log(`gate json: ${GATE_JSON_PATH || "(not supplied — control 3 skipped)"}`)
    console.log(`controls: every row matched its own file's re-parse (${rows.length}/${rows.length}) · every row named · gate-json reconstruction ${control3}`)
    console.log()
    console.log("STATUS SPLIT OF EVERY NON-RESOLVED ROW")
    console.log("-".repeat(78))
    const statusOrder = ["analyzer", "population", "external", "claim", "spelling"]
    for (const s of statusOrder) console.log(`${w(s, 14)} ${statusByRow[s] ?? 0}`)
    console.log()
    for (const t of ALL_TYPES) {
      const perType = outcomes.get(t)!
      const total = [...perType.values()].reduce((a, b) => a + b, 0)
      if (total === 0) continue
      const f = families.get(t)!
      console.log(`${t.toUpperCase()} — ${total} non-resolved row(s)  [${[...perType.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}]`)
      for (const [name, v] of sorted(f)) {
        console.log(`  ${w(name, 46)} ${w(v.occurrences, 6)} ${v.names.size} name(s)  ${[...v.statuses].join(",")}`)
        if (v.occurrences > 0 && v.detail) console.log(`  ${" ".repeat(46)} ${v.detail}`)
      }
      console.log()
    }
  }
}

await main()
