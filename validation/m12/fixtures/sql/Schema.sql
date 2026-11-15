CREATE SCHEMA app;

CREATE TABLE app.teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE app.users (
  id INTEGER PRIMARY KEY,
  team_id INTEGER REFERENCES app.teams(id),
  email TEXT NOT NULL UNIQUE,
  active BOOLEAN DEFAULT TRUE
);

CREATE INDEX users_team_idx ON app.users (team_id);

CREATE VIEW active_users AS
  SELECT u.id, u.email, t.name AS team_name
  FROM app.users u
  JOIN app.teams t ON t.id = u.team_id
  WHERE u.active = TRUE;

CREATE FUNCTION lookup_user(user_id INTEGER) RETURNS TEXT
AS $$ SELECT email FROM app.users WHERE id = user_id; $$
LANGUAGE SQL;

CREATE TRIGGER users_audit
AFTER INSERT ON app.users
FOR EACH ROW EXECUTE FUNCTION audit_users();

INSERT INTO app.users (id, team_id, email) VALUES (1, 1, 'user@example.com');
UPDATE app.users SET active = FALSE WHERE id = 1;
DELETE FROM app.users WHERE id = 2;
