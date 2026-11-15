export function leaf(depth: number): number { return depth <= 0 ? 0 : leaf(depth - 1) + 1 }
