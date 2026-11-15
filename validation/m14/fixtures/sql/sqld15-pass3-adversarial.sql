-- sqld15 — pass-3 adversarial regression fixture.
--
-- Two defects, both found by measuring production `parseFile` over the corpus rather
-- than by reading the analyzer. The instruments are committed beside this file:
-- `validation/m14/fixtures/sql/pass3-phantom-constraint.mts` (with a parse-tree
-- oracle, not a heuristic) and `validation/m14/fixtures/sql/pass3-incoming.mts`.
--
--   1. A `constant` DECLARATION THE FILE DOES NOT CONTAIN. `processConstraint` reads
--      a constraint's name from the identifier after `keyword_constraint`. With no
--      `CONSTRAINT` keyword it fell back to `directChild(node, "identifier")`, added
--      for MySQL's `UNIQUE KEY <name> (cols)`. But an unnamed FOREIGN KEY has direct
--      identifier children too, and they are the REFERENCED table's columns:
--
--        foreign key (a, b) references u (x, y)
--          constraint
--            keyword_foreign keyword_key
--            ordered_columns (a, b)          <- LOCAL columns, nested under `column`
--            keyword_references object_reference u
--            identifier x   identifier y      <- DIRECT children: u's columns
--
--      So the fallback took `x` and published `constant:x` owned by the referencing
--      table. Oracle-validated at HEAD before the fix: 53 phantom declarations in 22
--      files, e.g. two `constant:scope_id` under `auth_account` in
--      boundary/.../0/07_auth.up.sql lines 90 and 94 against the real
--      `property:scope_id` at line 72.
--
--      The discriminator is ORDER: MySQL's index name PRECEDES `ordered_columns`, the
--      foreign key's referenced columns FOLLOW it. Section 1 pins the forbid side and
--      section 2 pins the allow side, because a fix that simply stopped emitting
--      constraint symbols would pass section 1 alone.
--
--   2. A `contains` TARGET THAT NAMES TWO DECLARATIONS. `CREATE TABLE t (scope_id int)`
--      beside `CREATE INDEX scope_id ON t (...)` is ordinary SQL, and the edge names
--      the member by BARE NAME, so the reverse walk in `src/lsp/impact.ts` matches on
--      name alone and picks a winner by a rule nobody chose. Measured on 1,955 corpus
--      files: bare-name resolution is unique for 9,374 of 11,305 `contains` edges
--      (82.9 %), (name, ownerName) within the file for 11,204 (99.1 %), and 100
--      remain — a column and an index sharing a name AND an owner. The edge now
--      carries `metadata.memberKind`, which with the edge's existing source (the owner)
--      is the pair a consumer needs. Section 3 pins it on both kinds.

-- ================================================================ 1. forbid side
-- The unnamed foreign key. `d15_fk_col` is a column of `d15_fk_src`; the constraint
-- must NOT publish a `constant` named after `d15_fk_ref`'s first referenced column.
CREATE TABLE d15_fk_src (
  d15_fk_col integer,
  d15_fk_other integer
);
CREATE TABLE d15_fk_ref (
  d15_fk_ref integer,
  d15_fk_ref2 integer
);
-- Two of them, because one phantom is a coincidence and two is the per-foreign-key
-- shape the corpus showed (07_auth.up.sql carries both).
ALTER TABLE d15_fk_src ADD CONSTRAINT d15_fk_a
  FOREIGN KEY (d15_fk_col) REFERENCES d15_fk_ref (d15_fk_ref);
-- The UNNAMED form, which is the one the defect lived in. PostgreSQL accepts it.
ALTER TABLE d15_fk_src
  FOREIGN KEY (d15_fk_col) REFERENCES d15_fk_ref (d15_fk_ref2);
-- A multi-column unnamed foreign key: the first referenced column is the one that
-- would be taken.
ALTER TABLE d15_fk_src
  FOREIGN KEY (d15_fk_col, d15_fk_other) REFERENCES d15_fk_ref (d15_fk_ref, d15_fk_ref2);

-- The unnamed UNIQUE constraint, which the grammar reduces differently (no direct
-- identifier at all) and which therefore never produced a phantom. Pinned so a change
-- to the discriminator cannot silently start inventing one here.
ALTER TABLE d15_fk_src ADD UNIQUE (d15_fk_col, d15_fk_other);
-- An unnamed PRIMARY KEY, same reason.
ALTER TABLE d15_fk_src ADD PRIMARY KEY (d15_fk_col);

-- ================================================================ 2. allow side
-- MySQL's `UNIQUE KEY <name> (cols)`: the name IS a direct identifier, and it
-- PRECEDES the column list. This must keep working — a fix that dropped the fallback
-- would delete real declarations. Verbatim shape of
-- phpmyadmin/resources/sql/create_tables.sql line 68.
CREATE TABLE `d15_mysql` (
  `d15_my_col` varchar(64) NOT NULL default '',
  `d15_my_col2` varchar(64) NOT NULL default '',
  UNIQUE KEY `d15_my_idx` (`d15_my_col`, `d15_my_col2`)
);

-- And the one the corpus actually contains as a genuine same-name pair: an index
-- NAMED after a column of its own table. This is a real declaration and must be
-- published, even though its name collides with a column — the oracle in
-- pass3-phantom-constraint.mts clears exactly this case on
-- `UNIQUE KEY \`db_name\` (\`db_name\`, \`table_name\`)`.
CREATE TABLE d15_samename (
  d15_same_col varchar(64) NOT NULL default '',
  d15_same_col2 varchar(64) NOT NULL default '',
  UNIQUE KEY d15_same_col (d15_same_col, d15_same_col2)
);

-- A named foreign key, which is the `keyword_constraint` path and must be unaffected.
CREATE TABLE d15_named_src (d15_named_col integer);
CREATE TABLE d15_named_ref (d15_named_ref integer);
ALTER TABLE d15_named_src ADD CONSTRAINT d15_named_fk
  FOREIGN KEY (d15_named_col) REFERENCES d15_named_ref (d15_named_ref);

-- ================================================================ 3. memberKind
-- A column and an index sharing a name under one owner. Both `contains` edges must
-- carry `memberKind`, and the two must DIFFER, because that difference is the whole
-- disambiguator: a consumer reading the bare target alone cannot tell them apart.
CREATE TABLE d15_collide (d15_collide_id integer, note text);
CREATE INDEX d15_collide_id ON app.d15_collide (d15_collide_id);

-- The ordinary column containment, for contrast: `memberKind` must be `property` here
-- too, so the key is on every containment edge and not only the colliding ones.
CREATE TABLE d15_plain (d15_plain_id integer);

-- The index-before-table order, which takes the OTHER emission site (the one where the
-- owner does not exist yet, so `createSymbol` emits no containment edge and the
-- explicit call does). `memberKind` has to be there too, or exactly the edges that
-- collide most often — an index and a column, declared index-first — stay ambiguous.
CREATE INDEX d15_late_id ON app.d15_late (d15_late_id);
CREATE TABLE d15_late (d15_late_id integer);
-- ================================================================ 4. DEAD CODE MADE LIVE
-- `processDo` existed, its body was three real calls, and it was UNREACHABLE: its only caller
-- sat in `dispatchDeclaration`, which runs for `DECLARATION_NODES` only, and `do_statement` is
-- not a declaration. A source-derivation count of "which types can this analyzer construct" would
-- have counted `calls` from a DO block as constructible. It produced nothing.
--
-- Settled by validation/m14/fixtures/sql/pass3-invocation-why.mts over the corpus: of 742
-- qualified invocations on the tree, 449 became `calls` edges before this round. The bucket the
-- probe could not explain away is now 0.
DO $d15$
BEGIN
  PERFORM d15_do_helper(1);
  -- The shape that hid the second half: a SELECT inside a PERFORM ARGUMENT. It is a `select`
  -- expression, not a `statement`, so the declaration sweep's nested-statement re-entry never
  -- reached it — `proxicall/database/verify_m95_3043_coms_rls_hardening.sql` lines 395-402.
  PERFORM d15_do_recorder('x', (SELECT d15_do_helper(2) AND NOT d15_do_helper(3)));
END
$d15$;

-- The guard against over-reaching: a DO block that declares nothing must publish no SYMBOL, and
-- its edges must be owned by `global`, which is the same owner its `uses` edges already carry.
-- A DO block has no name, so `global` is the honest owner rather than a convenient one.
DO $d15b$ BEGIN PERFORM d15_do_anon(1); END $d15b$;

-- ================================================================ 5. A CALL IN AN ALTER
-- `ALTER TABLE t ALTER COLUMN c SET DEFAULT app.f()` puts an `invocation` in a
-- grammar-mandated expression slot, and it produced no edge: `alter_table` is neither a query nor
-- a declaration, and `processAlterTable` returns early when the statement adds no column — which
-- is exactly this shape. `hasura-engine/server/src-rsr/migrations/41_to_42.sql` writes
-- `SET DEFAULT hdb_catalog.gen_hasura_uuid()` five times in one file.
--
-- Sourced to the ALTERED TABLE, not to `global`, because the table is a published symbol and
-- `global` is not — so this is also an edge the reverse walk can arrive at.
CREATE TABLE d15_alter_target (d15_alter_col text);
ALTER TABLE d15_alter_target ALTER COLUMN d15_alter_col
  SET DEFAULT d15_alter_default();

-- The negative: an ALTER that calls nothing must add no `calls` edge, so a fix that routed every
-- statement through `processCalls` cannot pass this fixture by emitting edges everywhere.
ALTER TABLE d15_alter_target ADD CONSTRAINT d15_alter_uq UNIQUE (d15_alter_col);
