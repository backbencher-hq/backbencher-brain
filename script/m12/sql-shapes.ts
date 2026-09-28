import { readFileSync } from "node:fs"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm"

const W: any = await loadWebTreeSitter()
const ParserCtor = W.Parser ?? W.default ?? W
const LanguageCtor = W.Language ?? W.default?.Language
const init = W.init ?? ParserCtor.init
if (init) await init({ locateFile: () => resolveWasmAsset("tree-sitter.wasm") })
const wasmPath = process.argv[2]?.endsWith(".wasm") ? process.argv[2] : resolveWasmAsset("tree-sitter-sql.wasm")
const grammar = await LanguageCtor.load(new Uint8Array(readFileSync(wasmPath)))
const parser = new ParserCtor()
parser.setLanguage(grammar)

const sourcePath = process.argv[3]
const source = sourcePath
  ? readFileSync(sourcePath, "utf8")
  : `
-- imports and schema
CREATE SCHEMA app;
CREATE TABLE app.users (
  id INTEGER PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  team_id INTEGER REFERENCES teams(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_team_fk FOREIGN KEY (team_id) REFERENCES teams(id)
);
CREATE UNIQUE INDEX users_email_idx ON app.users (email);
CREATE VIEW active_users AS SELECT u.id, u.email FROM app.users u WHERE u.id > 0;
CREATE FUNCTION greet(who TEXT, count INTEGER DEFAULT 1) RETURNS TEXT AS $$ SELECT who; $$ LANGUAGE SQL;
CREATE TRIGGER users_audit AFTER INSERT ON app.users FOR EACH ROW EXECUTE FUNCTION audit_users();
WITH recent AS (SELECT id FROM app.users) SELECT * FROM recent;
INSERT INTO app.users (id, email) VALUES (1, 'x');
UPDATE app.users SET email = 'y' WHERE id = 1;
DELETE FROM app.users WHERE id = 2;
GRANT SELECT ON app.users TO analyst;
BEGIN; COMMIT;
`
const tree = parser.parse(source)
const counts = new Map<string, number>()
function walk(n: any, depth = 0): void {
  counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
  if (depth <= 5) {
    const text = n.text.replaceAll("\n", " ").slice(0, 100)
    console.log(`${"  ".repeat(depth)}${n.type} [${n.startPosition.row + 1}:${n.startPosition.column}-${n.endPosition.row + 1}:${n.endPosition.column}] ${JSON.stringify(text)}`)
  }
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) walk(c, depth + 1)
  }
}
walk(tree.rootNode)
console.log("--- node types ---")
for (const [type, count] of [...counts.entries()].sort()) console.log(`${type}\t${count}`)
console.log(`hasError=${tree.rootNode.hasError}`)
parser.delete?.()
