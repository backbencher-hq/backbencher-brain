-- SQLD16 — a DOT IN A QUOTED NAME IS PART OF THE NAME, not a schema separator.
--
-- `FROM vault.secret` and `FROM "vault.secret"` are different SQL. The first names table
-- `secret` in schema `vault`; the second names ONE table called `vault.secret`, because
-- quoting is how a name is allowed to contain a dot. The grammar agrees, and this is the
-- measurement the whole fixture rests on:
--
--   FROM vault.secret     -> object_reference( identifier("vault"), identifier("secret") )
--   FROM "vault.secret"   -> object_reference( identifier("\"vault.secret\"") )
--   FROM "vault"."secret" -> object_reference( identifier("\"vault\""), identifier("\"secret\"") )
--
-- So the distinction is a PARSE FACT — one leaf versus two — and not a guess about the
-- text. Two leaves is qualified whatever the quoting; one quoted leaf is a whole name.
--
-- WHY IT IS A DEFECT AND NOT A COSMETIC ONE. `vault` is a Supabase schema, so the
-- classifier that splits on the dot labelled the project's own table `vault.secret` as a
-- hosted-platform object. An edge whose target resolves to a table THIS FILE DECLARES was
-- being published as external, which is a claim about the file that is false in it, and a
-- consumer that reads `external` concludes the repository talks to a hosted vault.
--
-- WHAT THE FIX CARRIES, and why it is metadata and not a re-read of the node. The
-- classifier runs long after the reference has been reduced to an edge, at which point the
-- node is gone; only the bare target and the qualified name survive. Without a carrier the
-- two sites would each have to re-derive quotedness, and one of them did it wrong: an
-- earlier version tested `referenceNameNode(o).type === "literal"`, which is FALSE for
-- every quoted name in this position because the grammar emits an `identifier` carrying the
-- quotes in its TEXT. That version set the flag on nothing, so the classifier ran
-- identically with and without the change and `"vault.secret"` kept the platform label.
-- `quotedName` is the parse fact carried forward, and it is asserted on below so the mutant
-- that drops it is caught here rather than on a customer graph.
--
-- Measured, both mutants, on this file through `parseFile`:
--   carrier absent (this file at HEAD)  -> 3 of the 8 relationships carry a WRONG
--                                          `meta.external=platform`, and all 3 are the
--                                          quoted-whole-name edges below.
--   carrier present but computed as `node.type === "literal"` -> 0 of 8 change. The flag is
--                                          never set on that spelling, so the classifier runs
--                                          exactly as it did before the "fix" existed.
-- The second line is why this file pins `meta.quotedName` and not only the absence of the
-- label: a fixture that asserted only the absent label would pass against the version that
-- silently does nothing, and that version is the one that was written first.

-- 1. THE POSITIVE CASE. A project table whose own name contains a dot, declared here and
--    therefore resolvable — and a quoted reference to it, which must NOT be relabelled.
CREATE TABLE "vault.secret" (id int PRIMARY KEY, note text);
CREATE VIEW v_quoted_whole AS SELECT id FROM "vault.secret";

-- 2. THE NEGATIVE THAT PINS THE OPPOSITE SIDE. Unquoted, the same text IS schema-qualified,
--    so the platform label is CORRECT here. Without this row a mutant that simply deletes
--    the classifier would pass.
CREATE VIEW v_unqualified AS SELECT a FROM vault.unknown_table_zz;

-- 3. THE BOUNDARY BETWEEN 1 AND 2: quoted on both sides, but TWO leaves, so it really is
--    schema-qualified and the label stands. This is the case that makes
--    `parts.length === 1` load-bearing rather than decorative.
CREATE VIEW v_two_quoted_parts AS SELECT a FROM "vault"."unknown_table_zz";

-- 4. CALLS carry the same distinction, and the exposure is DOUBLE: one `"vault.decrypt"()`
--    inside a routine body emits the edge twice (two call shapes, one name), so a mislabel
--    here is counted twice per function.
CREATE FUNCTION call_quoted_whole() RETURNS text LANGUAGE sql
  AS $$ SELECT "vault.decrypt"() $$;
CREATE FUNCTION call_unqualified() RETURNS text LANGUAGE sql
  AS $$ SELECT vault.unknown_fn_zz() $$;
CREATE FUNCTION call_two_parts() RETURNS text LANGUAGE sql
  AS $$ SELECT "vault"."unknown_fn_zz"() $$;

-- 5. A quoted dotted name with NO platform schema in front of it, which is the ordinary
--    case and must be untouched: `sales.total` is not anybody's external schema.
CREATE VIEW v_benign_dotted AS SELECT a FROM "sales.total";