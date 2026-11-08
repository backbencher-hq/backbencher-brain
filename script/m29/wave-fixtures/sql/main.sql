-- Wave fixture pack — sql lane (M29 wave 3).
-- A schema whose foreign key is SQL's own reference form.

CREATE SCHEMA wave;

CREATE TABLE wave.users (
  id BIGINT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT
);

CREATE TABLE wave.orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES wave.users(id),
  total_cents INTEGER NOT NULL,
  placed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX orders_by_user ON wave.orders (user_id);

CREATE VIEW wave.order_totals AS
  SELECT user_id, COUNT(*) AS order_count, SUM(total_cents) AS revenue
  FROM wave.orders
  GROUP BY user_id;
