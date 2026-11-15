-- SQLD5 — quoted identifiers, and a CTE that must only shadow what it can.
--
-- Three quoting styles, three behaviours before this fixture existed:
--   "MySchema"."MyTable" ("Id" int)  → name kept its double quotes, and the
--       COLUMN was lost entirely: the grammar puts a quoted name in a `literal`,
--       never an `identifier`, and the column reader required an identifier.
--   `db`.`users` (`id` int)           → name kept its backticks
--   [dbo].[Users] ([Id] int)          → delimiters stripped
-- The quotes are SQL syntax, not part of the name, so they are removed and the
-- raw text is kept alongside.
--
-- The second half is the scoping defect: a CTE name shadowed references by BARE
-- LEAF, so
--   WITH a AS (SELECT 1) SELECT * FROM a JOIN s.a ON true;
-- dropped the real `s.a` edge as well and the file emitted NO relationship at
-- all. A qualified reference is never a CTE.
CREATE TABLE "D5Schema"."D5Table" (
  "D5Id" int PRIMARY KEY,
  `d5col` text
);

CREATE VIEW v_d5 AS SELECT * FROM "D5Schema"."D5Table";

WITH d5_cte AS (SELECT 1 AS n)
SELECT * FROM d5_cte JOIN s.d5_cte AS real_table ON true;

-- The THIRD CTE shape, and the one the 84-fact m12 differential kept reporting as
-- its single false positive (`FP rel:Queries.sql:uses:global:recent_users`,
-- precision 0.988). A CTE BODY is itself a `statement`, so the declaration sweep
-- dispatches it — and the sweep had no CTE scope of its own, so the body's own
-- `FROM` reference to an earlier CTE was published as a TABLE edge. `d5_outer`
-- in the final SELECT was suppressed correctly by the same guard, which is why
-- the file published exactly the one edge it should not have.
-- The qualified table gets its OWN leaf (`d5_real`), deliberately: a qualified
-- reference publishes its BARE LEAF as the edge target (SQL-D7), so a real table
-- spelled `s.d5_first` would publish an edge to `d5_first` that this file
-- legitimately owes and the forbid row could not distinguish from the phantom.
WITH d5_first AS (SELECT 1 AS n),
     d5_second AS (SELECT n FROM d5_first)
SELECT * FROM d5_second JOIN s.d5_real ON true;
