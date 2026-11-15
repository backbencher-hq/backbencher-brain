-- SQLD6 — a relationship target is never a keyword, and a call is never a builtin.
--
-- Both classes are ERROR-recovery artefacts, and both put a name in the graph
-- that no SQL reader would call a table or a function:
--   `REVOKE SELECT ON t FROM joe`  -> the ROLE name was read out of a from clause
--                                     and reported as `uses global->joe`
--   `... USING o ...` inside an unparsed region -> `calls global->USING`
--   `count(*) FILTER (...)`       -> `calls get_brand_network_stats->FILTER`
-- Measured 49 keyword-target edges over 441 corpus files before the guard.
--
-- The second half is the builtin list. A call to a function SQL itself provides
-- is a language feature, not a dependency on a project symbol, and the store
-- cannot resolve it - `generate_series`, `jsonb_build_object`, `current_setting`
-- and `cardinality` all leaked out of the unresolvable-edge sample.
--
-- A user-defined function of the same shape must still produce its edge, so the
-- last row is the control that stops a fix from simply dropping every call.
SELECT COUNT(*), MAX(id), UPPER(email), COALESCE(x, 0) FROM d6_table;
SELECT generate_series(1, 10);
SELECT jsonb_build_object('a', 1);
SELECT current_setting('search_path');
SELECT d6_project_function(1) FROM d6_table;
