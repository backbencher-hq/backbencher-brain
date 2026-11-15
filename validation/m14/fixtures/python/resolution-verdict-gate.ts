/**
 * RESOLUTION-VERDICT GATE, PYTHON — the per-label contract, over the WHOLE population, as a fast
 * falsifiable check.
 *
 * `script/m14/python-endpoint-resolution.ts` is the instrument that MEASURES the verdict (it walks
 * all 11,488 files and decomposes every endpoint). This file READS its pinned artefact so the claim
 * can be re-checked in milliseconds and so the numbers a doc quotes have a machine that fails when
 * they move. The contract it holds is the one the lane is graded on:
 *
 *   1. every one of the ten labels is EMITTED (a lane that stops emitting a label is the worst
 *      regression, and it must be impossible for that to pass quietly);
 *   2. OUTGOING (source) UNRESOLVED is ZERO for every label — an edge whose source binds to nothing
 *      is a lie about WHAT made the edge;
 *   3. INCOMING (target) UNEXPLAINED is at most a DECLARED allowance per label, each with the CAUSE
 *      NAMED below. The allowance is a CEILING: a drop passes, a rise fails. It is not a target to
 *      reach — it is where the honest residual currently stands, and the cause is written down so
 *      the number is never read as "the analyzer is fine".
 *
 * WHAT EXPLAINS THE RESIDUAL (the axes the census keeps beside the number):
 *   declared-dynamic    the edge's own reasonCode says the target is chosen at runtime
 *   declared-local     `local-callee`: the callee is bound in an ENCLOSING FUNCTION's scope
 *                       (a nested `def`, a parameter, a local) — no project declaration exists
 *   declared-external   `external-member-call`: reachable through the file's own import edge
 *   qualified-external  the endpoint's dotted route is rooted at a module the file imported
 *   star-import-external PY-D19 (round 10): the file says `from M import *` (published on the
 *                       analyzer's own `imports` edge as `metadata.starImport`) and EVERY module it
 *                       star-imports is out of view — no dotted module path in this population
 *                       spells it, and none lives under it. A bare name has a real binding route
 *                       into M, and M cannot be checked from here.
 *   builtin             the name is one the interpreter owns (`dir(builtins)`)
 *   not-bound-in-file   PY-D25 (round 12): the edge's own reasonCode says the analyzer's binding
 *                       checks found no receiver, route or scope to bind to (`bare-name-callee` for
 *                       a call, `annotation-type`/`instanceof-check` for a reference), the file
 *                       does not import the leaf, and the target is unresolved against every
 *                       declaration in the population — i.e. "nothing in this file supplies this
 *                       name", which CPython's own scope chain re-checks row by row in
 *                       `not-bound-in-file-gate.mts` (a row it can see a binding for is a FAIL).
 *   shipped-submodule   ROUND 16: a BARE target nothing declares, which the population SHIPS as a
 *                       module beside the source file (`<dir>/<name>/__init__.py`, `<name>.py`).
 *                       Python's import system supplies such a name — a package's
 *                       `__all__ = ("mssql", ...)` re-exports SUBMODULES lazily — and a module is
 *                       not a DECLARATION, so a name index cannot hold it. 4 rows, all
 *                       `sqlalchemy/dialects/__init__.py`.
 *   stale-export        ROUND 16: a bare target the file's OWN `__all__` states, bound nowhere in
 *                       the file, with no module beside it, and mentioned by NO OTHER file of the
 *                       population — a stale public surface in the CORPUS, which the edge honestly
 *                       reports. 1 row: `ext/declarative/__init__.py -> instrument_declarative`.
 *                       Both of these are re-checked row by row, against CPython's `ast` and the
 *                       filesystem, by `export-residual-gate.mts`.
 * Those nine are NOT defects and are not counted here. Only the tenth axis is:
 *   UNEXPLAINED         none of the above — the number this gate bounds.
 *
 * Usage:
 *   bun validation/m14/fixtures/python/resolution-verdict-gate.ts
 *
 * REFRESH (only when the analyzer changes on purpose): re-run the instrument and re-copy the
 * artefact, then decide whether an allowance moved and WHY. The same run also writes the axis's own
 * row list (`not-bound-in-file.rows.txt`, beside the artefact) that the axis gate re-checks —
 *   npx tsx script/m14/python-endpoint-resolution.ts --out validation/m14/fixtures/python/resolution-verdict.current.json
 *
 * The gate REFUSES (exit 2) when the artefact is absent: a verdict gate that silently passes on a
 * missing measurement is worse than no gate, which is the lesson the lane's other corpus-pinned
 * instruments learned the hard way.
 */
import { readFileSync, existsSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ARTEFACT = path.join(HERE, "resolution-verdict.current.json")
const LANG = "python"
const EXPECTED_LABELS = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const

/**
 * The DECLARED allowance of UNEXPLAINED incoming targets per label, with its cause. A CEILING, not
 * a goal: it is the honest residual measured on the arbiter's 11,488-file population, and each
 * entry names WHY it is not zero so the number is never mistaken for a clean bill of health.
 */
const ALLOWANCE: Record<string, { cap: number; cause: string }> = {
  calls: {
    cap: 0,
    cause: "ROUND 12 CLOSED THIS AXIS: 55 -> 0 (round 11 had taken it 65 -> 55 with PY-D22, a comprehension's `for` target declared a scope binding). The 55 were three populations the round handled by the fact each one carries rather than by bulk. (1) 28 rows sit in files CPython itself cannot parse — 26 in the otp ASN.1 documents named `.py` (`BitStr -> SIZE`, `-> sunday`; CPython rejects 11 at LINE 1, one at line 2, one at line 2085), 1 in a Python 2 build script (`dart-sdk/build/mac/change_mach_o_flags.py`, `xrange`), 1 in nvim-treesitter's highlighter fragment (`quit_game`) — declared `not-bound-in-file`, with the file and the CPython line NAMED per row. (2) 27 rows are calls whose own reasonCode is `bare-name-callee` and whose name nothing in the file binds: the axis's claim, re-checked against CPython's scope chain one row at a time (semgrep's sample stubs, cython's dynamically-bound `frozendict`, ansible's `handler_type`, libxslt's C-extension-injected `stylesheet`/`transformCtxt`, `reveal_type`). (3) 1 row was a REAL DEFECT and is FIXED rather than excused: wagtail's `mixin`, a module-scope `for` TARGET that `extractAssignment` never published, now a module binding by PY-D23 (with `with … as` and `except … as` in the same method, priced at 503 module binders + 13 class binders with `.tmp-py/price-module-bindings.py`). That row is exactly why the axis was priced row by row before it was written instead of applied in bulk: a bulk application would have hidden the one gap. Ceiling 55 -> 0.",
  },
  uses: { cap: 0, cause: "every `uses` unresolved target is `member-read` — declared-dynamic by the receiver's unknowable type" },
  contains: { cap: 0, cause: "structural; every target is a name the source declares" },
  imports: { cap: 0, cause: "every target is `module:item` or an external package path" },
  references: {
    cap: 0,
    cause: "ROUND 12 CLOSED THIS AXIS: 34 -> 0, by the same three facts (round 11 had taken it 47 -> 34: PY-D21 published a multi-target assignment's names — 12 of the 12 priced rows — and PY-D22 relabelled the saleor comprehension row `local-binding-target`). 14 rows are the ASN.1 `BitStr -> SIZE`/`sunday`/`monday` family in files CPython rejects (named per row, `not-bound-in-file`). 16 rows are bare names CPython's scope chain agrees nothing in the file supplies — sqlalchemy's deliberately-undefined typing-test names (`Bogus`, `Lisst`, `UnavailableUser`), cython's `from … import this_cant_evaluate` PEP-563 probe, libxslt's injected names. The remaining 4 rows the round's price turned up were ATTRIBUTE reads rather than declarations: 3 are an `isinstance` type argument written as a member read (`mod.Thing`), which is now `member-read` -> declared-dynamic by PY-D24 (the rule published a member read as though it were a declaration), and 1 (ansible's `gdb`-injected `SignalEvent`) names nothing the file binds and joins the axis. Rounds 11's two mechanisms (PY-D21 47 -> 34, PY-D22's `local-binding-target`) stay measured underneath. Ceiling 34 -> 0.",
  },
  exports: {
    cap: 0,
    cause: "TWO OF THE SEVEN WERE CLOSED BY PY-D28 (round 14) and the five that remain are TWO mechanisms, not one — which is why the cap moved 7 -> 5 rather than to 0. PY-D28 publishes the names a module-level `__getattr__` SPELLS, and that is what `tree_sitter_clean/__init__.py -> HIGHLIGHTS_QUERY` and `-> TAGS_QUERY` were: the file's own `if name == \"HIGHLIGHTS_QUERY\": return ...` is a real runtime provision, priced at 26 files defining a module-level `__getattr__` with 14 literal names and 13 published (`.tmp-py/price-module-getattr-round14.py` + `.tmp-py/price-guard-narrowing.py`, checked by `.tmp-py/census-getattr-provisions.mts`; the other name is statically bound in its own file, and round 15's narrowing of the publication guard to MODULE-scope imports published the 2 a function-local import had been masking — totalSymbols 206,951 -> 206,953, and one `uses` row moved from EXTERNAL to RESOLVED because a name the runtime provides now has a declaration to bind to). The residual now decomposes exactly: 4 SUBMODULE rows (sqlalchemy's `dialects/__init__.py -> mssql/mysql/oracle/postgresql` — python's import system supplies the attribute because the package SHIPS `dialects/mssql/__init__.py`; the analyzed file writes no binding and no position to publish, so this belongs to the resolution layer, PY-D29) and 1 STALE `__all__` row (`ext/declarative/__init__.py -> instrument_declarative` — the file's `__all__` lists a name the file binds by nothing, imports by nothing, ships no submodule for and no `__getattr__` names; measured corpus-wide, 3043 `__all__` entries reduce to 6 such rows, PY-D30). Round 12's `not-bound-in-file` axis is deliberately NOT what closes this: it structurally cannot apply to an `exports` row (it requires a binding reasonCode, and an `exports` edge is the file's OWN statement rather than a resolved read), and applying it would erase the distinction these two rows carry. ROUND 16 CLOSED THE AXIS 5 -> 0 — not by relaxing a predicate, but by naming each row's cause with a checkable, GATED predicate of its own, and by saying plainly that the row is still UNRESOLVED as a name-declaration. (1) `shipped-submodule` — 4 rows: python's import system supplies the attribute because the population SHIPS the module beside the file (`dialects/mssql/__init__.py`, `mysql`, `oracle`, `postgresql`), and a MODULE is not a DECLARATION, which is exactly why a name index cannot hold it; the axis claims there is no defect in the row, NOT that the name resolves. (2) `stale-export` — 1 row: a bare name the file's own `__all__` states that NO OTHER file of 11,488 so much as MENTIONS (`instrument_declarative`, which SQLAlchemy dropped while leaving it in `__all__`) — a defect in the CORPUS, and the edge the file states is honest to emit. Both axes were PRICED before they were written, with CPython's `ast` and the filesystem rather than with this instrument (`.tmp-py/price-export-residual-r16.py`: 4 submodule / 1 stale / 0 rows fitting NEITHER predicate), and every row of both is re-checked against CPython's `ast` — the `__all__` literal, the file's complete binding set, the sibling path on disk and the population-wide mention count — by `validation/m14/fixtures/python/export-residual-gate.mts`: AGREE 4 + 1, DISAGREE 0, and the gate itself was FALSIFIED in three directions before being trusted (a 5th row the artefact does not carry; the stale-export row re-pointed at a name that IS bound and IS mentioned in 61 other files; a submodule row with no sibling on disk — all three FAIL, exit 1). HISTORY: UNCHANGED at 7 through rounds 8-12; 7 -> 5 (round 14, PY-D28's provisions, with round 15 narrowing the publication guard); 5 -> 0 (round 16, this decomposition).",
  },
  extends: {
    cap: 0,
    cause: "ROUND 8 CLOSED this axis and ROUND 9 left it at 0: all 15 rows were the same shape the reference side had just named — a base held in a local binding (`dump_cls = _py_row.BaseRow`, `TemplateIter = type(iter(t''))`) — so the extends emitter now asks `dynamicTypeBindingReason` too and emits `local-binding-target`. It is 0 for a measured reason rather than an assumption: the 15 are DECLARED (`unresolvedClass.declared-local`), not resolved and not silent.",
  },
  implements: { cap: 0, cause: "every target resolves, is external, or is a proven stdlib marker" },
  overrides: { cap: 0, cause: "targets are owner-qualified or MRO-verified" },
  instantiates: { cap: 0, cause: "every target is an in-file class constructor" },
}

const failures: string[] = []
const check = (ok: boolean, what: string, detail = ""): void => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`)
  if (!ok) failures.push(what)
}

if (!existsSync(ARTEFACT)) {
  console.error(`no artefact at ${ARTEFACT} — this gate refuses to pass without a measurement (regenerate with the command in its header)`)
  process.exit(2)
}
const v = JSON.parse(readFileSync(ARTEFACT, "utf8")) as any
if (v.lang !== LANG) { console.error(`artefact is for lang=${v.lang}, not ${LANG}`); process.exit(2) }

console.log(`python resolution verdict — artefact ${path.basename(ARTEFACT)}`)
console.log(`  population: ${v.filesParsed} files, ${v.totalSymbols} symbols, ${v.totalRelationships} relationships\n`)

// ---- 1. every label emitted ---------------------------------------------------------------
const missing: string[] = []
for (const t of EXPECTED_LABELS) {
  const n = v.types?.[t]?.count ?? 0
  if (n === 0) missing.push(t)
}
check(missing.length === 0, `every one of the ten labels is EMITTED`, missing.length ? `zero edges for ${missing.join(", ")}` : "10/10")

// ---- 2/3. outgoing zero, incoming within the declared allowance -----------------------------
let totalUnexplained = 0
for (const t of EXPECTED_LABELS) {
  const row = v.types?.[t]
  if (!row) { check(false, `label ${t} present in the artefact`); continue }
  const allowance = ALLOWANCE[t]
  const srcUnresolved = row.projectScope?.source?.UNRESOLVED ?? 0
  const unexplained = row.unexplained ?? 0
  totalUnexplained += unexplained
  check(srcUnresolved === 0, `${t}: OUTGOING (source) UNRESOLVED is zero`, `n=${row.count}, srcUnresolved=${srcUnresolved}`)
  check(unexplained <= allowance.cap, `${t}: incoming UNEXPLAINED within its declared ceiling`, `unexplained=${unexplained} <= cap=${allowance.cap}`)
  if (unexplained > 0) {
    const axes = Object.entries(row.unresolvedClass ?? {}).map(([k, n]) => `${k}:${n}`).join(" ")
    console.log(`      cause: ${allowance.cause}`)
    console.log(`      axes : ${axes}`)
  }
}

check(totalUnexplained <= Object.values(ALLOWANCE).reduce((a, b) => a + b.cap, 0),
  `total incoming UNEXPLAINED within the sum of ceilings`,
  `total=${totalUnexplained} (declared-dynamic/declared-local/declared-external/qualified-external/star-import-external/builtin/not-bound-in-file explain every other unresolved target)`)

console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${failures.length ? failures.join("; ") : `${totalUnexplained} UNEXPLAINED incoming targets, each within a named ceiling, and 0 outgoing unresolved`}`)
process.exit(failures.length === 0 ? 0 : 1)
