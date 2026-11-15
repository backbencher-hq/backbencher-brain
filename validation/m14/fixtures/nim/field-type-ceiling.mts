/**
 * FIELD-TYPE CEILING — how many of this lane's B1 ambiguity a correct per-file
 * field-type resolution could actually recover.
 *
 * ## The question
 *
 * The three-way split (`ambiguity-classify.ts`) puts B1 SCOPE-COLLAPSED at 998 of 8,175
 * ambiguous edges, and it is the only one of the three buckets this analyzer owns. Its
 * largest shape is `ownerCollision` (654): a name declared twice in ONE file at two
 * different scopes, published bare both times, so the edge cannot say which.
 *
 * `graphql-nim/playground/swapi.nim` is the canonical case and it is worth reading
 * because it is small and it is exactly the shape:
 *
 *     Character = ref object of RootRef        Starship = ref object
 *       id: string                               id: string
 *       name: string                             name: string
 *
 *     proc charToResp(ctx: Starwars, c: Character): Node =
 *       resp["id"] = resp(c.id)                 # line 158
 *
 * `id` is declared at `Character` (line 38) AND at `Starship` (line 53). The analyzer
 * emits `uses charToResp -> id` — bare — so the name is ambiguous inside its own file.
 * The correct target is `Character.id`, and the file says which: `c` is a parameter of
 * `charToResp` declared `c: Character`, and the edge's own metadata already carries the
 * receiver as `fieldAccessExpression: "c.id"`.
 *
 * So the fix is not "publish a qualified name" (which would move every `contains` edge
 * off the store's line rule — *Limitations* 37). It is: when a member-access edge names
 * a base that is a parameter of the enclosing callable, and that parameter has a declared
 * type, qualify the TARGET with that type. That is per-file, needs no import graph, and
 * cannot fabricate an edge — the type comes from the same parse tree as the edge.
 *
 * ## Why measure the ceiling BEFORE building it
 *
 * The brief's rule is that an overturn condition a correct implementation cannot meet is
 * decorative. The same applies to a fix: if the shape covers 40 edges, the honest report
 * is "40, and here they are", not a landed change with 40 edges of value. This file
 * answers the count WITHOUT touching the analyzer, from the published `ParseResult` only,
 * and it prints every qualifying edge so the count can be checked rather than believed.
 *
 * ## What counts as recoverable, precisely
 *
 * An ambiguous edge is recoverable iff ALL FOUR hold. Each clause is there because
 * dropping it would let a wrong edge in:
 *
 *   1. the edge is `uses` or `calls` carrying `fieldAccessExpression` (so the receiver
 *      is spelled out and is not a guess);
 *   2. the receiver's BASE is a parameter of the edge's SOURCE symbol, by name;
 *   3. that parameter has a declared TYPE, and the type's bare name is declared in the
 *      SAME FILE as a type/class/struct/enum — i.e. the qualifier is not invented;
 *   4. qualifying the target to `Type.name` makes it resolve to EXACTLY ONE declaration
 *      in the file's own symbol set (so the fix cannot manufacture a new collision).
 *
 * Clause 4 is the load-bearing one and it is checked against the published symbol set,
 * not against a count.
 *
 * ## What it does NOT claim
 *
 * It does not claim the recovered edges would be CORRECT — only that they are
 * RECOVERABLE by a rule whose input is all in the parse tree. Whether Nim's own name
 * resolution agrees at each site is a semantic question this probe does not answer, and
 * the oracle cross-check, not this file, is what would say.
 */
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = (import.meta as any).dirname ?? "."
const REPO = path.resolve(HERE, "../../../..")
const ANALYZER = path.join(REPO, "src/ast/real-nim-analyzer.ts")
const LIST = process.env.BB_NIM_LIST
  ? path.resolve(process.env.BB_NIM_LIST)
  : path.join(REPO, "validation/m14/measurements/nim/session13-file-list.txt")
const OUT_JSON = process.argv[2]
const OUT_TXT = process.argv[3]

const sha = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex")
const ANALYZER_SHA = sha(readFileSync(ANALYZER))
const LIST_SHA = sha(readFileSync(LIST))

const TYPE_DECLS = new Set(["class", "interface", "struct", "type", "enum", "enum_type", "concept"])

type Rec = {
  file: string
  src: string
  tgt: string
  type: string
  conf: number
  memberExpr: string
  receiverKind: string
  base: string
  paramType: string
  qualified: string
  fileDecls: number
  ownedByParamType: number
  fileUnique: boolean
  gDecls: number
  gUnique: boolean
  reason: string
}

const records: Rec[] = []
const rejected = new Map<string, number>()
const reject = (r: string): void => rejected.set(r, (rejected.get(r) ?? 0) + 1)

const files = readFileSync(LIST, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)

/**
 * SERIAL, deliberately. A first cut walked the 600 files under `Promise.all` and the
 * run reported `edges 96` over a window where the same corpus yields 29,650: forty-odd
 * `[BB-PARSE-ERR] … Language.load failed for nim: load timeout` lines appeared, because
 * concurrent first-use of the grammar races its own load. A reader would have taken
 * `edges 96` as a measurement of the analyzer. `ambiguity-classify.ts` walks serially for
 * the same reason and is the shape to copy.
 */
const results: any[] = []
for (const f of files) {
  results.push(await parseFile(f).catch(() => undefined))
}

let parsed = 0, failed = 0, degraded = 0, totalEdges = 0
const memberEdges: Record<string, number> = {}

/**
 * THE GLOBAL INDEX, and why a per-file answer is not the answer.
 *
 * The store resolves a dotted target by EXACT qualified-name match
 * (`parallel-indexer.ts:3768-3779`, Strategy 1: `target_external = _res_qname.qualified_name`),
 * and `_res_qname` is deduplicated with `MIN(id)` — so a qualified name declared in two
 * files does not fail, it picks a deterministic winner. That is the trap: a rule that
 * makes `Character.id` unique INSIDE one file can still be ambiguous ACROSS the window,
 * and the edge then silently attaches to whichever file sorts first. That is a migration
 * from B1 to B2 wearing the costume of a fix, which is the exact outcome
 * `ambiguity-classify.ts` was built to distinguish.
 *
 * So every candidate is ALSO scored against a global qualified-name index built from the
 * same 600-file walk. `gDecls` is how many declarations in the whole window publish that
 * qualified name, and the recoverable set is those with `gDecls === 1`.
 *
 * `qualifiedName` is reproduced the way the STORE reproduces it, not the way the analyzer
 * writes it (`pool-worker.ts:930`):
 *     s.qualifiedName || s.metadata?.fqn || (s.scope ? `${s.scope}.${s.name}` : s.name)
 * An object field sets neither `qualifiedName` nor `fqn`, so it falls to the `scope`
 * branch — which is why a field IS reachable by `Type.field` and needs no new name
 * surface to be targeted. An earlier cut of this file's own doc asserted the opposite
 * ("an object field publishes no qualified name") and was wrong; the fixture
 * `field-receiver.expectation.json` now pins the spelling that makes it checkable.
 */
const qualNameOf = (s: any): string => {
  const q = s?.qualifiedName
  if (typeof q === "string" && q.length > 0) return q
  const fqn = s?.metadata?.fqn
  if (typeof fqn === "string" && fqn.length > 0) return fqn
  const scp = s?.scope
  return scp ? `${scp}.${s?.name}` : String(s?.name ?? "")
}
const globalQual = new Map<string, number>()
const globalName = new Map<string, number>()
for (let fi = 0; fi < files.length; fi++) {
  const r = results[fi]
  if (!r) continue
  for (const s of (r as any).symbols ?? []) {
    const q = qualNameOf(s)
    if (q) globalQual.set(q, (globalQual.get(q) ?? 0) + 1)
    const n = String(s?.name ?? "")
    if (n) globalName.set(n, (globalName.get(n) ?? 0) + 1)
  }
}

for (let fi = 0; fi < files.length; fi++) {
  const r = results[fi]
  if (!r) { failed++; continue }
  parsed++
  if ((r as any).degraded) degraded++

  const symbols: any[] = (r as any).symbols ?? []
  const rels: any[] = (r as any).relationships ?? []

  // symbols by name, per file
  const byName = new Map<string, any[]>()
  for (const s of symbols) {
    const n = String(s?.name ?? "")
    if (!n) continue
    if (!byName.has(n)) byName.set(n, [])
    byName.get(n)!.push(s)
  }
  // source symbol by name (the edge's source is a published declaration name)
  const srcByName = new Map<string, any>()
  for (const s of symbols) {
    const n = String(s?.name ?? "")
    if (n && !srcByName.has(n)) srcByName.set(n, s)
  }
  // locally declared type names -> how many declarations bear that name
  const typeNameCounts = new Map<string, number>()
  for (const s of symbols) {
    const k = String(s?.kind ?? "")
    if (!TYPE_DECLS.has(k)) continue
    const n = String(s?.name ?? "")
    if (!n) continue
    typeNameCounts.set(n, (typeNameCounts.get(n) ?? 0) + 1)
  }

  for (const rel of rels) {
    totalEdges++
    const t = String(rel?.type ?? rel?.relationshipType ?? "")
    if (t !== "uses" && t !== "calls") continue
    const meta = (rel as any).metadata ?? {}
    // BOTH receiver spellings. The member-access branch carries `fieldAccessExpression`
    // ("c.id") and the UFCS-callable branch carries `callExpression` ("ctx.charToResp(n)").
    // The first cut read only the former and so reported 0 recoverable `calls` edges while
    // the ambiguity classify put 185 B1 `calls` edges in the bucket being costed — the
    // probe was under-counting its own question by ignoring a metadata key the analyzer
    // writes on the same walk.
    const kind = meta.fieldAccessExpression ? "fieldAccessExpression"
      : meta.callExpression ? "callExpression" : ""
    const expr = String(kind ? meta[kind] : "")
    if (!expr) { reject("no receiver-bearing metadata"); continue }
    memberEdges[t] = (memberEdges[t] ?? 0) + 1

    const tgt = String(rel?.target ?? "")
    const tgt0 = tgt
    if (!tgt || tgt.includes(".")) { reject("target already qualified"); continue }

    // the edge is only interesting if its bare target is ambiguous IN THIS FILE
    const decls = byName.get(tgt)
    if (!decls || decls.length < 2) { reject("target not multi-declared in this file"); continue }

    // For a call the receiver is the part before the LAST dot of the CALLEE, so the
    // argument list has to come off first: `ctx.charToResp(n)` -> `ctx.charToResp`.
    const callee = kind === "callExpression" ? expr.replace(/\s*\(.*$/s, "").trim() : expr
    const dot = callee.lastIndexOf(".")
    if (dot <= 0) { reject("no base in member expression"); continue }
    const base = callee.slice(0, dot).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(base)) { reject("base is not a bare identifier"); continue }
    // the callee's own leaf is the target of a `calls` edge and must match, else the
    // expression is not the one this edge is about
    if (kind === "callExpression" && callee.slice(dot + 1) !== tgt0) {
      reject("call expression callee does not match the edge target"); continue
    }

    const srcName = String(rel?.source ?? "")
    const srcSym = srcByName.get(srcName)
    if (!srcSym) { reject("source symbol not published in this file"); continue }
    const params: any[] = srcSym.parameters ?? []
    const param = params.find((p: any) => String(p?.name ?? "") === base)
    if (!param) { reject("base is not a parameter of the source"); continue }
    const declared = String(param.type ?? "").trim()
    if (!declared) { reject("parameter has no declared type"); continue }
    const bareType = declared.replace(/\*$/, "").trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(bareType)) { reject("parameter type is not a bare type name"); continue }
    const tc = typeNameCounts.get(bareType) ?? 0
    if (tc === 0) { reject("parameter type is not declared as a type in this file"); continue }

    const qualified = `${bareType}.${tgt}`
    // CLAUSE 4, done against SCOPE OWNERSHIP rather than against a published name.
    // The first cut asked whether a symbol was published as `Type.name` and therefore
    // read 0 recoverable on a window where 53 candidates exist — the check could never
    // pass, because the whole premise is that no symbol IS published that way yet. The
    // question is whether the qualified SPELLING identifies exactly one declaration, so
    // it has to be scored over the same-named declarations and ask which of them the
    // qualifier picks. Owner is `ownerName` (a method's receiver, set at
    // real-nim-analyzer.ts:610) or `scope` (an enclosing callable, :589); a member field
    // carries its owner in `scope` when the file records one.
    const owned = decls.filter((d) => {
      const own = String(d?.ownerName ?? "")
      const scp = String(d?.scope ?? "")
      return own === bareType || scp === bareType
    })
    const gDecls = globalQual.get(qualified) ?? 0
    records.push({
      file: files[fi],
      src: srcName,
      tgt,
      type: t,
      conf: Number((rel as any).confidence ?? 0),
      memberExpr: expr,
      receiverKind: kind,
      base,
      paramType: bareType,
      qualified,
      fileDecls: decls.length,
      ownedByParamType: owned.length,
      fileUnique: owned.length === 1,
      gDecls,
      gUnique: gDecls === 1,
      reason: owned.length === 0 ? "no same-file declaration of tgt is owned by the param type"
        : owned.length > 1 ? "the param type owns more than one same-named declaration"
        : "",
    })
  }
}

/** RECOVERABLE, stated at BOTH scopes, because they answer different questions and the
 *  gap between them IS the finding. `fileUnique` is what the rule fixes inside the edge's
 *  own file. `gUnique` is whether the store's exact-qualified-name match would then bind
 *  it at all, or bind it to `MIN(id)` across colliding files. */
const fileRecoverable = records.filter((r) => r.fileUnique)
const recoverable = records.filter((r) => r.fileUnique && r.gUnique)
const migratesToB2 = records.filter((r) => r.fileUnique && !r.gUnique)
const perFile: Record<string, number> = {}
for (const r of recoverable) perFile[r.file] = (perFile[r.file] ?? 0) + 1

const migrationsCollide = (rs: Rec[]): string[] => {
  const m = new Map<string, number>()
  for (const r of rs) m.set(r.qualified, (m.get(r.qualified) ?? 0) + 1)
  return [...m.keys()].slice(0, 8)
}

const lines: string[] = []
const say = (s = ""): void => { lines.push(s); console.log(s) }

say(`nim field-type ceiling — ${files.length} file(s), analyzer ${ANALYZER_SHA.slice(0, 16)}`)
say(`file list ${path.basename(LIST)} sha256 ${LIST_SHA.slice(0, 16)}`)
say(`parsed ${parsed}  failed ${failed}  degraded ${degraded}  edges ${totalEdges}`)
say()
say(`uses/calls edges carrying a receiver-bearing metadata key: ${JSON.stringify(memberEdges)}`)
say()
say(`candidate uses/calls edges whose target is multi-declared in their OWN file: ${records.length}`)
for (const [k, v] of [...rejected.entries()].sort((a, b) => b[1] - a[1])) say(`  rejected ${k.padEnd(46)} ${v}`)
say()
say(`FILE-UNIQUE — <paramType>.<tgt> selects exactly one of that type's same-named members`)
say(`  inside the edge's OWN file: ${fileRecoverable.length}`)
say(`GLOBALLY UNIQUE — the same spelling is published exactly once in the whole ${files.length}-file window,`)
say(`  which is what the store's Strategy 1 exact qualified_name match needs:`)
say(`  recoverable AND binding: ${recoverable.length}`)
say(`  recoverable inside the file but MIGRATES B1 -> B2 (the qualified name is published`)
say(`  ${migratesToB2.length ? `by more than one file, ${[...new Set(migrationsCollide(migratesToB2))].join(", ")}` : "nowhere else, 0 of them"}): ${migratesToB2.length}`)
say()
say(`per type (binding): ${JSON.stringify(recoverable.reduce<Record<string, number>>((a, r) => { a[r.type] = (a[r.type] ?? 0) + 1; return a }, {}))}`)
say(`per type (file-unique): ${JSON.stringify(fileRecoverable.reduce<Record<string, number>>((a, r) => { a[r.type] = (a[r.type] ?? 0) + 1; return a }, {}))}`)
say(`distinct files touched: ${Object.keys(perFile).length}`)
say(`top files: ${Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([f, n]) => `${n}@${f.split("/").slice(-2).join("/")}`).join("  ")}`)
say()
say("every qualifying edge, so the count can be checked rather than believed:")
for (const r of recoverable.slice(0, 60)) {
  say(`  ${r.type.padEnd(6)} ${r.src} -> ${r.qualified.padEnd(30)} (was "${r.tgt}")  via ${r.receiverKind.padEnd(22)} param ${r.base}: ${r.paramType}  decls(file)=${r.fileDecls} ownedByType=${r.ownedByParamType} globalDecls=${r.gDecls}  conf=${r.conf}`)
}
if (recoverable.length > 60) say(`  ... ${recoverable.length - 60} more, all in the JSON`)
say()
say(`candidates that reached clause 4 and FAILED it — ${records.length - recoverable.length} of ${records.length}:`)
for (const r of records.filter((x) => !x.fileUnique).slice(0, 20)) {
  say(`  ${r.type.padEnd(6)} ${r.src} -> ${r.qualified.padEnd(30)} via ${r.receiverKind.padEnd(22)} decls(file)=${r.fileDecls} ownedByType=${r.ownedByParamType}  ${r.reason}`)
}
if (records.length - recoverable.length > 20) say(`  ... ${records.length - recoverable.length - 20} more, all in the JSON`)

const out = {
  analyzerSha256: ANALYZER_SHA, fileList: path.basename(LIST), fileListSha256: LIST_SHA,
  files: files.length, parsed, failed, degraded, totalEdges,
  memberAccessEdges: memberEdges,
  candidates: records.length,
  rejected: Object.fromEntries(rejected),
  recoverable: recoverable.length,
  perFile,
  candidatesReachingClause4: records.length,
  fileUnique: fileRecoverable.length,
  recoverableAndBinding: recoverable.length,
  migratesToB2: migratesToB2.length,
  records,
}
if (OUT_JSON) writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n")
if (OUT_TXT) writeFileSync(OUT_TXT, lines.join("\n") + "\n")
