CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    total DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_total ON orders (total);
