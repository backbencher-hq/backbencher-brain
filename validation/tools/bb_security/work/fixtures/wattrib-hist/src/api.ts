import { Client } from 'pg'
const client = new Client()
export function search(userInput: string): unknown {
  const sql = 'SELECT * FROM items WHERE name = ' + userInput
  return client.query(sql)
}
export function safe(userInput: string): unknown {
  return client.query('SELECT * FROM items WHERE name = $1', [userInput])
}