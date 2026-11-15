-- SQLD3 — a routine's signature, read off the grammar's own layout.
--
-- `function_argument` has NO `type` field at all — only `custom_type`, and only
-- when the type is a user-defined name. The builtin type is simply the child
-- after the parameter's name. The previous accessor matched `type` or
-- `keyword_*`, which (a) lost every WRAPPED type node — the grammar wraps
-- `INTEGER` as an `int` containing a `keyword_int`, so `child.type` is `int`,
-- not `keyword_*` — and (b) matched the mode keyword FIRST, so `IN a integer`
-- produced `{ name: "a", type: "IN" }`, a fabricated type.
--
-- Measured on the corpus: 69 parameters with a missing type, and inconsistently
-- so — `UUID` and `TEXT` came through while `bigint` did not, because only the
-- bare `keyword_*` spellings were ever read.
--
-- The return type had its own version of the same bug: the single next sibling
-- after RETURNS, so `int[]` read as `int`, `SETOF record` read as `SETOF`, and
-- `RETURNS TABLE (a int, b text)` read as `TABLE` with the OUT parameters
-- dropped entirely.
CREATE FUNCTION d3_signature(
  a integer,
  b my_schema.my_type,
  c int[],
  d numeric(10,2) DEFAULT 7,
  IN e bigint,
  OUT f text,
  INOUT g timestamptz
) RETURNS int[] AS $$ SELECT 1 $$ LANGUAGE sql;

CREATE FUNCTION d3_setof() RETURNS SETOF record AS $$ SELECT 1 $$ LANGUAGE sql;

CREATE FUNCTION d3_returns_table(p integer)
RETURNS TABLE (out_a int, out_b text)
AS $$ SELECT 1, 'x' $$ LANGUAGE sql;
