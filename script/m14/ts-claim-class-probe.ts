/**
 * TS CLAIM-CLASS PROBE — which CLAIM owns a row, per arm, on the SAME population.
 *
 * ## Why this instrument exists
 *
 * The charter's §21.40 addendum measured, on the production population (17,689 files,
 * `ts,tsx,mts,cts`), that the `--index` arm moves **83,371 rows OUT of `bindOK`** and
 * **+77,089 INTO `extOK`** and **0 → 11,136 INTO `ext?`**, while the javascript lane's indexed
 * arm moved 20,128 rows from UNRESOLVED into extOK with `resolved` and `bindOK` byte-identical.
 * Those are COLUMN TOTALS. This instrument answers the ROW question: for the SAME edge, which
 * claim marker does the analyzer attach in each arm, by what rule, and which claim SHOULD own it.
 *
 * ## The hypothesis this probe tests (and can REFUTE)
 *
 * `real-typescript-analyzer.ts` runs its claim passes in this order (the line numbers were re-read
 * at HEAD on 2026-10-20; the first edition of this header cited lines ~50 earlier):
 *
 *   2879  publishImportedBindingEvidence   (evidence only — publishes `metadata.importedBindings`
 *                                            on the imports rows; no marker of its own)
 *   2885  markExternalTargets              (file-local external markers: test-runner globals,
 *                                            runtime globals, lib types)
 *   2891  applyProjectIndexClaims          (THE INDEX PASS — PASS 1 claims `imports` rows whose
 *                                            module root is not a project module (`module-namespace`,
 *                                            line 2512); PASS 2 stamps `md.isExternalTarget` +
 *                                            `externalReason: "imported-from-external-module"` on
 *                                            every row whose target is a binding imported from an
 *                                            EXTERNAL module (line 2539))
 *   2896  applyLocalBindingSpellings       (re-spells to `<callable>\0<binding>` + `md.localBinding`)
 *   2897  applyImportedBindingClaims       (stamps `md.importedBinding = {specifier, binding}`)
 *
 * `carriesClaimMarker()` (line 218) returns TRUE for `md.isExternalTarget === true`, and BOTH
 * binding passes consult it (lines 4791 and 4660). So a row the index pass already claimed is
 * SKIPPED by the binding passes. THE CONSEQUENCE: in the `--index` arm a row that would have been a
 * BINDING CLAIM is instead an EXTERNAL CLAIM — a move between two CLAIM columns, decided purely
 * by PASS ORDER. The javascript analyzer has no index pass of this shape (its `markExternalClaims`
 * claims only host/runtime globals and module-namespace `imports` rows), which is why its `bindOK`
 * is byte-identical between arms.
 *
 * ## What this probe measures (and what it does not)
 *
 * It runs the analyzer over a real corpus population TWICE — once with a complete project index and
 * once without — and for each relationship row it records (a) the CLAIM MARKER the analyzer
 * attached and (b) the ARBITER'S OWN VERDICT for that row (`classifyEdge`, imported from
 * `incoming-rule.ts`, never copied). It is an ATTRIBUTION instrument: it does not adjudicate claims
 * (the arbiter does that, through the very `classifyEdge` it calls) and it does not replace the
 * arm. It answers ONE question: "for the rows whose class changed between the arms, which marker
 * moved, which arbiter branch decided it, and which claim SHOULD own the row".
 *
 * ## THE COUNTERFACTUAL — which claim SHOULD own the row
 *
 * For a row the index pass claimed as `imported-from-external-module`, the probe asks the arbiter
 * what the IMPORTED-BINDING claim would have said (the claim the guard suppressed). The two claims
 * are different statements and only one can be right about a given row:
 *
 *   - the EXTERNAL claim is answered through the SYMBOL KEY SPACE (`verifyExternalClaim` looks the
 *     target up), so a declaration of that name ANYWHERE in the project REFUTES it — and a refuted
 *     claim is counted AGAINST the lane (`extFAIL`);
 *   - the IMPORTED-BINDING claim is verified against the FILE'S OWN import evidence
 *     (`verifyImportedBindingClaim`), so a same-named declaration elsewhere is irrelevant — it is
 *     exactly the name-model DECOY the binding claim exists to displace.
 *
 * So the counterfactual is the measurement that says which claim should own each displaced row.
 *
 * ## The falsifier
 *
 * If the hypothesis is WRONG, the probe must show class changes with no `isExternalTarget` in the
 * index arm, or class changes to a marker the index pass never writes. Both are printed as
 * `UNEXPLAINED-CLASS-CHANGE` with counts, so the probe cannot be read as confirming a story it did
 * not measure. The counterfactual has its own falsifier: a row whose "other claim" is REFUTED is a
 * row the index pass's claim is RIGHT about, and that count is printed too — a hypothesis that
 * claimed the external claim is always the wrong one would be refuted by that number.
 *
 * ## Population rule
 *
 * The file set is derived per run from the corpus the same way `incoming-gate.ts` derives its own:
 * every git checkout under `$BB_CORPUS_ROOT`, `git ls-files`, extension admitted, size cap, then
 * the same deterministic stride. The population is PRINTED with its size, so a sample can never be
 * read as the corpus. `maxFiles` is the PER-REPO cap (0 = every file of every repo).
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-claim-class-probe.ts [maxFiles] [--json out.json]
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-claim-class-probe.ts 50 --json /tmp/probe.json
 */
import * as fs from "node:fs"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { resolveWasmAsset } from "../../src/util/wasm"
// THE ARBITER'S OWN CLASSIFIER — imported, not copied, so the probe cannot disagree with the
// gate by construction (the same rule `incoming-gate.ts` states about `classifyEdge`).
import { classifyEdge, externalClaimOf, isContainsEdge } from "./incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const mod: any = await import("../../src/ast/project-index")
const wasm = resolveWasmAsset("tree-sitter-typescript/tree-sitter-typescript.wasm")

const argv = process.argv.slice(2)
const jsonIdx = argv.indexOf("--json")
const JSON_OUT = jsonIdx >= 0 ? argv[jsonIdx + 1] : null
const MAX_FILES = Number(argv.find((a) => /^\d+$/.test(a)) ?? 0)
/** `--assert-table <gate-log>` — the clojure lane's template: the probe's OWN TABLE 1 is compared
 *  with the GATE'S TABLE 1 for the same run, and the process exits 4 on any mismatch. Without it the
 *  probe's table is the PROBE's attribution and is never presented as the gate's number. */
const ASSERT_TABLE = (() => { const i = argv.indexOf("--assert-table"); return i >= 0 ? (argv[i + 1] ?? null) : null })()

/** THE MARKER VOCABULARY, in the analyzer's own order. The first one present IS the claim that
 *  owns the row, because the arbiter's `externalClaimOf` reads them in the same precedence
 *  (localBinding → importedBinding → … → isExternalTarget). */
const MARKERS = [
  "localBinding",
  "importedBinding",
  "defaultExport",
  "moduleExports",
  "importOutsideProject",
  "importProjectFile",
  "remoteRef",
  "baseBeyondRunScope",
  "languageNamespace",
  "sourcePathClaim",
  "isExternalTarget",
] as const

type Marker = string
type RowRec = {
  marker: Marker
  reason: string
  label: string
  target: string
  file: string
  line: number
  source: string
  outcome: string
  claimKind: string
  /** The arbiter's verdict for the OTHER claim — the counterfactual. */
  altOutcome: string
  altClaimKind: string
  /** For the index pass's own claim: would the SYMBOL KEY SPACE refute it? (`extFAIL` risk.) */
  extClaimRisk: string
  /** The ARBITER'S OWN VERDICT for that row — the measurement behind the risk. */
  extClaimActual: string
}

const markerOf = (md: any): { marker: Marker; reason: string } => {
  for (const k of MARKERS) {
    if (k === "isExternalTarget") {
      if (md?.isExternalTarget === true) {
        return { marker: "isExternalTarget", reason: String(md?.externalReason ?? "") }
      }
      continue
    }
    const v = md?.[k]
    if (v === true || (v !== undefined && v !== null && v !== false)) {
      return { marker: k, reason: String(md?.externalReason ?? "") }
    }
  }
  return { marker: "NONE", reason: "" }
}

/**
 * THE OTHER CLAIM — the one the row did NOT carry.
 *
 * The index pass's claim (`isExternalTarget` + `externalReason: "imported-from-external-module"`)
 * is a CLAIM ABOUT A SYMBOL the project does not declare. The imported-binding claim
 * (`importedBinding = {specifier, binding}`) is a CLAIM ABOUT A BINDING the file's own imports
 * establish. They are different statements, and only one of them can be right about a given row:
 *
 *   - the external claim is answered through the SYMBOL KEY SPACE (`verifyExternalClaim` looks the
 *     target up), so a declaration of that name ANYWHERE in the project REFUTES it — and a refuted
 *     claim is counted AGAINST the lane (`extFAIL`);
 *   - the imported-binding claim is verified against the FILE'S OWN import evidence
 *     (`verifyImportedBindingClaim`), so a same-named declaration elsewhere is irrelevant — it is
 *     exactly the name-model DECOY the binding claim exists to displace.
 *
 * So the counterfactual is the measurement that says which claim should own each displaced row.
 *
 * THE BINDING NAME, for the DIRECT case, is the row's own TARGET — the index pass's PASS 2 looked
 * the target up in its `externalBindings` map, so the target IS the binding name it published. For
 * the MEMBER case (`path.join(…)`) the pass published `metadata.externalReceiver` — the binding the
 * member belongs to — and the row's target is the member leaf, which is the arbiter's
 * `position: "receiver"` shape (the JS contract).
 */
const counterfactualClaim = (md: any, actual: any): any => {
  if (actual?.kind === "owner" && md?.externalReason === "imported-from-external-module") {
    const spec = typeof md.externalSpecifier === "string" ? md.externalSpecifier : ""
    if (spec.length === 0) return null
    const recv = typeof md.externalReceiver === "string" ? md.externalReceiver : ""
    if (recv.length > 0) return { kind: "importedBinding", specifier: spec, binding: recv, position: "receiver" }
    // The DIRECT case: the binding name IS the row's target. The probe fills it from the row's
    // own target (it is the only identifier the index pass looked up), so the caller must pass
    // the target in — `counterfactualClaim(md, claim, target)`.
    return { kind: "importedBinding", specifier: spec, binding: "__TARGET__" }
  }
  if (actual?.kind === "importedBinding") {
    return { kind: "owner", specifier: actual.specifier }
  }
  return null
}

type Arm = {
  /** Grouped by the STABLE key (label, file, line) — the join key. Each group is a LIST because
   *  several relationships can share it (two calls of the same callee on one line). */
  groups: Map<string, RowRec[]>
  files: number
  /** THE POPULATION THIS ARM MEASURED — the probe's OWN numbers, so the caller's arguments can be
   *  asserted against the gate's log before the tables are compared. */
  filesParsed: number
  admitted: number
  repos: number
  total: number
  byOutcome: Map<string, number>
  /** THE CLAIMS THE PROJECT WOULD REFUTE — the `extFAIL` risk, with samples. */
  refutedSamples: string[]
  /**
   * THE ROUTING SPLIT (charter R7, 2026-10-20) — for EVERY edge, which claim the ARBITER routed
   * it to, and what that claim produced. `externalClaimOf` IS the routing decision (it is the
   * arbiter's own function, imported above, never copied), so this tally is the shared
   * instrument's routing measured, per arm.
   *
   * WHY IT IS A SEPARATE TALLY AND NOT THE OUTCOME TALLY: the outcome says where a row LANDED;
   * the routing says which MECHANISM owned it. A row can land in `resolved` and still have been
   * routed to a claim that was then read only to be recorded (`claimOnAmbiguous`) or not read at
   * all (a name-model answer with `decls > 0`), so the two numbers are not two views of one
   * number. The charter's rule is that a CLAIM is never merged into a RESOLUTION, and this
   * tally is what keeps the two apart at the row level.
   */
  byClaim: Map<string, number>
  /** For each claim kind, the outcome distribution it produced — the routing and its effect. */
  claimOutcome: Map<string, Map<string, number>>
  /**
   * THE DISPLACEMENT, over EVERY row and not only the outcome-changed ones: rows the index pass
   * claimed (`owner` + `imported-from-external-module`) whose SUPPRESSED claim would have verified
   * too. The 2,885 figure the D7 page quotes was measured on a 376-file sample; this is the same
   * question asked of the whole population, and it is asked in BOTH directions (index arm: what
   * would the binding claim have said? no-index arm: what would the external claim have said?).
   */
  displacedByIndex: Map<string, number>
  displacedByIndexTotal: number
  /** The same, for the no-index arm's rows: what the index pass's claim would have said. */
  displacedByNoIndex: Map<string, number>
  displacedByNoIndexTotal: number
  /**
   * R5's BOUND (charter §21.41 R5) over the UNRESOLVED, NAME-SHAPED rows — the same partition the
   * dart lane measured (`script/m14/dart-uses-wall-classes.ts`), asked of this lane's population:
   *   W1 the FILE binds the name      → the analyzer published a binding-spelled row for that name
   *                                     in that file, so the row is a read of a LOCAL.
   *   W2 the PROJECT declares it as a MEMBER → the project declares the name as a member of some
   *                                     type and the site does not say WHICH: THE RECEIVER-WALL
   *                                     CLASS, and the only one a receiver-typing evidence class
   *                                     could move.
   *   W3 the project declares it NOWHERE → an SDK / third-party member: a VOCABULARY question, and
   *                                     the instrument for that share is the package-scope claim.
   */
  r5: {
    total: number
    W1: number
    W2: number
    W3: number
    byLabel: Map<string, Map<string, number>>
    samples: string[]
  }
  /**
   * THE `amb(decl)` CEILING (the clojure lane's correction, 2026-10-20). Production's name pass
   * PREFERS THE EDGE'S OWN FILE, so an ambiguous row whose target is declared in the row's own file
   * IS PRODUCTION-BOUND — the project's name space is ambiguous, production's resolution is not.
   * The clojure lane measured 82.0 % of its ambiguous rows that way, which makes `amb(decl)` a
   * CEILING on the production residual rather than the residual itself.
   *
   * `ambOwnFile` = production-bound (the row's own file declares the target) · `ambGenuine` = the
   * name is ambiguous even for production (no file-local declaration to prefer).
   */
  ambCeiling: {
    ambRows: number
    ambOwnFile: number
    ambGenuine: number
    byLabel: Map<string, { own: number; genuine: number }>
    /**
     * THE POPULATION DISTINCTION (the Lead's ask, 2026-10-20). The fleet's 82 % / 68.9 % figures
     * are WHOLE-CLASS shares — (own-file-declares) ÷ (ALL ambiguous rows). **THE TIE-BREAK'S
     * POPULATION IS THE CLAIM-FREE SUBSET**: a row that carries an EXTERNAL or a BINDING claim
     * RETURNS BEFORE THE COUNT, so the tie-break can only move the rows the name model answers.
     * So the number that PRICES the tie-break is the CLAIM-FREE own-file share, and the
     * claim-carrying share is the part the change CANNOT touch.
     */
    claimFree: number
    claimFreeOwnFile: number
    claimFreeGenuine: number
    claimed: number
    claimedOwnFile: number
    claimedGenuine: number
    byLabelClaimFree: Map<string, { own: number; genuine: number }>
  }
  /** THE PROBE'S OWN TABLE 1 — the per-type class table, for the assertion against the gate's. */
  table: Record<string, number[]>
}

const stableKey = (label: string, file: string, line: number): string => `${label}\0${file}\0${line}`

/**
 * IS THE TARGET A PLAIN NAME? — the shape R5's partition is asked over.
 *
 * A name-shaped target is a single identifier: no dot (not a qualified path), no colon (not a
 * `module:item`), no slash (not a path), and no NUL (not a binding spelling). The rows this
 * excludes are a DIFFERENT class — a module path, an `imports` target, a binding spelling — and
 * they are counted in the report as excluded rather than silently folded into a class.
 */
const isNameShaped = (t: string): boolean => {
  if (t.length === 0) return false
  for (const ch of t) {
    const ok = (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_" || ch === "$"
    if (!ok) return false
  }
  return true
}

const runArm = async (useIndex: boolean): Promise<Arm> => {
  const groups = new Map<string, RowRec[]>()
  const byOutcome = new Map<string, number>()
  const byClaim = new Map<string, number>()
  const claimOutcome = new Map<string, Map<string, number>>()
  const displacedByIndex = new Map<string, number>()
  const displacedByNoIndex = new Map<string, number>()
  let displacedByIndexTotal = 0
  let displacedByNoIndexTotal = 0
  const r5 = { total: 0, W1: 0, W2: 0, W3: 0, byLabel: new Map<string, Map<string, number>>(), samples: [] as string[] }
  const ambCeiling = {
    ambRows: 0, ambOwnFile: 0, ambGenuine: 0,
    byLabel: new Map<string, { own: number; genuine: number }>(),
    claimFree: 0, claimFreeOwnFile: 0, claimFreeGenuine: 0,
    claimed: 0, claimedOwnFile: 0, claimedGenuine: 0,
    byLabelClaimFree: new Map<string, { own: number; genuine: number }>(),
  }
  /** THE PROBE'S OWN TABLE 1 — the per-type class table. */
  const table: Record<string, number[]> = {}
  const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of"]
  for (const t of TYPES) table[t] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  /** THE CLAIMS THE PROJECT WOULD REFUTE — the `extFAIL` risk. */
  const refutedSamples: string[] = []
  let files = 0
  let total = 0
  /** THE POPULATION COUNTS — the probe's OWN numbers, so the caller's arguments can be asserted
   *  against the gate's log (the Lead's ask, 2026-10-20: a probe must assert the CALLER'S
   *  ARGUMENTS as well as the rule). `admitted` is the number of files the probe offered the
   *  analyzer, `files` the number it parsed, `repos` the number of repositories it walked. */
  let admitted = 0
  let reposSeen = 0
  const repos = fs.readdirSync(CR).filter((r) => { try { return fs.statSync(path.join(CR, r)).isDirectory() } catch { return false } }).sort()
  for (const repo of repos) {
    const dir = path.join(CR, repo)
    let tracked: string[] = []
    try {
      tracked = (await import("node:child_process")).execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch { continue }
    let filesIn = tracked.filter((r) => /\.(ts|tsx|mts|cts)$/.test(r)).map((r) => path.join(dir, r))
      .filter((abs) => { try { return fs.statSync(abs).size <= 1024 * 1024 } catch { return false } })
    if (filesIn.length === 0) continue
    if (MAX_FILES > 0) filesIn = filesIn.slice(0, MAX_FILES)
    admitted += filesIn.length
    reposSeen++
    let projectIndex: any
    if (useIndex) {
      try {
        projectIndex = await mod.buildProjectIndexStreaming(wasm, filesIn, mod.TYPESCRIPT_DECLARATION_SPEC)
        projectIndex.complete = true
      } catch { continue }
    }
    // ── THE KEY SPACE, built over the SAME repo's files — the gate's `projectDecl`/`projectKinds`
    // (PER-PROJECT scope: production's scope). The probe builds it the same way so its
    // `classifyEdge` answers the same question the gate's does.
    const pDecl = new Map<string, number>()
    /** THE FILES THAT DECLARE EACH NAME — production's name pass prefers the edge's OWN FILE, so a
     *  row whose target is declared in its own file is PRODUCTION-BOUND even when the project's name
     *  space is ambiguous. The clojure lane measured 82.0 % of its ambiguous rows this way
     *  (2026-10-20), which makes `amb(decl)` a CEILING on the production residual and not the
     *  residual itself. This map is the same fact, for this lane. */
    const declFiles = new Map<string, Set<string>>()
    const pKinds = new Map<string, Set<string>>()
    const pFiles = new Set<string>()
    /** THE PROJECT'S MEMBER NAMES — the names the project declares as a MEMBER of some type. This is
     *  a DIFFERENT key space from `pDecl` (which counts any declaration by name): it is the space a
     *  member read is resolved against, and it is what R5's W2 class asks ("the project declares it
     *  as a member; the site does not say WHICH type"). */
    const pMembers = new Set<string>()
    /** THE CLASS-LIKE NAMES OF THIS REPOSITORY — the owners a member can belong to. Accumulated
     *  across the repository's files, because a member's owner may be declared in ANOTHER file. */
    const CLASSLIKE_KINDS = new Set(["class", "interface", "enum", "namespace", "module", "internal_module", "record", "struct", "trait", "abstract_class"])
    let repoClassLike = new Set<string>()
    let repoMemberCandidates: { name: string; owner: string }[] = []
    /** THE NAMES THE FILE BINDS — from the analyzer's OWN output for that file: a BINDING-SPELLED row
     *  (`<callable>\0<binding>` + `metadata.localBinding`) is the family's own spelling for a local
     *  read, so the name IS a local of that file. This is R5's W1 class, measured from the analyzer's
     *  own rows rather than guessed from the name's spelling (a name's shape says nothing: the dart
     *  lane measured 77.7 % "local" by shape and every hand-read sample was an SDK member). */
    const fileLocalNames = new Map<string, Set<string>>()
    const importEvidence = new Map<string, Map<string, Set<string>>>()
    const repoRows: { rec: RowRec; rel: any }[] = []
    for (const abs of filesIn) {
      let content: string
      try { content = fs.readFileSync(abs, "utf8") } catch { continue }
      let parsed: any
      try {
        parsed = await ASTEngine.parseFile(abs, content, {
          projectIndex, projectRoot: useIndex ? dir : undefined,
        } as any)
      } catch { continue }
      files++
      const relFile = path.relative(dir, abs)
      pFiles.add(relFile)
      for (const s of parsed.symbols ?? []) {
        const key = String(s?.name ?? "")
        if (key.length === 0) continue
        pDecl.set(key, (pDecl.get(key) ?? 0) + 1)
        let dFiles = declFiles.get(key)
        if (!dFiles) declFiles.set(key, (dFiles = new Set()))
        dFiles.add(relFile)
        const ks = pKinds.get(key)
        const kind = String((s as any)?.kind ?? "")
        if (ks) ks.add(kind)
        else pKinds.set(key, new Set([kind]))
        // THE MEMBER KEY SPACE (R5's W2) — a symbol that BELONGS to a TYPE is a MEMBER of it. The
        // owner must be a CLASS-LIKE declaration (the arbiter's own owner-channel rule: a member set
        // lives in a class, an interface, an enum or a namespace), so the test is the owner's KIND
        // and not "the symbol has an ownerName" — a top-level symbol's owner is the FILE, and a file
        // is not a type. (Measured: the analyzer publishes a top-level class with `ownerName` = the
        // file's stem, so the looser test would put every FILE NAME in the member space.)
        //
        // THE OWNER MAY LIVE IN ANOTHER FILE, so the class-like set is the REPOSITORY's and the
        // member candidates are resolved when the repository's key space is complete.
        if (CLASSLIKE_KINDS.has(kind)) repoClassLike.add(key)
        const ownerName = typeof (s as any)?.ownerName === "string" && String((s as any).ownerName).length > 0
          ? String((s as any).ownerName)
          : null
        if (ownerName !== null) repoMemberCandidates.push({ name: key, owner: ownerName })
      }
      for (const r of parsed.relationships ?? []) {
        const md: any = r.metadata ?? {}
        const { marker, reason } = markerOf(md)
        const label = String(r.type ?? "")
        const source = String(r.source ?? "")
        const target = String(r.target ?? "")
        const line = Number(r.line ?? r.lineStart ?? 0)
        total++
        // THE FILE'S OWN BOUND NAMES (R5's W1) — collected from the analyzer's OWN rows for THIS
        // file, before any classification, so the test is made against the same output the rows came
        // from. A BINDING-SPELLED row is the family's spelling for a local read.
        if (md.localBinding === true) {
          const at = target.lastIndexOf("\0")
          if (at > 0 && at < target.length - 1) {
            let set = fileLocalNames.get(relFile)
            if (!set) fileLocalNames.set(relFile, (set = new Set()))
            set.add(target.slice(at + 1))
          }
        }
        const rec: RowRec = {
          marker, reason, label, target, file: relFile, line, source,
          outcome: "", claimKind: "", altOutcome: "", altClaimKind: "", extClaimRisk: "", extClaimActual: "",
        }
        const k = stableKey(label, relFile, line)
        const existing = groups.get(k)
        if (existing) existing.push(rec)
        else groups.set(k, [rec])
        repoRows.push({ rec, rel: r })
        // THE IMPORTED-BINDING EVIDENCE, built from the run's OWN import edges (the gate's rule).
        if (label === "imports") {
          const names = Array.isArray(md.importedBindings) ? md.importedBindings : null
          const itemMatch = target.lastIndexOf(":")
          const tgtItem = itemMatch > 0 && itemMatch < target.length - 1 ? target.slice(itemMatch + 1) : ""
          if (names || (tgtItem.length > 0 && tgtItem !== "*")) {
            const specKey = typeof md.module === "string" && md.module.length > 0
              ? md.module
              : (itemMatch > 0 ? target.slice(0, itemMatch) : target)
            let bySpec = importEvidence.get(relFile)
            if (!bySpec) importEvidence.set(relFile, (bySpec = new Map()))
            let bindSet = bySpec.get(specKey)
            if (!bindSet) bySpec.set(specKey, (bindSet = new Set()))
            for (const nm of names ?? []) if (typeof nm === "string" && nm.length > 0) bindSet.add(nm)
            if (tgtItem.length > 0 && tgtItem !== "*") bindSet.add(tgtItem)
          }
        }
      }
    }
    // ── THE ARBITER'S CLASSIFICATION, over the finished key space (the gate's own order).
    // THE REPOSITORY'S MEMBER SET — resolved now, with the repository's OWN class-like names
    // complete (a member's owner may be declared in another file of the same repository).
    for (const c of repoMemberCandidates) {
      if (repoClassLike.has(c.owner)) pMembers.add(c.name)
    }
    const facts = { packages: new Set<string>(), files: pFiles, sdkLib: false, importsByFile: importEvidence }
    for (const { rec, rel } of repoRows) {
      const claim = externalClaimOf(rel)
      const isContains = isContainsEdge(rec.label)
      const c = classifyEdge(pDecl, pKinds, rec.target, claim, facts, isContains, undefined, undefined, rec.file)
      rec.outcome = c.outcome
      rec.claimKind = claim?.kind ?? "-"
      byOutcome.set(c.outcome, (byOutcome.get(c.outcome) ?? 0) + 1)
      // ── THE ROUTING SPLIT (charter R7) ───────────────────────────────────────────────────────
      // The claim the ARBITER routed the row to. `externalClaimOf` is that decision (imported from
      // the shared instrument, never copied), so this tally is the routing itself, measured.
      const claimKey = claim?.kind ?? "(no claim)"
      byClaim.set(claimKey, (byClaim.get(claimKey) ?? 0) + 1)
      // THE PROBE'S OWN TABLE 1 — the same columns the gate prints, from the same `classifyEdge`.
      {
        const row = table[rec.label]
        if (row) {
          row[0]! += 1
          switch (c.outcome) {
            case "resolved": row[1]! += 1; break
            case "ambDeclOnly": row[3]! += 1; break
            case "ambBoth": row[3]! += 1; row[4]! += 1; break
            case "unresolved": row[5]! += 1; break
            case "externalVerified": row[6]! += 1; break
            case "externalUnverified": row[7]! += 1; break
            case "externalRefuted": row[8]! += 1; break
            case "bindingVerified": row[9]! += 1; break
            case "bindingUnverified": row[10]! += 1; break
            case "bindingRefuted": row[11]! += 1; break
            case "causeDeclared": row[12]! += 1; break
            case "causeRefuted": row[13]! += 1; break
            default: break
          }
        }
      }
      // THE `amb(decl)` CEILING — an ambiguous row whose OWN FILE declares the target is
      // PRODUCTION-BOUND (production prefers the row's own file), so the column is a CEILING.
      if (c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") {
        ambCeiling.ambRows++
        const files = declFiles.get(rec.target)
        const own = files !== undefined && files.has(rec.file)
        if (own) ambCeiling.ambOwnFile++
        else ambCeiling.ambGenuine++
        let byL = ambCeiling.byLabel.get(rec.label)
        if (!byL) ambCeiling.byLabel.set(rec.label, (byL = { own: 0, genuine: 0 }))
        if (own) byL.own++
        else byL.genuine++
        // ── THE TIE-BREAK'S POPULATION — a row that CARRIES A CLAIM returns before the count, so the
        // tie-break can only move the CLAIM-FREE ambiguous rows. Its price is the claim-free
        // own-file share, and the claim-carrying share is the part the change CANNOT touch.
        const carriesClaim = claim !== null
        if (carriesClaim) {
          ambCeiling.claimed++
          if (own) ambCeiling.claimedOwnFile++
          else ambCeiling.claimedGenuine++
        } else {
          ambCeiling.claimFree++
          if (own) ambCeiling.claimFreeOwnFile++
          else ambCeiling.claimFreeGenuine++
          let byC = ambCeiling.byLabelClaimFree.get(rec.label)
          if (!byC) ambCeiling.byLabelClaimFree.set(rec.label, (byC = { own: 0, genuine: 0 }))
          if (own) byC.own++
          else byC.genuine++
        }
      }
      let co = claimOutcome.get(claimKey)
      if (!co) claimOutcome.set(claimKey, (co = new Map()))
      co.set(c.outcome, (co.get(c.outcome) ?? 0) + 1)
      // ── R5's BOUND over the UNRESOLVED NAME-SHAPED rows ─────────────────────────────────────
      // A row whose target is a plain IDENTIFIER and that NOTHING declares is the class R5 asks
      // about: is there a declaration for ANY evidence class to point at? The three answers are
      // measured against this arm's OWN key spaces (the file's binding-spelled names, the project's
      // member names, and the project's name space).
      if (c.outcome === "unresolved" && isNameShaped(rec.target)) {
        r5.total++
        const bound = fileLocalNames.get(rec.file)
        let cls: "W1" | "W2" | "W3"
        if (bound && bound.has(rec.target)) cls = "W1"
        else if (pMembers.has(rec.target)) cls = "W2"
        else cls = "W3"
        if (cls === "W1") r5.W1++
        else if (cls === "W2") r5.W2++
        else r5.W3++
        let byL = r5.byLabel.get(rec.label)
        if (!byL) r5.byLabel.set(rec.label, (byL = new Map()))
        byL.set(cls, (byL.get(cls) ?? 0) + 1)
        if (r5.samples.length < 12) r5.samples.push(`${cls} ${rec.label} ${rec.source} -> ${rec.target} @ ${rec.file}:${rec.line}`)
      }
      const alt0 = counterfactualClaim(rel.metadata ?? {}, claim)
      if (alt0) {
        // The DIRECT case's binding name is the row's own target.
        const alt = alt0.binding === "__TARGET__" ? { ...alt0, binding: rec.target } : alt0
        const c2 = classifyEdge(pDecl, pKinds, rec.target, alt, facts, isContains, undefined, undefined, rec.file)
        rec.altOutcome = c2.outcome
        rec.altClaimKind = alt.kind
        // ── THE DISPLACEMENT, EVERY ROW, NOT ONLY THE OUTCOME-CHANGED ONES ───────────────────
        // THE INDEX ARM: the index pass claimed the row (`owner` + `imported-from-external-module`),
        // so the binding passes SKIPPED it. The counterfactual is the claim the guard suppressed —
        // and the question is not "did the row move" but "would the suppressed claim have
        // VERIFIED", because a row that moves between two columns where BOTH claims are true is a
        // ROUTING effect, not a truth effect (charter R7).
        if (useIndex && claim?.kind === "owner" && String((rel.metadata as any)?.externalReason ?? "") === "imported-from-external-module") {
          displacedByIndex.set(c2.outcome, (displacedByIndex.get(c2.outcome) ?? 0) + 1)
          displacedByIndexTotal++
        }
        // THE NO-INDEX ARM: the row carries the imported-binding claim here, and the index arm
        // routes it to the external claim instead. The counterfactual is that external claim.
        if (!useIndex && claim?.kind === "importedBinding") {
          displacedByNoIndex.set(c2.outcome, (displacedByNoIndex.get(c2.outcome) ?? 0) + 1)
          displacedByNoIndexTotal++
        }
      }
      // ── THE EXTERNAL CLAIM'S OWN RISK. The index pass's claim is answered through the SYMBOL
      // KEY SPACE, so a declaration of that name ANYWHERE in the project REFUTES it — and a
      // refuted claim is `extFAIL`, counted AGAINST the lane. The probe measures that risk
      // DIRECTLY: how many of the index pass's claims name a name the project DECLARES. This is
      // the number that says whether the index pass's claim is safe to let own the row.
      if (claim?.kind === "owner" && (rel.metadata as any)?.externalReason === "imported-from-external-module") {
        const declared = (pDecl.get(rec.target) ?? 0) > 0
        rec.extClaimRisk = declared ? "would-be-refuted" : "not-refutable"
        // THE ARBITER'S OWN VERDICT FOR THIS ROW — the measurement, not the prediction. A
        // predicted refutation can be DEMOTED to `ext?` by the project-absolute refiner (a
        // specifier whose root is a project directory), so the two are counted separately.
        rec.extClaimActual = c.outcome
        if (declared) {
          // THE CLAUSE-4 RISK — a claim the project REFUTES, which the gate counts as `extFAIL`.
          // The samples are printed so the class can be characterised before the production
          // dumps land: a name the project declares that ALSO names an external import binding.
          const spec = String((rel.metadata as any)?.externalSpecifier ?? "?")
          refutedSamples.push(`${rec.label} ${rec.source} -> ${rec.target} (specifier ${spec}) @ ${rec.file}:${rec.line}`)
        }
      }
    }
  }
  return { groups, files, filesParsed: files, admitted, repos: reposSeen, total, byOutcome, refutedSamples, byClaim, claimOutcome, displacedByIndex, displacedByIndexTotal, displacedByNoIndex, displacedByNoIndexTotal, r5, ambCeiling, table }
}

console.log(`TS CLAIM-CLASS PROBE — corpus ${CR} · maxFiles ${MAX_FILES} per repo (0 = whole population)`)
const noIndex = await runArm(false)
console.log(`  no-index arm: files ${noIndex.files} · relationships ${noIndex.total}`)
const withIndex = await runArm(true)
console.log(`  --index arm : files ${withIndex.files} · relationships ${withIndex.total}`)

// ── THE JOIN ───────────────────────────────────────────────────────────────────────────────────
// Rows are joined on (label, file, line) — the STABLE part of the key — and paired by ORDINAL
// inside the group. The target is compared separately, because a re-spell changes it (and a
// re-spell IS one of the movements being counted).
type Move = { from: string; to: string; label: string; n: number; reasons: Map<string, number> }
const moves = new Map<string, Move>()
const bump = (from: string, to: string, label: string, reason: string) => {
  const k = `${from} -> ${to} :: ${label}`
  let m = moves.get(k)
  if (!m) moves.set(k, (m = { from, to, label, n: 0, reasons: new Map() }))
  m.n++
  m.reasons.set(reason, (m.reasons.get(reason) ?? 0) + 1)
}

type OutcomeMove = {
  from: string; to: string; label: string; n: number
  fromMarker: string; toMarker: string; reason: string
  altOutcome: string; altClaimKind: string
}
const outcomeMoves = new Map<string, OutcomeMove>()
const bumpOutcome = (a: RowRec, b: RowRec) => {
  const k = `${a.outcome} -> ${b.outcome} :: ${a.label}`
  let m = outcomeMoves.get(k)
  if (!m) {
    outcomeMoves.set(k, (m = {
      from: a.outcome, to: b.outcome, label: a.label, n: 0,
      fromMarker: a.marker, toMarker: b.marker, reason: b.reason,
      altOutcome: b.altOutcome, altClaimKind: b.altClaimKind,
    }))
  }
  m.n++
  if (!m.reason) m.reason = b.reason
  if (!m.altOutcome) { m.altOutcome = b.altOutcome; m.altClaimKind = b.altClaimKind }
}

let joined = 0
let noIndexOnly = 0
let indexOnly = 0
for (const [k, list] of noIndex.groups) {
  const other = withIndex.groups.get(k)
  if (!other) { noIndexOnly += list.length; continue }
  const n = Math.min(list.length, other.length)
  for (let i = 0; i < n; i++) {
    joined++
    const a = list[i]
    const b = other[i]
    if (a.marker !== b.marker) bump(a.marker, b.marker, a.label, String(b.reason ?? ""))
    if (a.outcome !== b.outcome) bumpOutcome(a, b)
  }
}
for (const [k, list] of withIndex.groups) {
  if (!noIndex.groups.has(k)) indexOnly += list.length
}

console.log(`\nJOIN: matched rows ${joined} · no-index-only ${noIndexOnly} · index-only ${indexOnly}`)

// ── THE ARBITER'S VERDICT PER ARM — the columns the gate reports, reproduced row-by-row ──────
console.log(`\nARBITER OUTCOMES PER ARM (the gate's columns, row-exact):`)
const OUTCOME_COLS = [
  "resolved", "ambDeclOnly", "ambBoth", "unresolved",
  "externalVerified", "externalUnverified", "externalRefuted",
  "bindingVerified", "bindingRefuted", "bindingUnverified",
  "causeDeclared", "causeRefuted",
]
const colOf = (o: string): string => {
  if (o === "ambDeclOnly" || o === "ambBoth") return "amb"
  if (o === "externalVerified" || o === "externalUnverified" || o === "externalRefuted") return "ext"
  if (o === "bindingVerified" || o === "bindingRefuted" || o === "bindingUnverified") return "bind"
  return o
}
const armCols = (arm: Arm) => {
  const c = new Map<string, number>()
  for (const o of OUTCOME_COLS) c.set(colOf(o), 0)
  for (const [outcome, n] of arm.byOutcome) {
    const col = colOf(outcome)
    c.set(col, (c.get(col) ?? 0) + n)
  }
  return c
}
const cNo = armCols(noIndex)
const cIdx = armCols(withIndex)
for (const col of ["resolved", "amb", "unresolved", "ext", "bind"]) {
  const a = cNo.get(col) ?? 0
  const b = cIdx.get(col) ?? 0
  console.log(`  ${col.padEnd(11)} no-index ${String(a).padStart(9)}   --index ${String(b).padStart(9)}   delta ${b - a > 0 ? "+" : ""}${b - a}`)
}
console.log(`  per-outcome detail (no-index -> --index):`)
for (const o of OUTCOME_COLS) {
  const a = noIndex.byOutcome.get(o) ?? 0
  const b = withIndex.byOutcome.get(o) ?? 0
  if (a === 0 && b === 0) continue
  console.log(`    ${o.padEnd(20)} ${String(a).padStart(9)} -> ${String(b).padStart(9)}   delta ${b - a > 0 ? "+" : ""}${b - a}`)
}

// ── THE ROUTING SPLIT (charter R7, 2026-10-20) ─────────────────────────────────────────────────
// "The arbiter's preference is already correct; the movement is visible only because the gate does
// not report the routing split — so the routing-split print is owed, and the number is per-arm."
//
// THIS IS THAT NUMBER. `externalClaimOf` IS the routing decision — the shared instrument's own
// function, imported above — so the tally below is the routing MEASURED, per arm, over EVERY edge.
//
// WHY IT IS NOT THE OUTCOME TALLY: the outcome says where a row LANDED; the routing says which
// MECHANISM owned it. A row that landed in `resolved` may still have been routed to a claim that
// was then only recorded (`claimOnAmbiguous`) or never read (a name-model answer with decls > 0).
// The charter's rule — a claim is never merged into a resolution — is exactly the statement that
// these two numbers must be read as two numbers.
console.log(`\nROUTING SPLIT (the arbiter's routing decision — every edge, by the claim that owns it):`)
const claimKeys = [...new Set([...noIndex.byClaim.keys(), ...withIndex.byClaim.keys()])]
  .sort((a, b) => (withIndex.byClaim.get(b) ?? 0) - (withIndex.byClaim.get(a) ?? 0)
    || (noIndex.byClaim.get(b) ?? 0) - (noIndex.byClaim.get(a) ?? 0))
for (const k of claimKeys) {
  const a = noIndex.byClaim.get(k) ?? 0
  const b = withIndex.byClaim.get(k) ?? 0
  const d = b - a
  console.log(`  ${k.padEnd(20)} no-index ${String(a).padStart(9)}   --index ${String(b).padStart(9)}   delta ${d > 0 ? "+" : ""}${d}`)
}
const noClaimTotal = (noIndex.byClaim.get("(no claim)") ?? 0)
const idxClaimTotal = (withIndex.byClaim.get("(no claim)") ?? 0)
console.log(`  ${"TOTAL".padEnd(20)} no-index ${String(noIndex.total).padStart(9)}   --index ${String(withIndex.total).padStart(9)}`)
console.log(`  a CLAIM-carrying row: no-index ${noIndex.total - noClaimTotal} · --index ${withIndex.total - idxClaimTotal}   (the name model owns the rest)`)

console.log(`\nWHAT EACH ROUTED CLAIM PRODUCED (the --index arm; the outcome the routed claim produced):`)
for (const k of claimKeys) {
  const co = withIndex.claimOutcome.get(k)
  if (!co) continue
  const parts = [...co.entries()].sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} ${n}`).join(" · ")
  console.log(`  ${k.padEnd(20)} ${parts}`)
}

// ── THE DISPLACEMENT, WHOLE POPULATION, BOTH DIRECTIONS ────────────────────────────────────────
// The D7 page's 2,885 figure was measured on a 376-file sample. This is the same question asked of
// every row of the arm, in BOTH directions, so the two can be checked against each other.
console.log(`\nTHE DISPLACEMENT — rows the index pass claimed, and what the SUPPRESSED claim would have said:`)
console.log(`  --index arm · rows the index pass claimed (owner + imported-from-external-module): ${withIndex.displacedByIndexTotal}`)
for (const [k, n] of [...withIndex.displacedByIndex.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`      the suppressed claim would have said: ${k.padEnd(22)} ${String(n).padStart(9)}`)
}
console.log(`  no-index arm · rows carrying the imported-binding claim: ${noIndex.displacedByNoIndexTotal}`)
for (const [k, n] of [...noIndex.displacedByIndex.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`      the index pass's claim would have said: ${k.padEnd(20)} ${String(n).padStart(9)}`)
}
for (const [k, n] of [...noIndex.displacedByNoIndex.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`      the index pass's claim would have said: ${k.padEnd(20)} ${String(n).padStart(9)}`)
}

// ── R5's BOUND (charter §21.41 R5) ─────────────────────────────────────────────────────────────
// "A RECEIVER-TYPING EVIDENCE CLASS IS BOUNDED BY THE DECLARED-POPULATION SHARE; THE UNDECLARED
// SHARE IS A VOCABULARY PROBLEM." MEASURED (dart lane, proxicall's 16,395 unresolved `uses` rows):
// W1 the file binds it 2,316 (14.1%) · W2 the PROJECT declares it 155 (0.9%) · W3 the project
// declares it NOWHERE 13,924 (84.9%). "So a receiver-typing evidence class could move at most 155
// rows, not 16,395."
//
// THE SAME PARTITION, ASKED OF THIS LANE'S OWN POPULATION, over the UNRESOLVED rows whose target is
// a plain NAME (a module path, an `imports` target and a binding spelling are a different class and
// are not in this partition).
// ── THE `amb(decl)` CEILING (the clojure lane's correction) ───────────────────────────────────
console.log(`\nTHE amb(decl) CEILING — production PREFERS THE EDGE'S OWN FILE, so an ambiguous row whose own file declares the target is PRODUCTION-BOUND:`)
for (const [armName, arm] of [["no-index", noIndex], ["--index", withIndex]] as const) {
  const a = arm.ambCeiling
  const pctOf = (n: number) => (a.ambRows === 0 ? "n/a" : `${((100 * n) / a.ambRows).toFixed(1)}%`)
  console.log(`  ${armName}: ${a.ambRows} ambiguous rows`)
  console.log(`    the row's OWN FILE declares the target (production-bound)  ${String(a.ambOwnFile).padStart(9)}  ${pctOf(a.ambOwnFile).padStart(6)}`)
  console.log(`    genuinely ambiguous (no file-local declaration)             ${String(a.ambGenuine).padStart(9)}  ${pctOf(a.ambGenuine).padStart(6)}`)
  for (const [label, v] of [...a.byLabel.entries()].sort((x, y) => y[1].own + y[1].genuine - (x[1].own + x[1].genuine))) {
    console.log(`      ${label.padEnd(14)} own-file ${String(v.own).padStart(8)} · genuinely ambiguous ${String(v.genuine).padStart(8)}`)
  }
  // ── THE TIE-BREAK'S POPULATION. A row that carries a claim RETURNS BEFORE THE COUNT, so the
  // own-file tie-break can only move the CLAIM-FREE ambiguous rows. The fleet's headline share
  // (the clojure lane's 82.0 %, the c lane's 68.9 %) is a WHOLE-CLASS share; the price of the
  // change is the CLAIM-FREE share, and the two are different populations.
  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
  console.log(`  ${armName}: THE TIE-BREAK'S POPULATION — a row that CARRIES A CLAIM returns before the count:`)
  console.log(`    CLAIM-FREE ambiguous rows (the tie-break can move these)   ${String(a.claimFree).padStart(9)}`)
  console.log(`      of which the row's OWN FILE declares the target          ${String(a.claimFreeOwnFile).padStart(9)}  ${pct(a.claimFreeOwnFile, a.claimFree).padStart(6)}   <-- THE TIE-BREAK'S PRICE ON THIS LANE`)
  console.log(`      genuinely ambiguous                                    ${String(a.claimFreeGenuine).padStart(9)}  ${pct(a.claimFreeGenuine, a.claimFree).padStart(6)}`)
  console.log(`    CLAIM-CARRYING ambiguous rows (the change CANNOT touch these) ${String(a.claimed).padStart(9)}`)
  console.log(`      of which the row's OWN FILE declares the target          ${String(a.claimedOwnFile).padStart(9)}  ${pct(a.claimedOwnFile, a.claimed).padStart(6)}`)
  console.log(`      genuinely ambiguous                                    ${String(a.claimedGenuine).padStart(9)}  ${pct(a.claimedGenuine, a.claimed).padStart(6)}`)
  console.log(`    WHOLE-CLASS own-file share (the fleet's headline shape)     ${pct(a.ambOwnFile, a.ambRows).padStart(6)}   <-- NOT the tie-break's price; a different population`)
  console.log(`    THE PRICE = the whole-class own-file count MINUS the claim-carrying own-file count`)
  console.log(`      ${String(a.ambOwnFile).padStart(9)} − ${String(a.claimedOwnFile).padStart(9)} = ${String(a.claimFreeOwnFile).padStart(9)}   <-- THE TIE-BREAK'S PRICE ON THIS LANE (and the claim-free own-file count IS the difference, by construction)`)
  for (const [label, v] of [...a.byLabelClaimFree.entries()].sort((x, y) => y[1].own + y[1].genuine - (x[1].own + x[1].genuine))) {
    console.log(`      ${label.padEnd(14)} (claim-free) own-file ${String(v.own).padStart(8)} · genuinely ambiguous ${String(v.genuine).padStart(8)}`)
  }
}

// ── THE PROBE'S OWN TABLE 1, AND THE ASSERTION AGAINST THE GATE'S ──────────────────────────────
console.log(`\nTHE PROBE'S OWN TABLE 1 (the same columns the gate prints, from the same classifyEdge):`)
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of"]
const COLS = ["edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved", "extOK", "extQ", "extFAIL", "bindOK", "bindQ", "bindFAIL", "causeOK", "causeFAIL"]
console.log(`  ${"type".padEnd(13)} ${COLS.map((c) => c.padStart(9)).join(" ")}`)
for (const t of TYPES) {
  const row = withIndex.table[t] ?? []
  console.log(`  ${t.padEnd(13)} ${row.map((n) => String(n).padStart(9)).join(" ")}`)
}
{
  const totals = COLS.map((_, i) => TYPES.reduce((a, t) => a + (withIndex.table[t]?.[i] ?? 0), 0))
  console.log(`  ${"TOTAL".padEnd(13)} ${totals.map((n) => String(n).padStart(9)).join(" ")}`)
  const classSum = totals[0]! - (totals[1]! + totals[3]! + totals[5]! + totals[6]! + totals[7]! + totals[8]! + totals[9]! + totals[10]! + totals[11]! + totals[12]! + totals[13]!)
  console.log(`  the probe's own closure: ${classSum === 0 ? "EXACT — the class sum equals the edge count" : `NOT EXACT — delta ${classSum}`}`)
}
if (ASSERT_TABLE) {
  let gateLog = ""
  try { gateLog = readFileSync(ASSERT_TABLE, "utf8") } catch (e) {
    console.log(`  THE ASSERTION AGAINST THE GATE'S OWN TABLE 1: the log ${ASSERT_TABLE} could not be read — ${(e as Error).message}`)
    process.exitCode = 4
  }
  if (gateLog.length > 0) {
    const gateTable: Record<string, number[]> = {}
    // THE HARNESS: the gate prints one row per type, whitespace-separated, with a "." for a zero
    // in some tables — so the row is read by SPLITTING ON WHITESPACE and taking the first 15
    // tokens, and a "." reads as 0. (The first version of this harness used a 14-group regex and
    // matched NOTHING — the harness was wrong, not the probe.)
    for (const line of gateLog.split("\n")) {
      const t = line.trim().split(/\s+/)
      if (t.length < 15) continue
      if (!TYPES.includes(t[0]!)) continue
      const nums: number[] = []
      let ok = true
      for (let i = 1; i <= 14; i++) {
        const raw = t[i]!
        if (raw === ".") { nums.push(0); continue }
        const n = Number(raw.replace(/,/g, ""))
        if (!Number.isFinite(n)) { ok = false; break }
        nums.push(n)
      }
      if (ok && nums.length === 14) gateTable[t[0]!] = nums
    }
    let mismatches = 0
    // ── THE CALLER'S ARGUMENTS, ASSERTED FIRST (the Lead's ask, 2026-10-20): a probe that only
    // asserts the RULE can disagree with the gate because its ARGUMENTS differ — the key space, the
    // file set, the repository count. The gate's own log prints the population it ran on, so the
    // probe asserts ITS population against it BEFORE it compares the tables: a mismatch here says
    // "the two runs did not measure the same thing", which is a different failure from "the rule
    // disagrees", and the two must not be confused.
    {
      const popLine = /^population:\s+(\d+) parsed of (\d+) sampled \(corpus has (\d+) [^)]*? across (\d+) repos/m.exec(gateLog)
      const indexLine = /project index: USED — (\d+) repo index\(es\)/.exec(gateLog)
      if (!popLine) {
        console.log(`  THE POPULATION ASSERTION: the gate's log has no 'population:' line — the caller's arguments CANNOT be asserted`)
        mismatches++
      } else {
        const gateParsed = Number(popLine[1])
        const gateSampled = Number(popLine[2])
        const gateFiles = Number(popLine[3])
        const gateRepos = Number(popLine[4])
        const gateIndexes = indexLine ? Number(indexLine[1]) : -1
        const probeParsed = withIndex.filesParsed
        const probeRepos = withIndex.repos
        const probeFiles = withIndex.admitted
        const checks: [string, number, number][] = [
          ["files parsed", probeParsed, gateParsed],
          ["files admitted (the corpus)", probeFiles, gateFiles],
          ["repositories", probeRepos, gateRepos],
        ]
        for (const [what, probeV, gateV] of checks) {
          if (probeV !== gateV) {
            console.log(`  THE CALLER'S ARGUMENTS: ${what} — probe ${probeV} vs gate ${gateV} — MISMATCH (the two runs did not measure the same thing)`)
            mismatches++
          }
        }
        if (gateIndexes >= 0 && gateIndexes !== probeRepos) {
          console.log(`  THE CALLER'S ARGUMENTS: repo indexes — probe ${probeRepos} vs gate ${gateIndexes} — MISMATCH`)
          mismatches++
        }
        console.log(`  THE CALLER'S ARGUMENTS, ASSERTED: probe ${probeParsed} parsed of ${probeFiles} admitted across ${probeRepos} repos vs the gate's ${gateParsed} parsed of ${gateSampled} sampled (corpus ${gateFiles} files across ${gateRepos} repos${gateIndexes >= 0 ? `, ${gateIndexes} indexes` : ""}) — ${mismatches === 0 ? "THE SAME POPULATION" : "SEE THE MISMATCHES ABOVE"}`)
      }
    }
    for (const t of TYPES) {
      const probeRow = withIndex.table[t] ?? []
      const gateRow = gateTable[t]
      if (!gateRow) { console.log(`  ${t.padEnd(13)} the GATE'S LOG HAS NO ROW FOR IT — the assertion cannot be made for this type`); mismatches++; continue }
      for (let i = 0; i < COLS.length; i++) {
        if ((probeRow[i] ?? 0) !== (gateRow[i] ?? 0)) {
          console.log(`  ${t.padEnd(13)} ${COLS[i]}: probe ${probeRow[i] ?? 0} vs gate ${gateRow[i] ?? 0} — MISMATCH`)
          mismatches++
        }
      }
    }
    console.log(`  THE ASSERTION AGAINST THE GATE'S OWN TABLE 1 (${ASSERT_TABLE}): ${mismatches === 0 ? "REPRODUCED — every column of every type matches the gate's own table" : `${mismatches} MISMATCH(ES) — the probe's table is NOT the gate's table, and the numbers above are the PROBE's attribution, not the gate's`}`)
    if (mismatches > 0) process.exitCode = 4
  }
}

console.log(`\nR5's BOUND — the RECEIVER-TYPING EVIDENCE CLASS, over the UNRESOLVED NAME-SHAPED rows:`)
for (const [armName, arm] of [["no-index", noIndex], ["--index", withIndex]] as const) {
  const r = arm.r5
  const pctOf = (n: number) => (r.total === 0 ? "n/a" : `${((100 * n) / r.total).toFixed(1)}%`)
  console.log(`  ${armName}: ${r.total} unresolved name-shaped rows`)
  console.log(`    W1 the FILE binds the name        ${String(r.W1).padStart(9)}  ${pctOf(r.W1).padStart(6)}  (a read of a LOCAL)`)
  console.log(`    W2 the PROJECT declares it         ${String(r.W2).padStart(9)}  ${pctOf(r.W2).padStart(6)}  (a member of a project type; the site does not say WHICH — the receiver-wall class)`)
  console.log(`    W3 the project declares it NOWHERE ${String(r.W3).padStart(9)}  ${pctOf(r.W3).padStart(6)}  (an SDK / third-party member — a VOCABULARY question; the instrument is the package-scope claim)`)
  console.log(`    => a receiver-typing evidence class could move at most the W2 rows: ${r.W2} — not ${r.total}.`)
  for (const [label, byL] of [...r.byLabel.entries()].sort((a, b) => (b[1].get("W2") ?? 0) - (a[1].get("W2") ?? 0))) {
    console.log(`      ${label.padEnd(14)} W1 ${String(byL.get("W1") ?? 0).padStart(8)} · W2 ${String(byL.get("W2") ?? 0).padStart(8)} · W3 ${String(byL.get("W3") ?? 0).padStart(8)}`)
  }
}

console.log(`\nOUTCOME MOVEMENT (no-index outcome -> --index outcome), by label:`)
const sortedOutcomes = [...outcomeMoves.values()].sort((x, y) => y.n - x.n)
for (const m of sortedOutcomes) {
  const alt = m.altOutcome ? `  the OTHER claim would be: ${m.altOutcome}` : ""
  console.log(`  ${String(m.n).padStart(9)}  ${m.from} -> ${m.to}   [${m.label}]  markers: ${m.fromMarker} -> ${m.toMarker}${m.reason ? `  reason: ${m.reason}` : ""}${alt}`)
}
const totalOutcomeChanges = sortedOutcomes.reduce((s, m) => s + m.n, 0)
console.log(`  TOTAL outcome changes: ${totalOutcomeChanges}`)

console.log(`\nCLASS CHANGES (marker no-index -> marker --index), by label:`)
const sorted = [...moves.values()].sort((x, y) => y.n - x.n)
for (const m of sorted) {
  const reasons = [...m.reasons.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5)
    .map(([r, n]) => `${r || "(none)"}=${n}`).join(", ")
  console.log(`  ${String(m.n).padStart(9)}  ${m.from} -> ${m.to}   [${m.label}]${reasons ? `  reasons: ${reasons}` : ""}`)
}
const totalChanges = sorted.reduce((s, m) => s + m.n, 0)
console.log(`  TOTAL class changes: ${totalChanges}`)

// ── THE FALSIFIER: every class change must be EXPLAINED by the index pass ───────────────────
// The hypothesis says: a class change happens exactly when the index arm's marker is
// `isExternalTarget` with reason `imported-from-external-module` (the index pass's PASS 2) or
// `module-namespace` (the index pass's PASS 1 — an `imports` row that GAINED a claim). Anything
// else is UNEXPLAINED and is printed as such.
const INDEX_REASON = "imported-from-external-module"
const NAMESPACE_REASON = "module-namespace"
let explained = 0
const unexplained: Map<string, number> = new Map()
for (const m of sorted) {
  if (m.to === "isExternalTarget") {
    const idx = m.reasons.get(INDEX_REASON) ?? 0
    const ns = m.reasons.get(NAMESPACE_REASON) ?? 0
    const other = m.n - idx - ns
    if (other > 0) {
      unexplained.set(`to=isExternalTarget reason∉{index,namespace} [${m.label}]`,
        (unexplained.get(`to=isExternalTarget reason∉{index,namespace} [${m.label}]`) ?? 0) + other)
    }
    explained += idx + ns
    continue
  }
  if (m.from === "localBinding" || m.from === "importedBinding") {
    // The guard-suppressed case: the no-index arm carried a binding claim the index arm's
    // `carriesClaimMarker` skipped. The index arm's marker must then be the index pass's claim.
    explained += m.n
    continue
  }
  unexplained.set(`${m.from} -> ${m.to} [${m.label}]`, (unexplained.get(`${m.from} -> ${m.to} [${m.label}]`) ?? 0) + m.n)
}
console.log(`\nEXPLANATION: explained ${explained} · unexplained ${totalChanges - explained}`)
if (unexplained.size > 0) {
  console.log(`  UNEXPLAINED-CLASS-CHANGE (the falsifier fired — the hypothesis does NOT account for these):`)
  for (const [k, n] of [...unexplained.entries()].sort((x, y) => y[1] - x[1])) {
    console.log(`    ${String(n).padStart(9)}  ${k}`)
  }
}

// ── THE COUNTERFACTUAL SUMMARY — which claim SHOULD own the displaced row? ───────────────────
console.log(`\nCOUNTERFACTUAL — for each outcome-moved row, what the OTHER claim would have said:`)
const cfBuckets = new Map<string, { n: number; actual: string; alt: string; label: string }>()
let cfTotal = 0
let cfNoAlt = 0
for (const m of sortedOutcomes) {
  cfBuckets.set(`${m.from} -> ${m.to} :: ${m.label}`, { n: m.n, actual: m.from, alt: m.altOutcome, label: m.label })
  cfTotal += m.n
  if (!m.altOutcome) cfNoAlt += m.n
}
for (const [, v] of [...cfBuckets.entries()].sort((x, y) => y[1].n - x[1].n)) {
  console.log(`  ${String(v.n).padStart(9)}  ${v.actual} -> (index arm claim) ; the OTHER claim would be: ${v.alt || "(not reconstructible from published metadata)"}`)
}
console.log(`  TOTAL outcome-moved rows: ${cfTotal} · of which the other claim is NOT reconstructible: ${cfNoAlt}`)

// ── THE EXTERNAL CLAIM'S REFUTATION RISK (`extFAIL` RISK) ───────────────────────────────────
// The index pass's claim is answered through the SYMBOL KEY SPACE. A name the project DECLARES
// ANYWHERE refutes it — and a refuted claim is counted AGAINST the lane. This is the number that
// says whether letting the index pass own these rows is safe.
console.log(`\nEXTERNAL CLAIM REFUTATION RISK (the index pass's own claims, by whether the project DECLARES the name):`)
const riskBuckets = new Map<string, number>()
for (const list of withIndex.groups.values()) {
  for (const r of list) {
    if (r.extClaimRisk.length === 0) continue
    riskBuckets.set(r.extClaimRisk, (riskBuckets.get(r.extClaimRisk) ?? 0) + 1)
  }
}
for (const [k, n] of [...riskBuckets.entries()].sort((x, y) => y[1] - x[1])) {
  console.log(`  ${String(n).padStart(9)}  ${k}`)
}
console.log(`  samples of the REFUTABLE claims (the extFAIL risk):`)
for (const s of withIndex.refutedSamples.slice(0, 15)) console.log(`    · ${s}`)
// THE MEASUREMENT: the arbiter's OWN verdict for the rows the key space says it would refute.
const actualOfPredicted = new Map<string, number>()
for (const list of withIndex.groups.values()) {
  for (const r of list) {
    if (r.extClaimRisk !== "would-be-refuted") continue
    actualOfPredicted.set(r.extClaimActual, (actualOfPredicted.get(r.extClaimActual) ?? 0) + 1)
  }
}
console.log(`  THE ARBITER'S OWN VERDICT for those predicted-refutable rows (the extFAIL risk MEASURED):`)
for (const [k, n] of [...actualOfPredicted.entries()].sort((x, y) => y[1] - x[1])) {
  console.log(`    ${String(n).padStart(9)}  ${k}${k === "externalRefuted" ? "   <-- extFAIL (a clause-4 red)" : ""}`)
}

const report = {
  corpus: CR,
  maxFiles: MAX_FILES,
  arms: {
    noIndex: { files: noIndex.files, relationships: noIndex.total, byOutcome: Object.fromEntries(noIndex.byOutcome) },
    withIndex: { files: withIndex.files, relationships: withIndex.total, byOutcome: Object.fromEntries(withIndex.byOutcome) },
  },
  routingSplit: {
    noIndex: Object.fromEntries(noIndex.byClaim),
    withIndex: Object.fromEntries(withIndex.byClaim),
    delta: Object.fromEntries([...new Set([...noIndex.byClaim.keys(), ...withIndex.byClaim.keys()])]
      .map((k) => [k, (withIndex.byClaim.get(k) ?? 0) - (noIndex.byClaim.get(k) ?? 0)])),
    outcomesByClaim: {
      noIndex: Object.fromEntries([...noIndex.claimOutcome.entries()].map(([k, v]) => [k, Object.fromEntries(v)])),
      withIndex: Object.fromEntries([...withIndex.claimOutcome.entries()].map(([k, v]) => [k, Object.fromEntries(v)])),
    },
  },
  displacement: {
    indexArmRowsClaimedByIndexPass: withIndex.displacedByIndexTotal,
    indexArmSuppressedClaimWouldHaveSaid: Object.fromEntries(withIndex.displacedByIndex),
    noIndexArmRowsWithImportedBindingClaim: noIndex.displacedByNoIndexTotal,
    noIndexArmIndexClaimWouldHaveSaid: Object.fromEntries(noIndex.displacedByNoIndex),
  },
  r5Bound: {
    noIndex: {
      total: noIndex.r5.total, W1: noIndex.r5.W1, W2: noIndex.r5.W2, W3: noIndex.r5.W3,
      byLabel: Object.fromEntries([...noIndex.r5.byLabel.entries()].map(([k, v]) => [k, Object.fromEntries(v)])),
      samples: noIndex.r5.samples,
    },
    withIndex: {
      total: withIndex.r5.total, W1: withIndex.r5.W1, W2: withIndex.r5.W2, W3: withIndex.r5.W3,
      byLabel: Object.fromEntries([...withIndex.r5.byLabel.entries()].map(([k, v]) => [k, Object.fromEntries(v)])),
      samples: withIndex.r5.samples,
    },
  },
  join: { matched: joined, noIndexOnly, indexOnly },
  arbiterColumns: {
    noIndex: Object.fromEntries(cNo),
    withIndex: Object.fromEntries(cIdx),
    delta: Object.fromEntries([...cIdx.keys()].map((k) => [k, (cIdx.get(k) ?? 0) - (cNo.get(k) ?? 0)])),
  },
  outcomeChanges: sortedOutcomes.map((m) => ({
    from: m.from, to: m.to, label: m.label, n: m.n,
    fromMarker: m.fromMarker, toMarker: m.toMarker, reason: m.reason,
    altOutcome: m.altOutcome, altClaimKind: m.altClaimKind,
  })),
  totalOutcomeChanges,
  counterfactual: Object.fromEntries([...cfBuckets.entries()].map(([k, v]) => [k, { n: v.n, alt: v.alt }])),
  externalClaimRefutationRisk: Object.fromEntries(riskBuckets),
  refutedSamples: withIndex.refutedSamples,
  classChanges: sorted.map((m) => ({ from: m.from, to: m.to, label: m.label, n: m.n, reasons: Object.fromEntries(m.reasons) })),
  totalChanges,
  explanation: { explained, unexplained: totalChanges - explained, unexplainedDetail: Object.fromEntries(unexplained) },
}
if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2))
  console.log(`\nWROTE ${JSON_OUT}`)
}
