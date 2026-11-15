import { Client } from 'pg'
const client = new Client()
export function f33_0(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 0 + ' WHERE name = ' + q)
}
export function f33_1(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 1 + ' WHERE name = ' + q)
}
export function f33_2(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 2 + ' WHERE name = ' + q)
}
export function f33_3(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 3 + ' WHERE name = ' + q)
}
export function f33_4(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 4 + ' WHERE name = ' + q)
}
export function f33_5(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 5 + ' WHERE name = ' + q)
}
export function f33_6(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 6 + ' WHERE name = ' + q)
}
export function f33_7(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 7 + ' WHERE name = ' + q)
}
export function f33_8(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 8 + ' WHERE name = ' + q)
}
export function f33_9(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 9 + ' WHERE name = ' + q)
}