WITH recent_users AS (
  SELECT id, email FROM app.users WHERE active = TRUE
), named_users AS (
  SELECT u.id, u.email FROM recent_users u
)
SELECT id,
       CASE WHEN email IS NULL THEN 'missing' ELSE email END AS label
FROM named_users
UNION ALL
SELECT id, email FROM app.users
WHERE id IN (SELECT user_id FROM app.audit_log)
ORDER BY id;

SELECT u.id, lookup_user(u.id) AS email
FROM app.users u
LEFT JOIN app.teams t ON t.id = u.team_id
WHERE EXISTS (SELECT 1 FROM app.audit_log a WHERE a.user_id = u.id);
