import { Client } from 'pg'
const client = new Client()
export function f30_0(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 0 + ' WHERE name = ' + q)
}
export function f30_1(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 1 + ' WHERE name = ' + q)
}
export function f30_2(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 2 + ' WHERE name = ' + q)
}
export function f30_3(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 3 + ' WHERE name = ' + q)
}
export function f30_4(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 4 + ' WHERE name = ' + q)
}
export function f30_5(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 5 + ' WHERE name = ' + q)
}
export function f30_6(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 6 + ' WHERE name = ' + q)
}
export function f30_7(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 7 + ' WHERE name = ' + q)
}
export function f30_8(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 8 + ' WHERE name = ' + q)
}
export function f30_9(req: any): unknown {
  const q = req.query.q
  return client.query('SELECT * FROM t' + 9 + ' WHERE name = ' + q)
}