-- M60 SQL ground-truth extension. Everything here is a shape the review measured as
-- broken and the wave fixed; the ground truth is hand-audited against the SOURCE,
-- not read back from the analyzer.

-- Quoted and delimited identifiers. The quotes are SQL syntax, not part of the name.
CREATE TABLE "app"."customers" (
  "CustomerId" int PRIMARY KEY,
  `email` text UNIQUE,
  "total" numeric(12,2) DEFAULT 0
);
CREATE INDEX idx_customers_email ON "app"."customers" ("CustomerId");

-- A user-defined column type. This is NOT a foreign key: the type's
-- object_reference must not be read as a REFERENCES target.
CREATE TABLE app.orders (
  id int PRIMARY KEY,
  customer_id int REFERENCES "app"."customers" ("CustomerId"),
  status app.order_status,
  labels text[],
  ship_to app.address
);

-- A named key constraint — the shape that used to lose its name entirely.
CREATE TABLE app.order_items (
  id int PRIMARY KEY,
  order_id int,
  sku text,
  CONSTRAINT oi_order_fk FOREIGN KEY (order_id) REFERENCES app.orders (id),
  CONSTRAINT oi_sku_unq UNIQUE (sku),
  CONSTRAINT oi_qty_ck CHECK (id > 0)
);

CREATE TYPE app.order_status AS ENUM ('new', 'paid', 'shipped');
CREATE TYPE app.address AS (line1 text, city text);

-- Privileges. The grantee is a ROLE and must never be reported as a table;
-- the object the privilege applies to is a real schema entity and is edged.
GRANT SELECT, INSERT ON app.orders TO order_reader;
REVOKE DELETE ON app.orders FROM order_reader;

CREATE SCHEMA reporting;
CREATE SEQUENCE report_seq;
CREATE DATABASE analytics;
