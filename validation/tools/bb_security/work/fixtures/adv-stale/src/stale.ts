import { Client } from 'pg'
const client = new Client()
export function search(req: any): unknown {
  const q = req.query.q
  return client.query("SELECT * FROM t WHERE name = '" + q + "'")
}
// touched after indexing
