-- SQLD18 — the `extends` emission, and the FOUR FABRICATED EDGES the pre-fix code published.
--
-- WHY THIS FIXTURE EXISTS. `extends` is the ONE relationship type this lane emits and never fires
-- on the corpus, and the reason the type stayed in the denominator was always "the corpus is
-- quiet". That stayed true while the EMISSION ITSELF was wrong: the rule keyed on the mis-parsed
-- column's NAME (`inherit`) and took the mis-parse's `custom_type` as the parent table — so three
-- legal SQL statements that have the SAME tree shape published an `extends` edge that PostgreSQL
-- contradicts. The lane's own falsifier (validation/m14/verification/SQL-EXTENDS-FALSIFIER.md) had
-- exactly ONE negative control — the `LIKE` copy — so it never asked the other three questions.
--
-- THE SHAPE, measured against the pinned wasm (probed, not assumed):
--   ALTER TABLE child INHERIT parent;
--     → (alter_table (keyword_alter) (keyword_table) (object_reference name:(identifier))
--          (add_column (column_definition name:(identifier "INHERIT")
--                       custom_type:(object_reference name:(identifier "parent")))))
--   ALTER TABLE c ADD COLUMN inherit int;
--     → (alter_table … (add_column (keyword_add) (keyword_column)
--          (column_definition name:(identifier "inherit") type:(int (keyword_int)))))
--   ALTER TABLE child NO INHERIT parent;
--     → (alter_table … (ERROR (keyword_no))
--          (add_column (column_definition name:(identifier "INHERIT")
--                       custom_type:(object_reference name:(identifier "parent")))))
--
-- THE DISCRIMINATOR IS STRUCTURAL (SQL-D17): an explicit `ADD`/`COLUMN` keyword means the grammar
-- SAW a column, and a `keyword_no` under the `alter_table` means the clause REMOVES inheritance.
-- With both guards the only remaining shape is a real `INHERIT` clause.
--
-- 1. THE POSITIVE CONTROL. The parent is declared first because the `ALTER` path resolves the
--    altered table among the declarations this file has made — a bare `ALTER TABLE child INHERIT
--    parent;` with no `CREATE` in the same file emits nothing, and that is the ALTER path's
--    pre-existing behaviour, not this rule's.
CREATE TABLE d18_parent (id int);
CREATE TABLE d18_child (id int);
ALTER TABLE d18_child INHERIT d18_parent;

-- 2. THE COLUMN THAT IS CALLED `inherit`. `inherit` is a NON-RESERVED PostgreSQL keyword, so this
--    is legal SQL, and the grammar reads it exactly like the inheritance clause. The pre-fix code
--    published `extends d18_col_named -> int` — a fabricated edge naming a TYPE as a parent table.
--    The column itself MUST still be published: the fix removes a false edge, not a true symbol.
CREATE TABLE d18_col_named (id int);
ALTER TABLE d18_col_named ADD COLUMN inherit int;

-- 3. THE SAME COLUMN WITH A CUSTOM TYPE. Here the mis-parse's `custom_type` is a NAME rather than
--    a builtin, so the fabricated edge named a plausible-looking table: `extends
--    d18_col_custom -> d18_some_type`. This is the shape most likely to survive a reviewer.
CREATE TABLE d18_col_custom (id int);
ALTER TABLE d18_col_custom ADD COLUMN inherit d18_some_type;

-- 4. `ADD` WITHOUT `COLUMN`. Also legal, also a column, also a fabricated edge in the pre-fix code
--    (`extends d18_add_bare -> int`) — and the pin that the guard reads `keyword_add` as well as
--    `keyword_column`, because this shape carries only the former.
CREATE TABLE d18_add_bare (id int);
ALTER TABLE d18_add_bare ADD inherit int;

-- 5. `NO INHERIT` — THE CLAUSE THAT REMOVES THE RELATION. The pre-fix code published `extends
--    d18_no_inherit -> d18_parent` for it, asserting the OPPOSITE of what the statement says. This
--    is the most dangerous of the four: it is a TRUE-LOOKING edge about a relation that does not
--    exist.
CREATE TABLE d18_no_inherit_parent (id int);
CREATE TABLE d18_no_inherit (id int);
ALTER TABLE d18_no_inherit NO INHERIT d18_no_inherit_parent;

-- 6. THE `LIKE` COPY — the falsifier's original negative control, kept so the fixture pins both
--    ends of the discriminator. PostgreSQL's `LIKE` copies columns and creates NO inheritance
--    relation, so an `extends` edge for it would be a fabricated edge too.
CREATE TABLE d18_like_source (id int);
CREATE TABLE d18_like_target (LIKE d18_like_source INCLUDING ALL);

-- 7. THE `INHERITS` CLAUSE ON `CREATE TABLE` — the form the grammar CANNOT represent at all. It
--    error-recovers to a TOP-LEVEL `(ERROR)` whose only children are `"INHERITS" "(" ")"`; the
--    parent identifier does not survive, so no name can be recovered from the tree. This statement
--    is here as a PIN ON THE LIMIT, not as a pin on an edge: the fixture asserts that no `extends`
--    edge names d18_inherits_parent, because the name is not in the tree.
CREATE TABLE d18_inherits_parent (id int);
CREATE TABLE d18_inherits_child (id int) INHERITS (d18_inherits_parent);
