import { Client } from 'pg'
const client = new Client()
export function search(userInput: string): unknown {
  const sql = 'SELECT * FROM items WHERE name = ' + userInput
  return client.query(sql)
}
export function touched(req: any): unknown {
  const q = req.query.q
  return client.query(q)
}
export function pure(a: number): number { return a + 1 }