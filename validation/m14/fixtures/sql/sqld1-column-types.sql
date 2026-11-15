-- SQLD1 — column type resolution, both of the grammar's own fields.
--
-- `column_definition` carries `type` for a builtin and `custom_type` for a
-- user-defined name, and `childForFieldName("type")` returns only the FIRST
-- child holding `type` — which for `c int[]` is the `int`, because the grammar
-- labels `array_size_definition` with `type` too. So the array marker was
-- dropped (`int[]` -> `int`).
--
-- The second half is the defect this fixture exists to pin: a user-defined
-- column type is NOT a foreign key. `b my_schema.my_type` put the type's
-- object_reference through the same path as `a int REFERENCES o (x)` and
-- produced `references t -> my_type` plus the "Foreign Key Constraints"
-- pattern — a fabricated FK for every custom-typed column in a real schema.
CREATE TABLE d1_columns (
  a integer,
  b my_schema.my_type,
  c int[],
  d numeric(10,2),
  e character varying(20),
  f timestamp with time zone,
  g double precision,
  h int PRIMARY KEY,
  i text UNIQUE,
  j int REFERENCES o (x)
);
