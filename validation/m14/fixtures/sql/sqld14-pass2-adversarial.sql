-- sqld14 — pass-2 adversarial regression fixture.
--
-- Every shape here was found by `validation/m14/fixtures/sql/adversarial-probe.mts`
-- over the corpus, not by reading the analyzer and imagining a case. The
-- provenance for each is in that script's probe names and in the artifact it
-- writes; the short version is:
--
--   1. A CTE referencing ITSELF from inside its own body. The scope sets are built
--      from `descendants(node, "cte")` and `descendants(enclosingStatement, "cte")`,
--      and a CTE's body is a `statement` NESTED INSIDE the `cte` node that names it,
--      so the name was in neither set and `uses global->d14_self` was published for
--      a table no file can declare. Verbatim shape of
--      duckdb/benchmark/recursive_cte/queries/performance/asql_cyk_using_key.sql.
--   2. A QUALIFIED call and a QUALIFIED table reference. `evidenceClassFor` has a
--      `reference_qualified` tier, `addTableEdge` has always passed `qualified`, and
--      `processCalls` passed NO metadata — so the tier was unreachable for `calls`
--      and ignored for `uses`, and every qualified reference was published as
--      `usage_contextual`, the label for a name read from a bare slot.
--   3. `CREATE INDEX` before `CREATE TABLE`, the order a migration chain writes when
--      the index is added first. `processIndex` hardcoded `parent: null`, so the index
--      symbol had `ownerName: undefined` while the edge two lines below it said the
--      table contains the index.
--   4. `CREATE FUNCTION f` then `CREATE VIEW f` — two DIFFERENT objects sharing a
--      name. `state.redeclared` was keyed on the name alone, so a `CREATE OR REPLACE
--      VIEW f` afterwards was published as an override of the function. Verbatim shape
--      of hasura-engine/server/src-rsr/migrations/10_to_11.sql lines 7 and 25.

-- ---------------------------------------------------------------- 1. CTE self-reference
-- The recursive form is what makes the name visible in its own body.
WITH RECURSIVE d14_self(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM d14_self WHERE n < 3
)
SELECT * FROM d14_self;

-- The same leak without RECURSIVE: PostgreSQL binds a CTE's name inside its own
-- body either way, and the non-recursive shape is the one a hand-written query has.
WITH d14_outer AS (
  SELECT x FROM d14_inner
), d14_inner AS (
  SELECT 1 AS x FROM d14_outer
)
SELECT * FROM d14_outer;

-- …and the SIBLING case, which is a third entry point to the same wrong output.
-- `d14_third` reads `d14_first_cte`, an earlier item in the SAME WITH list. SQL
-- makes a WITH list's names visible to every later item; the per-node set cannot
-- see it (the body holds no `cte`), the sweep's set cannot see it (the body is its
-- own `statement`), and only the ancestor chain's own name is reachable without
-- anchoring on the outermost enclosing statement. 32 leaked edges across 16 DuckDB
-- benchmark files before this was fixed; the shape of
-- duckdb/benchmark/aoc24/queries/day05.sql.
WITH d14_first_cte(i) AS (SELECT 1),
     d14_second_cte(i) AS (SELECT i FROM d14_first_cte),
     d14_third_cte(i) AS (SELECT i FROM d14_second_cte WHERE i < (SELECT max(i) FROM d14_second_cte))
SELECT * FROM d14_third_cte;

-- The guard that keeps the scope from over-reaching: two SEPARATE WITH lists in one
-- file, and a real TABLE whose name is the first list's CTE name. `d14_narrow` must
-- still resolve to the table, because the first WITH list is a different scope.
CREATE TABLE d14_narrow (v integer);
WITH d14_narrow AS (SELECT 1 AS v) SELECT * FROM d14_narrow;
SELECT * FROM d14_narrow;

-- And the shape that defeated the sibling rule as well: a WITH list whose items are
-- SIBLINGS under an ERROR rather than children of a `statement`, which is what
-- DuckDB's benchmark queries look like — 34 unparseable regions in
-- duckdb/benchmark/aoc24/queries/day05.sql, 1,428 lines, every `cte` node a sibling
-- of every other one with `program` as the ERROR's parent. With no `statement` to
-- anchor on, the scope came back empty and 5 CTE aliases were published as tables.
-- The construct that forces it is `USING KEY`, which the wired grammar has no rule
-- for; `::smallint` narrowing inside the list does the same damage more cheaply.
WITH d14_err_first(i) AS (SELECT 1::smallint),
     d14_err_second(j) AS (SELECT i FROM d14_err_first),
     d14_err_third(k) AS (SELECT j FROM d14_err_second WHERE j < (SELECT max(j) FROM d14_err_second))
SELECT * FROM d14_err_third;

-- ---------------------------------------------------------------- 2. qualified references
CREATE TABLE d14_base (id integer, note text);

-- A qualified CALL: `evidenceClass` must be reference_qualified, not usage_contextual.
-- d14_trigger's action calls app.d14_helper(), which the grammar reports as an
-- `invocation` whose callee names its schema.
CREATE OR REPLACE FUNCTION d14_helper() RETURNS integer AS $$ SELECT 1; $$ LANGUAGE sql;
CREATE TRIGGER d14_trigger BEFORE UPDATE ON d14_base
  FOR EACH ROW EXECUTE FUNCTION app.d14_helper();

-- A qualified TABLE reference in a view body: `uses` with `qualified` metadata.
-- `FROM app.d14_base` names its schema, so the tier must say so.
CREATE OR REPLACE VIEW d14_v AS SELECT id FROM app.d14_base;

-- A qualified table reference in DML: `uses` via the `from` clause, not `references`.
CREATE OR REPLACE FUNCTION d14_writer() RETURNS void AS $$
BEGIN
  INSERT INTO app.d14_base (id, note) VALUES (1, 'a');
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- 3. index before table
-- The index is declared FIRST, so the table symbol does not exist yet when the index
-- is processed. The member must still record its owner, because the `contains` edge
-- names one.
CREATE INDEX d14_early_idx ON app.d14_base (id);
CREATE TABLE d14_late (id integer);
CREATE INDEX d14_late_idx ON app.d14_late (id);

-- The ordinary order, for contrast: the table exists first, so `ownerDeclaredLater`
-- must NOT be set on this one.
CREATE TABLE d14_first (id integer);
CREATE INDEX d14_first_idx ON app.d14_first (id);

-- ---------------------------------------------------------------- 4. cross-kind name collision
-- `d14_twin` is first a FUNCTION and then a VIEW, and the VIEW is the FIRST
-- declaration of its kind. So the `CREATE OR REPLACE VIEW` replaces nothing:
-- `state.redeclared` was keyed on the name alone, so it saw the FUNCTION at the
-- same key and published `overrides global->d14_twin` naming a replacement the
-- language never performed. PostgreSQL rejects two objects of different kinds
-- sharing one name in a schema, so no corpus file writes this — it is the shape
-- Hasura's `10_to_11.sql` was misread as, and the misreading is what a name-only
-- key produces.
CREATE OR REPLACE FUNCTION d14_twin() RETURNS integer AS $$ SELECT 1; $$ LANGUAGE sql;
CREATE OR REPLACE VIEW d14_twin AS SELECT 1 AS one;

-- Same kind, same name, SAME ARGUMENT TYPES, OR REPLACE: THIS is an override and
-- must be published. The argument types are part of the identity because
-- PostgreSQL says so, in the CREATE FUNCTION reference: "It is not possible to
-- change the name or argument types of a function this way (if you tried, you
-- would actually be creating a new, distinct function)" and "Two functions are
-- considered the same if they have the same names and INPUT argument types,
-- ignoring any OUT parameters."
--
-- The first shape of this section declared `d14_replace(a integer)` and
-- `d14_replace(a integer, b integer)` and called the pair an override. PostgreSQL
-- does not: those are two functions that coexist, and `overrides` was asserting a
-- replacement the language never performs. Measured on the 60-file incoming-gate
-- population, that shape was the whole of the type's output: 14 `overrides` edges,
-- 0 resolved, 14 ambiguous, where each target matched exactly as many declarations
-- as the file declared overloads. The name was changed between revisions only to
-- dodge an edge-level dedup collision, which is a symptom of the same name-keyed
-- identity and not a reason to keep it.
CREATE OR REPLACE FUNCTION d14_replace(a integer) RETURNS integer AS $$ SELECT a; $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION d14_replace(a integer) RETURNS integer AS $$ SELECT a + 1; $$ LANGUAGE sql;
-- OVERLOAD, NOT REPLACEMENT: same name, different input argument types. Two
-- functions, no replacement, so no `overrides` edge — the negative half.
CREATE OR REPLACE FUNCTION d14_overloaded(a integer) RETURNS integer AS $$ SELECT a; $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION d14_overloaded(a integer, b integer) RETURNS integer AS $$ SELECT a + b; $$ LANGUAGE sql;
-- ---------------------------------------------------------------- 5. index before table, for real
-- Section 3 declared the table first, so the owner was available at the time the
-- index was processed and the pass found nothing to do. THIS is the order the
-- adoption pass exists for: the index names a table that does not exist yet, and by
-- the end of the file it does.
CREATE INDEX d14_really_late_idx ON app.d14_really_late (id);
CREATE TABLE d14_really_late (id integer);
