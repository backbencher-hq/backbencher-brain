// ────────────────────────────────────────────────────────────────────────────────────────────────
// READY TO PASTE — the `sql` entry for LANG_CONFIGS in script/m14/completeness-inventory.ts.
//
// Insert this object inside `const LANG_CONFIGS: Record<string, LangConfig> = { … }` (alphabetically
// after `swift`). Nothing else in the gate changes for this lane; `fixtureExtensions` is NOT needed —
// the corrected `emittedKinds()` reads only the sources each `<name>.expectation.json` describes, and
// with that reader SQL's section B reads pinned: 7, emitted: 7, all accounted for.
//
// EXPECTED READING ON APPLICATION, measured with a copy of the CURRENT gate and only this object
// injected (`bun run --lang sql`):
//
//   pass  section-a-structural         592 types, 82 handled, 478 silent, 17 gaps, 25 decisions
//   pass  section-b-relationship-kinds pinned: calls, contains, imports, instantiates, overrides,
//                                      references, uses; emitted: the same 7
//   pass  section-c-payload-matrix
//   pass  section-d-evidence-tiers     4 tier(s) pinned: import_based, reference_qualified,
//                                      structural, usage_contextual
//   FAIL  section-e-differential       no baseline floor row for duckdb:sql   <- DECLARED ABSENT, SQL-G14
//   FAIL  section-f-perf-budget        no avgMsPerFile for duckdb:sql         <- same dependency
//   pass  section-g-docs               docs/analyzers/history/sql-lane-notes.md, docs/analyzers/sql.md
//   pass  section-h-cross-language     12 checks pass
//
// THAT IS 6 OF 8. E and F cannot pass and must not be made to look as if they can: there is no SQL
// differential ORACLE (SQL-G14), so no run can produce a floor row or a per-file timing. The two
// failures above are the honest, explained state — see the ruling in
// `validation/m14/verification/SQL-STATE.md` §6. DO NOT invent a floor row.
//
// `GATED_LANGS`: sql may join only when E/F are settled (CONFORMANT). Adding it at 6/8 turns
// `npm run verify` red on two sections whose cause is a missing shared instrument, not this lane.
// ────────────────────────────────────────────────────────────────────────────────────────────────

sql: {
  id: "sql",
  wasm: "tree-sitter-sql.wasm",
  classification: "sql-completeness.json",
  fixturesDir: "validation/m14/fixtures/sql",
  docs: ["docs/analyzers/history/sql-lane-notes.md", "docs/analyzers/sql.md"],
  // E/F await a SQL differential oracle (SQL-G14): `script/m14/differential.ts` carries 34 derive*
  // functions and none derives SQL, so a scoped SQL run ends "derived ZERO truth edges" and there is
  // nothing to pin a floor to. Naming the key now means section E fails with a PRECISE reason.
  perfKey: "duckdb:sql",
  requiredKinds: ["contains", "uses", "references", "calls", "imports", "overrides", "instantiates"],
  payloads: {},
  title: "sql schema wave (#419 sections A, C, D, G, H; E/F await SQL-G14's oracle)",
},
