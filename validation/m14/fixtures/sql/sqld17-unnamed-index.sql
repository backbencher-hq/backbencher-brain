-- SQLD17 — AN INDEX THE SOURCE NEVER NAMES gets NO SYMBOL.
--
-- `CREATE INDEX ON t (col)` is legal PostgreSQL and the corpus writes it: hasura-engine
-- ships `CREATE INDEX ON hdb_catalog.event_log (trigger_name)` in
-- server/src-rsr/init_pg_source.sql and in four of its migrations. The server picks the
-- index's name at creation time, so the name is NOT KNOWABLE FROM THE TEXT — which is the
-- whole reason nothing is emitted for it below.
--
-- WHAT THE analyzer used to do, measured over the 1,962-file corpus:
--   1,486 `create_index` nodes, 8 of them unnamed (0.54%).
--   The grammar says "unnamed" structurally: a `create_index` with no own-name field has
--   no identifier child before its `ON` clause. The name lookup then fell through to
--   `firstIdentifier`, which walks the subtree and returned the first identifier INSIDE the
--   `object_reference` — the SCHEMA QUALIFIER. Result: `event_log` was published as
--   containing a member named `hdb_catalog`, six times across hasura-engine, plus two in
--   boundary/internal/db/schema/migrations/oss/postgres/0/68_wh_session_facts.up.sql.
--
-- WHY THAT IS A FABRICATION AND NOT A NAMING QUIRK. `hdb_catalog` is a SCHEMA. It is
-- declared by `CREATE SCHEMA hdb_catalog` elsewhere in the corpus, so the edge points at
-- something real that is not what it claims: the member is not an index at all, and the
-- table appears to own a schema. Every `contains` edge is a declaration fact, and this one
-- asserts a declaration that does not exist.
--
-- HOW IT WAS FOUND, which is the part worth keeping: not by reading the code, and not by a
-- fixture. `validation/m14/fixtures/sql/sql-contains-oracle.mts` derives `contains` a second
-- time from the grammar's own structure and reported 19 corpus edges as analyzer-only whose
-- member name was a schema qualifier. A fixture written from the same reading would have
-- passed against the bug, because the fixture would assert what the code does.
--
-- WHAT IS ASSERTED, and why the two halves fail independently:
--   1. `ambiguity.unnamedIndexSkipped` counts every unnamed index this file contains. The
--      omission is COUNTABLE, so it is a declared number rather than a silent gap — and a
--      mutant that drops the counter fails here while every relationship assertion below
--      still passes.
--   2. No symbol and no edge may carry the schema qualifier as a member name. The negative
--      is what the defect actually was; the counter alone would pass against a version that
--      skipped the index AND emitted nothing to count.

-- 1. THE POSITIVE: an unnamed index, whose schema qualifier is `ignored_schema`.
CREATE TABLE event_log (id int PRIMARY KEY, trigger_name text);
CREATE INDEX ON ignored_schema.event_log (trigger_name);

-- 2. A NAMED index in the same file, over the same table, in the same schema. The
--    qualifier appears on this one too, so a fix that suppressed every schema-qualified
--    index rather than every UNNAMED one would lose a real declaration and pass otherwise.
CREATE INDEX event_log_fetch_events ON ignored_schema.event_log (trigger_name);

-- 3. A named index whose OWN name equals its schema qualifier. The names are equal, so a
--    check written on the string rather than on the parse fact cannot tell 3 from the bug.
CREATE INDEX dup_name ON dup_name.dup_name (id);