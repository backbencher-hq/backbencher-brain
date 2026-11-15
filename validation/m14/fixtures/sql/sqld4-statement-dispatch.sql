-- SQLD4 — every statement kind must reach a handler.
--
-- `processStatement` had a `statement` branch that forwarded only the types
-- `isDeclaration()` recognised and otherwise tested the children for a query
-- shape, then RETURNED. A `statement` holding anything else never reached the
-- switch below it. Measured dead arms on the pinned grammar, all of which DO
-- produce these node types:
--   SET search_path TO public;   → set_statement     → "Session Configuration" NEVER fired
--   RESET ALL;                   → reset_statement   → "Session Configuration" NEVER fired
--   COMMENT ON TABLE t IS 'x';   → comment_statement → "SQL Documentation"    NEVER fired
--
-- `MERGE` and `TRUNCATE` have no node type at all: their grammar rules are
-- HIDDEN (`_merge_statement`, `_truncate_statement`), so the keywords and the
-- object references inline straight into `statement` and an arm keyed on
-- `merge` can never be reached. Both emitted nothing at all before.
--
-- `grant_statement` / `revoke_statement` had arms naming node types the grammar
-- never produced anywhere in its 321 — "Permissions (GRANT/REVOKE)" could not
-- fire. The grammar wave added both rules; this fixture is the pin on the
-- analyzer half.
SET search_path TO public;
RESET ALL;
COMMENT ON TABLE d4_doc_target IS 'documented';
MERGE INTO d4_merge_target USING d4_merge_source
  ON d4_merge_target.id = d4_merge_source.id
  WHEN MATCHED THEN UPDATE SET d4_merge_target.x = d4_merge_source.x;
TRUNCATE TABLE d4_truncate_target;
GRANT SELECT ON d4_grant_target TO some_role;
REVOKE SELECT ON d4_grant_target FROM some_role;
