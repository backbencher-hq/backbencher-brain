CREATE TABLE users (
    id INT PRIMARY KEY,
    email VARCHAR(255),
    created_at TIMESTAMP
);

CREATE TABLE orders (
    id INT PRIMARY KEY,
    user_id INT,
    total DECIMAL,
    status VARCHAR(20)
);

CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);

CREATE TABLE order_items (
    id INT PRIMARY KEY,
    order_id INT,
    product VARCHAR(100),
    quantity INT
);

SELECT u.email, COUNT(o.id) AS order_count
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.email
HAVING COUNT(o.id) > 0
ORDER BY order_count DESC;

SELECT o.id, o.total, u.email
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.status = 'active';

INSERT INTO users (id, email) VALUES (1, 'a@b.com');
UPDATE users SET email = 'c@d.com' WHERE id = 1;
DELETE FROM orders WHERE status = 'cancelled';
