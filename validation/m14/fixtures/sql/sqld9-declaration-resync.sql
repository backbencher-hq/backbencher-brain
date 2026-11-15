-- SQLD9 — one unparseable statement must not cost the declarations after it.
--
-- Two defects stacked here, and the pinned grammar fixed only one of them.
--
-- (1) THE CASCADE. The grammar requires a dollar-quoted function body to be
--     `BEGIN ... END` of PARSEABLE statements. `RAISE` is not one, so
--     function_body failed on every alternative, the closing tag was never
--     consumed, and the parser swallowed THE REST OF THE FILE into a single
--     ERROR node. Measured on the real corpus (441 files, 2,336 textual
--     declarations): the whole-file parse reached 1,557 (66.65%), a full-tree
--     declaration sweep 1,644 (70.38%), a statement-level resync re-parse 2,263
--     (96.88%) — and on database/schema.sql (10,572 lines, 163 CREATE TABLE) the
--     analyzer emitted 10 table symbols. The M60 grammar wave wires the
--     scanner's already-implemented opaque `$$ ... $$` token into function_body
--     at low precedence, so a body that cannot parse no longer costs the file.
--
-- (2) THE RESIDUAL. A TAGGED dollar-quote (`$fn$ ... $fn$`) combined with a
--     `pg_temp.`-qualified function name is still not recoverable by the main
--     pass, and that is the shape the analyzer's resync pass exists for: the
--     file is re-parsed one top-level statement at a time and the declarations
--     after the damage are recovered. Measured live: the resync fires on 9
--     corpus files and recovers 31 declarations, worst case
--     verify_m95_3043_coms_rls_hardening.sql at +12 from 27 statements.
--
-- The pair below is the pin for BOTH halves. A fix that only stops the cascade
-- still loses d9_after_tagged; a fix that only adds the resync still loses
-- d9_raises.
CREATE TABLE d9_before (id int PRIMARY KEY, name text);

CREATE FUNCTION d9_raises() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'd9: not SQL the grammar knows';
END;
$$;

CREATE TABLE d9_after (id int PRIMARY KEY, ref int REFERENCES d9_after (id));
CREATE INDEX d9_after_idx ON d9_after (ref);

CREATE FUNCTION d9_after_tagged(p_state TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN p_state = 'x' THEN 'y' ELSE p_state END;
$fn$;

CREATE TABLE d9_last (id int PRIMARY KEY);
CREATE VIEW d9_last_view AS SELECT id FROM d9_last;
