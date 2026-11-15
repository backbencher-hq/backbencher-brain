export function handle(input: string): unknown {
  const sql = 'SELECT * FROM t WHERE name = ' + input
  return db.query(sql)
}
