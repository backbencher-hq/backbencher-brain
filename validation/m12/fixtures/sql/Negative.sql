-- Anonymous statements are query facts, not declarations.
SELECT COUNT(*) AS total,
       COALESCE(MAX(id), 0) AS latest
FROM app.users
WHERE active = TRUE;

UPDATE app.users
SET email = LOWER(email)
WHERE id = 10;

SELECT u.email
FROM app.users u
WHERE u.id IN (SELECT id FROM app.teams);
