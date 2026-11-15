/**
 * Handles a request end to end.
 * Also mentions serialize helpers for docstring probing.
 */
export function handleRequest(): string {
  return "ok"
}

export function handleResponse(): string {
  return "ok"
}

export function duplicateName(): number {
  return 1
}

export class RequestHandler {
  run(): void {}
}

export function bodyOnlyHost(): number {
  const bodyOnlyNeedle = 42
  return bodyOnlyNeedle
}

export const get_user = 1
export const getXuser = 2

export function UNICODE_ΣΊΣΥΦΟΣ(): string {
  return "greek"
}
