import { Client } from 'pg'
const client = new Client()
export function safe(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t WHERE name = $1', [q])
}