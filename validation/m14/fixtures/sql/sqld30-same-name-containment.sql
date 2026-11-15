-- SQL-D30 — THE SAME-NAME CONTAINMENT FIXTURE.
--
-- A table and one of its COLUMNS may legally share a NAME. They are two DECLARATIONS, two KINDS and
-- two IDS, and the graph must say so: the column belongs to the table.
--
-- Before the fix, `addRelationship`'s self-containment guard compared the BARE NAMES, so a
-- `contains` edge whose member happened to share its table's name was dropped, and the column was
-- not in its table's shape. MEASURED over the whole admitted population: the before/after with the
-- grammar handed to BOTH analyzers is distinct edges 31,630 -> 31,639, delta +9, REMOVED 0 — and
-- every one of the nine is this shape (a table `useragent` with a column `useragent`, a table
-- `keyword` with a column `keyword`, and so on).
--
-- THE TWO RED ROWS are the two tables below whose COLUMN shares the TABLE'S OWN NAME:
--   `d30_self`   — the shape in the fixture's own name space.
--   `keyword`    — the EXACT shape the differential measured as a MISSING row
--                  (duckdb/benchmark/imdb_plan_cost/init/schema.sql, a table `keyword` with a
--                  column `keyword`), so the fixture mirrors the corpus row rather than a
--                  paraphrase of it. `keyword` is NOT a reserved word in PostgreSQL (it is not in
--                  Table C.1 at all), so the declaration is legal.
--
-- THE NEGATIVE CONTROLS are what the fix must NOT have broken, and they are two DIFFERENT questions:
--   `d30_keyword` — a COLUMN named `keyword` under a table with a DIFFERENT name. The names differ,
--                    so the old guard never fired here; the column must still be published, and this
--                    row says a fix that simply stopped publishing keyword-named columns would fail.
--   `d30_distinct`, `d30_other` — the ORDINARY shape, so a fix that stopped publishing containment
--                    edges altogether would fail here instead of passing.

CREATE TABLE d30_self (
  d30_self  INT,
  other     INT
);

CREATE TABLE keyword (
  keyword   VARCHAR,
  id        INT
);

CREATE TABLE d30_keyword (
  keyword   VARCHAR,
  id        INT
);

CREATE TABLE d30_distinct (
  alpha     INT,
  beta      VARCHAR
);

CREATE TABLE d30_other (
  gamma     INT
);
