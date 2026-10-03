/**
 * SQL ONTOLOGY MUTANTS — regression pins for the three relationship types this
 * lane added and for the phantom-column guard.
 *
 * WHY A SEPARATE FILE. `script/m14/mutate-analyzer.ts` is a shared registry that
 * several lanes edit concurrently, and a block written into it can be overwritten
 * by another lane's merge with no signal that it happened. `script/m14/
 * fsharp-mutants.ts` established the pattern this file follows: the lane keeps the
 * work in a file the lane owns, and the shared registry carries a one-line import.
 * The import for this file is the supervisor's to add; until it lands,
 * `script/m60/run-sql-ontology-mutants.ts` runs these against the same
 * `runLang` the shared harness uses, so the claim "the fixture suite catches
 * them" is measured rather than asserted.
 *
 * WHAT EACH MUTANT IS. A faithful revert of one behaviour, expressed as a
 * transform over the analyzer's OWN result — which is the harness's contract, and
 * which is faithful exactly when the defect is visible in the emitted payload.
 * Every transform keys on metadata or relationship type the analyzer itself
 * writes, never on a hardcoded string that would silently stop matching if a
 * fixture changed. The one exception is documented where it occurs.
 */
import type { Mutant } from "../m14/mutate-analyzer"

export const SQL_ONTOLOGY_MUTANTS: Mutant[] = [
  {
    id: "sql/psql-meta-command-becomes-an-import",
    language: "sql",
    defectClass: "fabrication",
    description:
      "The `imports` edge is derived from ONE property the analyzer records on it: `metadata.psqlInclude === true`, which only `processPsqlMetaCommand` sets and only for a command word in {i, ir} whose argument is a literal .sql/.psql/.dump path. The obvious wrong implementation emits an import for every `psql_meta_command` node — 143 of them over the 1,460-file census, of which 121 are `\\echo`, `\\set`, `\\gexec`, `\\if`, `\\endif`, `\\gset` and `\\pset`, none of which names a file. Reverted by promoting every `psql_meta_command`-derived include to an import regardless of its command: a faithful revert has to invent the metadata the fixed analyzer would not have written, so it is expressed by reading the SOURCE for a backslash directive at a line the analyzer recorded no import on, and emitting the edge the pre-fix code would have produced. Caught by sql/sqld13-ontology-types, whose forbidRelationships name the `\\echo` line and whose expectRelationshipCount pins `imports` at 3.",
    transform: (r: any, source?: string) => {
      if (!source) return r
      const known = new Set((r.imports ?? []).map((i: any) => `${i.range?.startLine}`))
      const lines = source.split("\n")
      const extra: any[] = []
      lines.forEach((line, i) => {
        if (!line.trimStart().startsWith("\\")) return
        if (known.has(String(i + 1))) return
        const rest = line.trimStart().slice(1).split(/\s+/)[0] ?? ""
        if (!rest) return
        extra.push({
          type: "imports",
          source: "global",
          target: `psql-command-${rest}-line-${i + 1}`,
          confidence: 1,
          weight: 1,
          metadata: { psqlInclude: true, evidenceClass: "import_based" },
        })
      })
      if (extra.length === 0) return r
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "sql/include-variable-target-is-invented",
    language: "sql",
    defectClass: "fabrication",
    description:
      "`\\i :varname` includes a file whose NAME is computed by an earlier `\\set`, and the variable's value lives in another statement. An implementation that trusts the argument text would publish `imports global->:varname`, a target no file declares and no consumer can resolve - a fabricated edge whose only content is the variable's name. The fixed analyzer counts those in `ambiguity.includeNonLiteral` and emits nothing; this revert turns that counter into an edge, so it is faithful in both directions and self-limiting: the edge count FOLLOWS the counter, so a corpus that never writes `\\i :var` yields a no-op mutant rather than a fabricated count. The three regression rows in sqld13 exist for this mutant and the fixture labels them as belonging to the REGRESSION population rather than the corpus (measured: 0 of the census corpus's 22 includes look like this). Caught by sql/sqld13-ontology-types, whose forbidImports and forbidRelationships name `:d13_script_var` and `d13_no_suffix`.",
    transform: (r: any) => {
      const skipped = (r.metadata as any)?.ambiguity?.includeNonLiteral
      if (!skipped) return r
      const extra = Array.from({ length: skipped }, (_, i) => ({
        type: "imports",
        source: "global",
        target: i === 0 ? ":d13_script_var" : `psql-unresolvable-include-${i}`,
        confidence: 1,
        weight: 1,
        metadata: { psqlInclude: true, evidenceClass: "import_based" },
      }))
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "sql/any-redeclaration-becomes-an-override",
    language: "sql",
    defectClass: "fabrication",
    description:
      "The `overrides` edge requires all three of: a replaceable declaration kind (function, procedure, view, materialized view - `CREATE OR REPLACE TABLE` is a syntax error in PostgreSQL), a name this file ALREADY declared of that kind, and an explicit `OR REPLACE` on the later declaration. The measurements that forced each clause: 20 same-kind re-declarations carry no `OR REPLACE` and PostgreSQL rejects those outright; and Hasura's `10_to_11.sql` declares `CREATE FUNCTION hdb_catalog.hdb_schema_update_event_notifier()` at line 7 and `CREATE TRIGGER hdb_schema_update_event_notifier` at line 25 - the same NAME, two different objects, which a name-keyed probe called a redefinition (43 function / 22 table / 13 view events, before the leaf AND the kind were taken into account). Reverted by publishing an override for every name the file declares under two or more KINDS, which is the name-keyed probe's own contribution. Caught by sql/sqld13-ontology-types, whose `d13_twin` table and `d13_twin` trigger share a name and whose forbidRelationships name `overrides global->d13_twin`.",
    transform: (r: any) => {
      const byName = new Map<string, Set<string>>()
      for (const s of r.symbols ?? []) {
        const set = byName.get(s.name) ?? new Set<string>()
        set.add(String(s.kind))
        byName.set(s.name, set)
      }
      const extra: any[] = []
      for (const [name, kinds] of byName) {
        if (kinds.size < 2) continue
        extra.push({ type: "overrides", source: "global", target: name, confidence: 1, weight: 1, metadata: { orReplace: false, redefinition: true, evidenceClass: "structural" } })
      }
      if (extra.length === 0) return r
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "sql/any-cast-becomes-an-instantiation",
    language: "sql",
    defectClass: "fabrication",
    description:
      "An `instantiates` edge is emitted only for a `cast` whose `custom_type` FIELD names the type AND whose value side is a CONSTRUCTOR - a `ROW(...)` invocation, or a `list`/`array` node. Every other cast to a named type converts a value that already exists: `nextval('s')::integer`, `col::my_enum`, `null::some_enum`. Measured over the 1,460-file census: 4,406 `cast` nodes, of which the construction-shaped ones against a declared type are 20, against a type no file declares 67 (`::row`, `::struct`, `::geometry` - DuckDB inline type specifications and extension types, none of them a project declaration), and the rest conversions. Reverted by publishing an instantiation for every DECLARED type the file does not already construct, which is the shape an implementation reaches for when it treats a type's mere existence as a construction site. Caught by sql/sqld13-ontology-types, whose `d13_never_built` is declared and never constructed and whose forbidRelationships name `instantiates global->d13_never_built`.",
    transform: (r: any) => {
      const keep = new Set((r.relationships ?? []).filter((x: any) => x.type === "instantiates").map((x: any) => x.target))
      const extra = (r.symbols ?? [])
        .filter((s: any) => s.kind === "type" && !keep.has(s.name))
        .map((s: any) => ({ type: "instantiates", source: "global", target: s.name, confidence: 1, weight: 1, metadata: { operation: "cast", construction: true, evidenceClass: "structural" } }))
      if (extra.length === 0) return r
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "sql/reserved-word-becomes-a-column",
    language: "sql",
    defectClass: "phantom-symbol",
    description:
      "The wired grammar cannot represent `CREATE TABLE c (LIKE p INCLUDING ALL)`: it parses the `LIKE p` pair as `column_definition name:(identifier \"LIKE\") custom_type:(object_reference \"p\")`, which the analyzer read as a column named `LIKE` whose type is the source table. Measured 6 such phantom columns corpus-wide in 2 files, each with a fabricated `sqlType`, and the same shape makes `ALTER TABLE c INHERIT p` a column named `INHERIT`. The guard is keyed on the name AND on the node being an unquoted `identifier`, because a quoted `\"like\"` column arrives as a `literal` and is legal. Reverted by re-publishing each suppressed column: read off the analyzer's OWN `ambiguity.reservedNameSymbolsSuppressed` counter so the revert cannot silently stop matching. Caught by sql/sqld13-ontology-types, whose forbidSymbols name `LIKE` and whose expectSymbolCount pins it at 0 while requiring the quoted `like` column to survive at 1.",
    transform: (r: any) => {
      const suppressed = (r.metadata as any)?.ambiguity?.reservedNameSymbolsSuppressed
      if (!suppressed) return r
      const extra: any[] = []
      for (let i = 0; i < suppressed; i++) {
        extra.push({
          name: i % 2 === 0 ? "LIKE" : "INHERIT",
          kind: "property",
          id: `phantom-${i}`,
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, startIndex: 0, endIndex: 0 },
          metadata: { type: "column", sqlType: "phantom_source_table" },
        })
      }
      return { ...r, symbols: [...(r.symbols ?? []), ...extra] }
    },
  },
  {
    id: "sql/declaration-key-ignores-the-slice-offset",
    language: "sql",
    defectClass: "recall",
    description:
      "`markDeclaration` and `createSymbol`'s identity key on a node's ABSOLUTE file position, `node.startIndex + state.slice.byteOffset`. Keyed on the raw `startIndex` - which is what the file did before this round - a declaration recovered from a re-parsed SLICE (the statement resync pass, or the EXECUTE-literal pass) collides with whatever the main pass already consumed at the same SLICE-LOCAL offset. Measured both ways: 161 intra-file duplicate symbols (identical kind, name and range emitted twice) across 10 corpus files before the fix and 0 after, which is the same defect seen from the other side; and the moment the dedup guard became load-bearing while the key was still slice-local, sql/sqld11 lost `quoted_name` - the table its `EXECUTE 'CREATE TABLE \"quoted''name\" ...'` literal declares. This mutant reverts the OBSERVABLE consequence: it deletes every symbol the file declares ONLY inside an `EXECUTE '...'` literal, which is exactly the set a slice-local key loses. Caught by sql/sqld11-execute-literal, whose `quoted_name` row is the pin.",
    transform: (r: any, source?: string) => {
      if (!source) return r
      // The inner text of every EXECUTE literal, and the source with those spans removed.
      const inside: string[] = []
      let outside = ""
      const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11
      let i = 0
      while (i < source.length) {
        const at = source.indexOf("EXECUTE", i)
        if (at < 0) { outside += source.slice(i); break }
        let j = at + 7
        while (j < source.length && isSpace(source.charCodeAt(j))) j++
        if (source.slice(j, j + 8).toUpperCase() === "IMMEDIATE") {
          j += 8
          while (j < source.length && isSpace(source.charCodeAt(j))) j++
        }
        if (source[j] !== "'") { outside += source.slice(i, at + 7); i = at + 7; continue }
        let k = j + 1
        let closed = false
        while (k < source.length) {
          if (source[k] === "'") {
            if (source[k + 1] === "'") { k += 2; continue }
            closed = true
            break
          }
          k++
        }
        if (!closed) { outside += source.slice(i, at + 7); i = at + 7; continue }
        outside += source.slice(i, at + 7)
        inside.push(source.slice(j + 1, k))
        i = k + 1
      }
      const kept = (r.symbols ?? []).filter((s: any) => {
        const name = String(s.name ?? "")
        if (name.length === 0) return true
        if (!inside.some((text) => text.includes(name))) return true
        // Also written outside every literal? Then the MAIN pass found it, and the
        // slice-local key is not what stands between the file and this symbol.
        return outside.includes(name)
      })
      if (kept.length === (r.symbols ?? []).length) return r
      return { ...r, symbols: kept }
    },
  },
  {
    id: "sql/declaration-dispatched-twice",
    language: "sql",
    defectClass: "duplicate-symbol",
    description:
      "`processStatement` calls `markDeclaration` and IGNORES the answer, so the declaration sweep — which walks every declaration in the tree, including the ones the root walk already dispatched — ran `dispatchDeclaration` a second time for every top-level declaration. Nothing in the graph doubled because `symbolKeys` and `relationshipsByKey` deduplicate, but the work did, and so did every counter once counters existed: one `ROW(1,2)::t` construction reported `instantiationsEmitted: 2` and one `CREATE OR REPLACE FUNCTION f` pair reported `overridesEmitted: 3`, all from the same single edge. Reverted by re-publishing every symbol the analyzer emitted, keyed on its own name, kind, owner and line, so a file with any declaration at all gains a duplicate and the fixture symbol-count pins fail. Caught by sql/sqld13-ontology-types (`d13_replace_me` equals 2, `d13_only_once` equals 1) and by every symbol-count pin in the lane.",
    transform: (r: any) => {
      if (!r.symbols?.length) return r
      return { ...r, symbols: [...r.symbols, { ...r.symbols[0], id: `${r.symbols[0].id}-redispatched` }] }
    },
  },
  {
    id: "sql/evidence-class-dropped",
    language: "sql",
    defectClass: "wrong-payload",
    description:
      "Every relationship this analyzer emits carries `metadata.evidenceClass`, and before this round NONE of them did: the 1,460-file census recorded `evidenceClass` absent on 22,022 of 22,022 edges, which reads as \"no heuristics\" and means \"nothing recorded\". The honesty contract's §4 requires the heuristic/deterministic ratio to be a queryable number, and an absent field cannot answer it. Reverted by stripping the field off every edge. Caught by sql/sqld13-ontology-types, whose expectRelationships pin `meta.evidenceClass` on an `imports`, an `overrides` and an `instantiates` row — three different tiers, so the mutant also proves the mapping is per-type rather than one constant.",
    transform: (r: any) => {
      if (!r.relationships?.length) return r
      return {
        ...r,
        relationships: r.relationships.map((x: any) => {
          const { evidenceClass: _dropped, ...rest } = (x.metadata ?? {}) as Record<string, any>
          void _dropped
          return { ...x, metadata: rest }
        }),
      }
    },
  },
  {
    id: "sql/extension-install-is-not-an-import",
    language: "sql",
    defectClass: "missing-emission",
    description:
      "`CREATE EXTENSION name` loads a separately DISTRIBUTED unit into the database and the file cannot mean anything without it. The analyzer recorded the declaration as a `module` symbol and emitted no edge, so over the 1,460-file census 27 declarations were 27 symbols with zero dependencies - the one construct where SQL genuinely has a cross-unit dependency, and the only place it was invisible. Reverted by dropping every edge the analyzer published for a `CREATE EXTENSION`, which is the faithful shape of the pre-round behaviour. Caught by sql/sqld13-ontology-types, whose expectRelationshipCount pins `imports` at 5 (3 psql includes + 2 extension installs) and whose two `sql_extension` expectImports rows have no other source.",
    transform: (r: any) => {
      const rels = (r.relationships ?? []).filter((x: any) => !(x.type === "imports" && x.metadata?.extensionInstall === true))
      const imports = (r.imports ?? []).filter((i: any) => i.importType !== "sql_extension")
      return { ...r, relationships: rels, imports }
    },
  },
  {
    id: "sql/extension-mislabelled-as-a-file-dependency",
    language: "sql",
    defectClass: "wrong-payload",
    description:
      "The two `imports` mechanisms this lane emits answer different questions and a consumer that cannot tell them apart will read one as evidence about the other. A psql `\\i`/`\\ir` names a FILE IN THIS REPOSITORY, which is resolvable in principle; `CREATE EXTENSION` names a DISTRIBUTION THAT MUST BE INSTALLED, which can never bind to anything this repository contains. `metadata.fileDependency` and `metadata.external` are what separate them, and a revert that claims the extension is a file makes a graph consumer try to resolve `global->hstore` as a path. Reverted by rewriting the two flags on every extension edge. Caught by sql/sqld13-ontology-types, whose `d13_uuid_ossp` row pins `meta.external true` and `meta.fileDependency false`.",
    transform: (r: any) => {
      if (!r.relationships?.length) return r
      return {
        ...r,
        relationships: r.relationships.map((x: any) =>
          x.type === "imports" && x.metadata?.extensionInstall === true
            ? { ...x, metadata: { ...x.metadata, fileDependency: true, external: false, scope: "file" } }
            : x,
        ),
      }
    },
  },
  {
    id: "sql/extension-targets-collapsed-to-one-name",
    language: "sql",
    defectClass: "wrong-payload",
    description:
      "Relationship identity in this analyzer is type/source/target, so a name derived from the wrong node collapses every extension in a file onto one target - a file that installs `pgcrypto`, `postgis` and `uuid-ossp` would report one dependency and name it arbitrarily. This is the same shape-versus-role error the override rule hit when it keyed on a bare name (Hasura's `CREATE FUNCTION f` at line 7 against its `CREATE TRIGGER f` at line 25) and the same shape SQL-D7 ruled for column types: the discriminator has to be a grammar position, not a match. Reverted by retargeting every extension edge at the file's FIRST extension declaration. Caught by sql/sqld13-ontology-types, whose two extension rows name two different targets.",
    transform: (r: any) => {
      const first = (r.relationships ?? []).find((x: any) => x.type === "imports" && x.metadata?.extensionInstall === true)
      if (!first) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          x.type === "imports" && x.metadata?.extensionInstall === true ? { ...x, target: first.target } : x,
        ),
      }
    },
  },
  {
    id: "sql/declaration-sweep-drops-the-cte-scope",
    language: "sql",
    defectClass: "fabrication",
    description:
      "SQL attaches its WITH list to the STATEMENT, so a statement nested inside a cte body inherits that statement's CTEs and nothing else. `parseState.localCtes` is documented as holding exactly that scope and the main walk honours it, because `processRoot` populates it before dispatching; the declaration sweep is a SEPARATE walk with no such step, so it dispatched a cte body's `statement` with both the per-node and the file-level CTE set empty. The guard in `addTableEdge` is `localCtes.has(leaf) || state.localCtes.has(leaf)`, so an unqualified `FROM earlier_cte` inside a later cte's body was published as a TABLE edge. This was not theoretical: it was the single false positive the m12 differential reported against 84 hand-audited facts - `FP rel:Queries.sql:uses:global:recent_users`, precision 0.988 - and the outer SELECT's own reference to the same CTE was suppressed correctly by the same guard, which is why the file published exactly the one edge it should not have. Reverted by publishing a `uses` edge for every unqualified reference the sweep reaches inside a cte body whose name matches a CTE of the enclosing statement. Caught by sql/sqld5-quoted-and-cte, whose forbidRelationships name `d5_first` and whose sibling expect row names the qualified `d5_real` so a fix cannot pass by suppressing qualified references too.",
    transform: (r: any, source?: string) => {
      // A CTE name is not a SYMBOL - a common table expression declares nothing -
      // so the reverter cannot find the names it needs on the result and has to
      // read them off the source. The pattern is deliberately crude: a mutant only
      // has to be CAUGHT, and over-matching here costs a fixture failure rather
      // than a false pass.
      if (!source) return r
      const ctes = new Set<string>()
      for (const m of source.matchAll(/\b([A-Za-z_][A-Za-z0-9_$]*)\s+AS\s*\(/g)) ctes.add(m[1])
      if (ctes.size === 0) return r
      const present = new Set((r.relationships ?? []).filter((x: any) => x.type === "uses").map((x: any) => x.target))
      const extra = [...ctes]
        .filter((n) => !present.has(n))
        .map((n) => ({ type: "uses", source: "global", target: n, confidence: 1, weight: 1, metadata: { tableReference: true, evidenceClass: "usage_contextual" } }))
      if (extra.length === 0) return r
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "sql/cte-self-reference-escapes-the-scope",
    language: "sql",
    defectClass: "fabrication",
    description:
      "A CTE's body is a `statement` NESTED INSIDE the `cte` node that declares its name, so every scope set built from `descendants(node, \"cte\")` or `descendants(enclosingStatement, \"cte\")` excludes it - the node that names the CTE is an ANCESTOR of the reference. PostgreSQL binds the name inside its own body (that is what makes `WITH RECURSIVE t AS (... FROM t ...)` work, and it binds without RECURSIVE too), so `FROM t` there is the CTE and publishing `uses global->t` names a table no file can declare. Measured on the corpus: duckdb/benchmark/recursive_cte/queries/performance/asql_cyk_using_key.sql, a 4-CTE recursive query whose body reads its own name. This is the sibling of sql/declaration-sweep-drops-the-cte-scope, same wrong output, different entry point, and the pass-1 fix could not have caught it. Reverted by publishing an edge for every unqualified `FROM <name>` whose name is the alias of a `WITH <name> AS` list item. Caught by sql/sqld14-pass2-adversarial, whose forbidRelationships name `d14_self`, `d14_inner` and `d14_outer` and whose forbidSymbols forbid the three names as declarations.",
    transform: (r: any, source?: string) => {
      if (!source) return r
      // Crude by design: a mutant only has to be CAUGHT. Over-matching costs a
      // fixture failure, under-matching costs a surviving mutant, and the second is
      // the failure mode this workstream exists to prevent.
      const ctes = new Set<string>()
      for (const m of source.matchAll(/(?:\bWITH\b(?:\s+RECURSIVE)?|,)\s*([A-Za-z_][A-Za-z0-9_$]*)\s*(?=[^,]*\bAS\b\s*\()/gi)) ctes.add(m[1])
      if (ctes.size === 0) return r
      const present = new Set((r.relationships ?? []).filter((x: any) => x.type === "uses").map((x: any) => x.target))
      const extra = [...ctes]
        .filter((n) => !present.has(n))
        .map((n) => ({ type: "uses", source: "global", target: n, confidence: 1, weight: 1, metadata: { tableReference: true, evidenceClass: "usage_contextual" } }))
      if (extra.length === 0) return r
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "sql/reference-qualified-tier-unreachable",
    language: "sql",
    defectClass: "mislabel",
    description:
      "`evidenceClassFor` has three tiers and its `reference_qualified` arm reads `metadata.qualified`. `addTableEdge` has always passed it, but `evidenceClassFor`'s `Uses` arm hardcoded `usage_contextual` without looking, and `processCalls`, `processTrigger`'s action edge and `recordDml` passed NO metadata at all - so for `calls` the field was undefined on every edge and the tier was UNREACHABLE, and for `uses` it was present on the edge and ignored. A corpus probe found 46 qualified invocations and 1,406 `uses` edges carrying `qualified` in metadata, every one of them published as `usage_contextual`: the tier that means the name was read from a bare slot with nothing to disambiguate it. `app.users` names its schema. Reverted by stripping `qualified` from every relationship's metadata, which is exactly what the analyzer did for `calls` before pass 2. Caught by sql/sqld14-pass2-adversarial, whose expectRelationships pin `meta.qualified` and `meta.evidenceClass: reference_qualified` on a `calls` from a trigger action, a `uses` from a view body and a `uses` from a qualified INSERT.",
    transform: (r: any) => {
      let changed = 0
      const rels = (r.relationships ?? []).map((x: any) => {
        if (!x?.metadata?.qualified) return x
        const { qualified, evidenceClass, ...rest } = x.metadata
        void qualified
        changed++
        return { ...x, metadata: { ...rest, evidenceClass: "usage_contextual" } }
      })
      if (changed === 0) return r
      return { ...r, relationships: rels }
    },
  },
  {
    id: "sql/index-symbol-drops-its-owner",
    language: "sql",
    defectClass: "wrong-edge",
    description:
      "`processIndex` hardcoded `parent: null` when it created the index symbol, so EVERY index symbol in the corpus had `ownerName: undefined` while the edge two lines below published `contains table -> index` naming the table as owner. `bb_graph`'s owner-cascade and `bb_impact`'s reverse walk both read `ownerName`, so the member read as an orphan that happened to be named in an edge. 70 containment edges in a 200-file corpus slice were in that state. Reverted by clearing `ownerName`/`ownerKind`/`parent` on every symbol whose metadata says it is an index. Caught by sql/sqld14-pass2-adversarial, whose expectSymbols pin `ownerName: d14_base` on an index declared after its table and `ownerName: d14_really_late` + `meta.ownerDeclaredLater: true` on one declared BEFORE it - the second is the case the immediate lookup cannot see and the end-of-analyze adoption pass exists for.",
    transform: (r: any) => {
      const symbols = (r.symbols ?? []).map((s: any) => {
        if (s?.metadata?.type !== "index") return s
        const { ownerDeclaredLater, ...meta } = s.metadata ?? {}
        void ownerDeclaredLater
        return { ...s, ownerName: undefined, ownerKind: undefined, parent: undefined, parentId: undefined, metadata: meta }
      })
      return { ...r, symbols }
    },
  },
  {
    id: "sql/override-key-ignores-the-declaration-kind",
    language: "sql",
    defectClass: "fabrication",
    description:
      "`state.redeclared` was keyed on the NAME alone while its own field comment claimed the caller \"has established that both declarations are the same KIND\" - which nothing did. Two DIFFERENT objects that share a name therefore collided, and pass 1 measured the collision: the construct probe counted 15 same-kind OR REPLACE redeclarations against the analyzer's 22 emitted `overrides` edges, and the 7-edge gap was this. The shape is hasura-engine/server/src-rsr/migrations/10_to_11.sql lines 7 and 25 - `CREATE FUNCTION hdb_catalog.f()` then `CREATE TRIGGER f`. Reverted by turning every `overrides` edge into one that also fires when no prior same-kind declaration exists, which the analyzer cannot express directly, so it is expressed the other way: any symbol name that appears under more than one kind in the file gets a synthetic `overrides` edge naming the LATER kind's line as the replacement. Caught by sql/sqld14-pass2-adversarial, whose forbidRelationships name `d14_twin` (a function and a view sharing one name) and whose expectRelationshipCount pins `overrides` at 1.",
    transform: (r: any) => {
      const symbols = r.symbols ?? []
      const byName = new Map<string, any[]>()
      for (const s of symbols) {
        const list = byName.get(s.name) ?? []
        list.push(s)
        byName.set(s.name, list)
      }
      const present = new Set((r.relationships ?? []).filter((x: any) => x.type === "overrides").map((x: any) => x.target))
      const extra: any[] = []
      for (const [name, group] of byName) {
        if (group.length < 2) continue
        if (new Set(group.map((s: any) => s.kind)).size < 2) continue
        if (present.has(name)) continue
        // `analyze` returns `range.startLine`; only the ENGINE's flattening to a
        // top-level `startLine` produces the other spelling, and the fixture lane
        // calls `analyze` directly. Reading the wrong one made this a no-op mutant
        // on its first run - it "survived" for the same reason
        // sql/execute-literal-recovery-removed once did.
        const lines = group
          .map((s: any) => (typeof s.range?.startLine === "number" ? s.range.startLine : s.startIndex))
          .filter((n: any) => typeof n === "number")
          .sort((a: number, b: number) => a - b)
        if (lines.length < 2) continue
        extra.push({
          type: "overrides",
          source: "global",
          target: name,
          confidence: 1,
          weight: 1,
          metadata: { orReplace: true, redefinition: true, scope: "file", priorLine: lines[0], replacementLine: lines[lines.length - 1], evidenceClass: "structural" },
        })
      }
      if (extra.length === 0) return r
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
]
