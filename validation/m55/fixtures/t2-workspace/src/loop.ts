export function loop(n: number): number {
  if (n <= 0) return 0;
  return loop(n - 1) + 1;
}
