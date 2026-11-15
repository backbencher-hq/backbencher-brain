-- SQLD12 — a reference that points OUTSIDE the project must SAY so.
--
-- Every PostgreSQL migration reads things the project never declares: the
-- implicit `public` schema, `information_schema` views, `pg_*` catalogs, and on
-- a hosted platform the platform's own objects. Those are real references, so
-- the edge is kept — but an edge whose target resolves to nothing is exactly
-- what makes a consumer, including an AI agent reading this graph, conclude
-- that the project declares it and the analyzer missed it. That is the wrong
-- conclusion and it is the one that invites a hallucination.
--
-- MEASURED, on ProxiCall @e36979cb6 over 12,454 edges: 12,306 (98.81%) resolve
-- to a declared symbol, 86 (0.69%) are labelled external, and 62 (0.50%) are an
-- unlabelled gap. Before the labels existed, all 148 non-resolving edges looked
-- identical, and the measured 0.67% "unknown" figure in the lane's own record
-- was reporting a classification the code did not perform.
--
-- Four buckets, because they are four different claims and a consumer treats
-- them differently: a `pg_*` relation the migration genuinely reads; an
-- `information_schema` view; the `public` schema, which PostgreSQL creates in
-- every database and no migration ever declares; and a hosted-platform object.

-- 1. The implicit schema. GRANT … ON SCHEMA public references a schema that
--    exists in every database without being declared anywhere.
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_user;

-- 2. A pg_* catalog read — a real table the migration inspects, from INSIDE a
--    plpgsql body, which is where an extension script keeps it. This shape only
--    became reachable when the body learned to hold embedded SQL: before that it
--    produced no edge at all, because a plpgsql body could contain procedural
--    forms and nothing else.
CREATE INDEX idx_orders_pkey ON orders (id);
DO $$
BEGIN
  SELECT 1 FROM pg_policies WHERE tablename = 'orders';
END;
$$;

--    KNOWN GAP, recorded rather than hidden: `PERFORM 1 FROM pg_policies` — the
--    same read written the way plpgsql spells it — still does NOT parse, because
--    PERFORM takes a full query and the shipped rule accepts only an expression.
--    `PERFORM my_func(1)` parses; `PERFORM 1 FROM t` does not. Fixing it needs a
--    select-without-keyword rule, which is a real grammar change and is filed
--    rather than smuggled in here.

-- 3. An information_schema view.
CREATE VIEW order_counts AS
  SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

-- 4. A hosted-platform object, referenced by its BARE tail. The edge target is
--    `decrypted_secrets` while the source says `vault.decrypted_secrets`, so a
--    classifier that reads only the edge target cannot see it is a platform
--    object — which is why the qualified name in the metadata is consulted too.
CREATE FUNCTION account_number(p_id int) RETURNS text
LANGUAGE sql AS $$ SELECT vault.decrypted_secrets.get(p_id, 'account') $$;

-- 5. A project declaration and a project reference, which must NOT be labelled
--    external — the classification is not a blanket excuse.
CREATE TABLE app_orders (id int PRIMARY KEY, ref int REFERENCES app_orders (id));
CREATE INDEX idx_app_orders_ref ON app_orders (ref);

-- 6. THE `pg_` BOUNDARY, on both sides. `isPostgresCatalogName` replaced the
--    lane's last regular expression (`/^pg_[a-z_]+$/`) at pass 8, and a
--    substitution that is "close enough" would silently WIDEN the classifier:
--    reading `[a-z_]+` as a prefix test would label `pg_1` a catalog, and
--    dropping the `+` would label a bare `pg_` one. Both are wrong, both are
--    invisible in the edges, and both are exactly what a fixture is for. So
--    every row below pins one side of the boundary, and `pg_catalog.pg_class`
--    pins the positive case the classifier exists for.
CREATE VIEW v_pg_digit      AS SELECT a FROM pg_1;        -- digit after pg_  -> NOT a catalog
CREATE VIEW v_pg_mixed      AS SELECT a FROM pg_a1;       -- digit later      -> NOT a catalog
CREATE VIEW v_pg_nounder    AS SELECT a FROM pga;         -- no underscore    -> NOT a catalog
CREATE VIEW v_pg_noletter   AS SELECT a FROM pgx;         -- no underscore    -> NOT a catalog
CREATE VIEW v_pg_qualified  AS SELECT a FROM pg_catalog.pg_class; -- -> postgresCatalog
