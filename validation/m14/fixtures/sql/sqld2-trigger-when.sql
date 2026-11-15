-- SQLD2 — a trigger's action routine must not be read out of its WHEN clause.
--
-- `create_trigger`'s three `object_reference`s are SIBLINGS at the top level, but
-- the analyzer read the first three anywhere in the subtree. A WHEN clause
-- contributes two more, because `old` and `new` are `object_reference`s in this
-- grammar:
--   CREATE TRIGGER tg BEFORE UPDATE ON s.t FOR EACH ROW
--   WHEN (old.a <> new.a) EXECUTE FUNCTION audit_it();
-- reached `old` as the action and emitted `calls tg -> old` — a call edge into a
-- PL/pgSQL pseudo-variable — instead of `calls tg -> audit_it`.
--
-- The three triggers below are the timing/event shapes that each move a
-- reference, so a fix that only handles the plain case is caught here.
CREATE TRIGGER d2_when
  BEFORE UPDATE ON s.t
  FOR EACH ROW
  WHEN (old.a <> new.a)
  EXECUTE FUNCTION audit_it();

CREATE TRIGGER d2_update_of
  AFTER UPDATE OF a, b ON s.t
  FOR EACH ROW
  EXECUTE PROCEDURE audit_it(1);

CREATE TRIGGER d2_multi_event
  AFTER INSERT OR UPDATE OR DELETE ON t
  FOR EACH ROW
  EXECUTE FUNCTION f();
