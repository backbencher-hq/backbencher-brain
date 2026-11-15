-- SQLD13 — the three relationship types this lane emits beyond the original four,
-- plus the phantom-column guard. Every shape here is read off REAL corpus text,
-- named in the expectation file's `authoredFrom`; none of it was invented to make
-- a pin pass.
--
-- 1. psql include. `\ir` / `\i` is the only construct in the wired grammar's
--    dialects that names ANOTHER FILE: 22 such directives across 6 files of the
--    1,460-file census, every one with a literal filename, none with a psql
--    variable. `\echo` / `\set` / `\gexec` are in the fixture too, because the
--    guard that keeps them out is the thing most likely to regress.
\ir d13_base_schema.sql
\i ./d13_extra_columns.sql
\ir ../shared/d13_common.sql
\echo this is a message, not a dependency
\set d13_var 1
\gset
-- The three include shapes whose target is NOT a resolvable file. `\i :var`
-- takes a psql variable whose value lives in another statement, `\ir` with no
-- argument names nothing, and `\ir nofile` names a path with no SQL suffix.
-- Measured on the census corpus: 0 of 22 includes look like this, so these three
-- rows are here because they are the REGRESSION population, not because the
-- corpus needed them.
\i :d13_script_var
\ir
\ir d13_no_suffix

-- 2. Override. `CREATE OR REPLACE` on a name this file already declared, WITH THE
--    SAME ARGUMENT TYPES, is a replacement in PostgreSQL's own words. Measured: 666
--    OR REPLACE declarations over the census corpus, of which 15 replace a
--    declaration in the SAME file, and those 15 are the only ones a per-file
--    analyzer can see. The two `d13_replace_*` functions below are the same-name
--    same-signature case; the `d13_replace_view` pair is `CREATE OR REPLACE VIEW`,
--    the second replaceable kind. The third function is deliberately NOT
--    re-declared: it is the pin that a re-declared NAME on a DIFFERENT kind is not
--    an override.
CREATE OR REPLACE FUNCTION d13_replace_me(a integer) RETURNS integer AS $$ SELECT a; $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION d13_replace_me(a integer) RETURNS integer AS $$ SELECT a + 1; $$ LANGUAGE sql;
CREATE OR REPLACE VIEW d13_replace_view AS SELECT 1 AS one;
CREATE OR REPLACE VIEW d13_replace_view AS SELECT 2 AS two;
CREATE OR REPLACE FUNCTION d13_only_once() RETURNS integer AS $$ SELECT 1; $$ LANGUAGE sql;
-- THE SAME NAME WITH A DIFFERENT ARGUMENT LIST IS AN OVERLOAD, NOT A REPLACEMENT.
-- PostgreSQL identifies a routine by (schema, name, input argument types), so these
-- two declarations create two functions that coexist and `\df d13_overloaded` prints
-- two rows; nothing is replaced. This pair is the pin for the defect the incoming
-- gate measured on the corpus: `overrides` emitted 14 edges, 0 resolved, 14
-- ambiguous, and the declaration count each target matched WAS the overload count
-- (`overloaded` 2, `overloaded_default` 4, `overloaded_html_form` 3,
-- `overloaded_unnamed_param` 5). The first shape of this fixture asserted the
-- opposite -- `d13_replace_me(a integer)` "replaced" by `d13_replace_me(a integer,
-- b integer)` -- which is an edge PostgreSQL contradicts, so the positive pin moved
-- to the same-signature pair above and this negative took its place.
CREATE OR REPLACE FUNCTION d13_overloaded(a integer) RETURNS integer AS $$ SELECT a; $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION d13_overloaded(a integer, b integer) RETURNS integer AS $$ SELECT a + b; $$ LANGUAGE sql;
-- The same NAME on two different kinds is NOT a redefinition. This is Hasura's
-- `10_to_11.sql` shape verbatim in miniature: `CREATE FUNCTION
-- hdb_catalog.hdb_schema_update_event_notifier()` at line 7 and `CREATE TRIGGER
-- hdb_schema_update_event_notifier` at line 25 are two distinct objects that
-- happen to share a name, and a name-keyed probe reported 102 such "redefs"
-- across the corpus before the kind was taken into account.
CREATE TABLE d13_twin (id integer);
CREATE TRIGGER d13_twin AFTER INSERT ON d13_twin FOR EACH ROW EXECUTE FUNCTION d13_only_once();

-- 3. Instantiation. PostgreSQL builds a composite value with `ROW(...)::type`,
--    which is a call to that type's constructor. The composite type is declared
--    in THIS file, so both ends of the edge resolve here. `d13_never_built` is
--    declared and never constructed, which is the pin that a DECLARED type is
--    not by itself an instantiation site. The conversion rows below are the
--    other negative half: `nextval()` cast, a column cast and a cast of a bare
--    literal all convert a value that already exists.
CREATE TYPE d13_pair AS (a integer, b integer);
CREATE TYPE d13_never_built AS (a integer);
CREATE TABLE d13_holder (id serial PRIMARY KEY, pair d13_pair, plain integer);
SELECT ROW(1, 2)::d13_pair;
SELECT (3, 4)::d13_pair;
SELECT nextval('d13_holder_id_seq')::integer;
SELECT id::d13_pair FROM d13_holder WHERE plain = 1;

-- 4. The phantom column guard. The wired grammar cannot represent
--    `CREATE TABLE … (LIKE src INCLUDING ALL)`: it parses the `LIKE src` pair as
--    a column_definition whose NAME is the keyword `LIKE` and whose type is the
--    source table, which published a column named `LIKE` of type `src`. Measured
--    6 of them corpus-wide. A genuinely quoted `"like"` column must survive,
--    because that is the shape the guard has to leave alone.
CREATE TABLE d13_archive (LIKE d13_holder INCLUDING ALL);
CREATE TABLE d13_quoted ("like" integer);
-- 5. Extension install. `CREATE EXTENSION name` loads a separately DISTRIBUTED
--    unit into the database, and the file cannot mean anything without it. The
--    analyzer recorded the symbol and emitted no edge, so 27 declarations over
--    the 1,460-file census were 27 `module` symbols with zero dependencies —
--    the one construct where SQL genuinely has a cross-unit dependency, and the
--    only place it was invisible. `d13_if_not_exists` is the same edge with a
--    guard keyword, because the extension is still required either way.
CREATE EXTENSION d13_uuid_ossp;
CREATE EXTENSION IF NOT EXISTS d13_postgis;
