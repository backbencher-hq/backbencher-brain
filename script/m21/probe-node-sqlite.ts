import Database from "better-sqlite3"

const db = new Database(":memory:")
db.pragma("journal_mode = WAL")
const journal = String(db.pragma("journal_mode", { simple: true }))
db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
db.prepare("INSERT INTO t(value) VALUES (?)").run("node")
const count = Number((db.prepare("SELECT COUNT(*) AS c FROM t").get() as { c: number }).c)
db.close()
if (journal.toLowerCase() !== "memory" || count !== 1) process.exit(2)
console.log(JSON.stringify({ journal, count }))
