export function a(n: number): number {
  return b(n) + 1;
}

export function b(n: number): number {
  return a(n - 1) + 1;
}
