-- SQLD10 — a qualified reference's TABLE, a multi-column ALTER, and a nested
-- declaration.
--
-- Three distinct losses, all measured on /home/ishaq2321/ProxiCall @1f3e3567 and
-- all in the same family: the analyzer read a thing that was not the thing the
-- source named.
--
-- 1. COMMENT ON COLUMN. The grammar puts a qualified COLUMN reference's table in
--    a NESTED object_reference:
--      object_reference "business_inventory_items.calories"
--        object_reference "business_inventory_items"
--        identifier "calories"
--    A flat identifier walk therefore saw only `calories`, and the comment
--    published a dependency on a COLUMN. Correct is the second-to-last segment
--    (the table); taking the first instead would edge the SCHEMA, which is the
--    same error in the other direction and is what the first fix attempt did.
--
-- 2. MULTI-COLUMN ALTER. The grammar gives each added column its own add_column
--    SIBLING rather than one comma list, so reading the first descendant published
--    one of a migration's five columns and dropped the other four.
--
-- 3. A DECLARATION NESTED IN A DECLARATION. Where error recovery buries a
--    statement inside an unrelated one — a function body the grammar could not
--    finish — the later CREATE TABLEs become children of that function. The
--    declaration sweep has to descend THROUGH a declaration to reach them, or
--    every table after the damage is invisible. Measured on database/schema.sql
--    (163 CREATE TABLE): 1,980 symbols before, 3,557 after, and the corpus's
--    most-referenced tables — business_profiles, business_content,
--    business_locations — appeared.
CREATE TABLE app.inventory_items (id int PRIMARY KEY, total numeric(12,2));

COMMENT ON COLUMN app.inventory_items.total IS 'order total';
COMMENT ON COLUMN inventory_items.qty IS 'quantity';
COMMENT ON TABLE app.inventory_items IS 'the items table';

ALTER TABLE app.inventory_items
  ADD COLUMN IF NOT EXISTS calories INTEGER,
  ADD COLUMN IF NOT EXISTS protein_g NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS carbs_g   NUMERIC(6,2);

CREATE FUNCTION app.damaged() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'd10: not SQL the grammar knows';
END;
$$;

CREATE TABLE app.after_damage (id int PRIMARY KEY);
