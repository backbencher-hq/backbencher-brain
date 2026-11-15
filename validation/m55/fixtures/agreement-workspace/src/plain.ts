export function target(): number {
  return 1;
}

export function caller(): number {
  return target();
}
