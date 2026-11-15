-- M60 SQL ground-truth extension: query shapes whose edges were previously lost.

-- A CTE shadows only its OWN unqualified name. The bare `recent` is the CTE and is
-- suppressed; `app.orders` and `archive.orders` are real tables and are edged.
WITH recent AS (
  SELECT id FROM app.orders
)
SELECT r.id, app.orders.total
FROM recent r
JOIN app.orders ON app.orders.id = r.id
JOIN archive.orders ON archive.orders.id = r.id;

-- MERGE and TRUNCATE. Both grammar rules are hidden, so the keywords inline into
-- `statement`; both tables are real dependencies and neither was emitted before.
MERGE INTO app.orders AS t
USING staging AS s
  ON t.id = s.id
WHEN MATCHED THEN UPDATE SET t.total = s.total;

TRUNCATE TABLE app.order_items;

-- Session and documentation statements. Both produced a pattern the grammar
-- supported and the analyzer never reached.
SET search_path TO app, public;
RESET ALL;
COMMENT ON TABLE app.orders IS 'the orders table';

-- A merge's UPDATE ... FROM and a delete's USING each touch two tables.
UPDATE app.orders SET total = staging.total
FROM staging WHERE staging.id = app.orders.id;

-- A call to a function the project defines is an edge; a call to a SQL builtin is
-- not, because the store cannot resolve it and a reader would not call it a
-- dependency.
SELECT app.compute_total(app.orders.id), COALESCE(NULLIF(app.orders.total, 0), 0)
FROM app.orders;

-- A trigger whose WHEN clause names OLD and NEW. Those are object_references in
-- this grammar, and reading the action routine positionally would resolve it to
-- `old` instead of `app.audit_order`.
CREATE TRIGGER trg_orders_audit
  AFTER UPDATE ON app.orders
  FOR EACH ROW
  WHEN (OLD.status <> NEW.status)
  EXECUTE FUNCTION app.audit_order();
