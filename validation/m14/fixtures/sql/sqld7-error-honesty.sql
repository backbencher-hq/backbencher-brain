-- SQLD7 — a file the grammar cannot parse must say so.
--
-- The analyzer returned `errors: []` UNCONDITIONALLY. A file it could not parse
-- at all therefore read as a clean 0 symbols / 0 relationships / 0 errors, and
-- every gate that calls `analyzer.analyze` directly (this fixture lane, the
-- mutation harness, the m12 differential) saw a successful analysis of a total
-- failure. The engine's parseFile also reports tree errors, but the analyzer's
-- own channel was empty, and the analyzer's channel is the one the gates read.
--
-- Line 6 is a construct the pinned grammar cannot parse; lines 1-4 and 8 are
-- ordinary DDL, so this also pins that one bad statement does not cost the
-- declarations around it.
CREATE TABLE d7_ok (id int PRIMARY KEY, name text NOT NULL);
CREATE INDEX d7_ok_idx ON d7_ok (name);
COPY d7_ok TO '/tmp/d7.csv' WITH CSV HEADER;
SHOW search_path;
CREATE VIEW d7_ok_view AS SELECT id FROM d7_ok;
