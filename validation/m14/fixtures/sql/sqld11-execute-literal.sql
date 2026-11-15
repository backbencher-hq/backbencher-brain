-- SQLD11 — a declaration that reaches the database as a STRING.
--
-- PostgreSQL migrations reach the database two ways: by writing DDL, or by
-- handing it over as a string inside a procedural body. The second shape is the
-- dominant one in real extension files, and it was invisible to every pass in
-- the analyzer, because the DDL is a string literal: a tree-sitter grammar parses
-- one language and cannot produce `statement` nodes for SQL that is text inside
-- a literal.
--
-- MEASURED, on /usr/share/postgresql/14/extension (387 files <= 400 KB): the
-- analyzer emitted 2,172 symbols while 1,326 further CREATE declarations sat
-- inside `EXECUTE '...'` literals across 78 files.
--
-- A CORRECTION TO THAT NUMBER, and it matters more than the number. 1,248 of the
-- 1,326 (94%) are CONCATENATED FRAGMENTS, not statements:
--
--     EXECUTE 'CREATE SEQUENCE ' || quote_ident(toponame) || ' MINVALUE 1';
--
-- Here the literal is the three words `CREATE SEQUENCE ` and the declaration's
-- NAME is a runtime value. Only 78 of the literals contain a standalone,
-- complete statement. So the honest ceiling for this pass was ~78 declarations,
-- not 1,326, and what it actually delivers is +156 symbols and +234
-- relationships over the extension corpus — the fragments still yield a
-- kind-bearing symbol even when the name is unrecoverable. The kind is knowable;
-- the name never is, and that bounds every future extension of this path.
--
-- The pass is TEXT-based, not tree-based, which is why it needs no grammar change
-- and works on the grammar that is actually wired. A tree-based attempt was built
-- and rejected: see validation/m60/sql/v4-plpgsql-candidate.json — it cut
-- ProxiCall error nodes 36% and added 9% structure while leaving the product
-- byte-identical, because parsing the body still leaves the DDL inside a string.

-- 1. THE POSITIVE CASE. A standalone DDL statement inside an EXECUTE literal.
--    `touch_audit` must be found even though it is never written as source.
DO $$
BEGIN
  EXECUTE 'CREATE TABLE touch_audit (id serial, at timestamptz)';
END;
$$;

-- 2. THE COMMENT GUARD, which is the pass's only false-positive path and the
--    reason the scanner tracks `--` and `/* */`. A migration that disables DDL
--    leaves the text behind, and a comment-blind scanner publishes tables that
--    do not exist. Both of these must produce NOTHING.
-- EXECUTE 'CREATE TABLE ghost_line_comment (id int);';
/*
EXECUTE 'CREATE TABLE ghost_block_comment (id int);';
EXECUTE 'CREATE TABLE ghost_second_line (id int);';
*/

-- 3. A CONCATENATED FRAGMENT, pinned because it is the 94% case and the one
--    whose limit must stay visible: the kind is recoverable, the name is not.
DO $$
BEGIN
  EXECUTE 'CREATE INDEX ' || quote_ident(idx) || ' ON touch_audit (at)';
END;
$$;

-- 4. A live declaration in the ordinary way, as the control: the pass must be
--    strictly additive and must not disturb what already worked.
CREATE TABLE written_normally (id int, label text);

-- 5. An escaped quote inside the literal ('' is one quote, and the raw
--    between-the-quotes text is handed to the parser AS WRITTEN so that every
--    recovered range stays byte-exact).
DO $$
BEGIN
  EXECUTE 'CREATE TABLE quoted_name (''weird'' text)';
END;
$$;
