-- SQLD8 — 1-based columns, and distinct ids for distinct declarations.
--
-- The range helper emitted 0-BASED columns. The engine's own ParseError range
-- uses `startPosition.column + 1` (engine.ts:1180) and every other analyzer
-- that builds a range helper does the same - real-r, real-clean, real-groovy,
-- real-hcl, real-lua, real-graphql, real-bash - so SQL was the only 0-based
-- range in the tree and all four column fields of EVERY SQL symbol were off by
-- one, corpus-wide.
--
-- `ab` below starts at row 2, column 3 (1-based): two spaces of indent then the
-- name. `cd` starts at row 5, column 5.
--
-- The second half is id uniqueness. `id` was `parentId ?? name`, so two
-- top-level entities sharing a bare name collided: `a.d8_samename` and
-- `b.d8_samename` both got id `d8_samename`. Duplicate ids silently drop nodes
-- from id-keyed graph consumers and conflate two distinct declarations.
CREATE TABLE d8_ranges (
  ab int,
  cd text
);

CREATE TABLE a.d8_samename (x int);
CREATE TABLE b.d8_samename (y int);
CREATE VIEW d8_samename AS SELECT 1;
