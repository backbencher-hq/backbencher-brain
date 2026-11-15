class Cache {
  private data: Record<string, number> = {};
  get(key: string): number {
    return this.data[key] ?? 0;
  }
  map(fn: (n: number) => number): number[] {
    return Object.values(this.data).map(fn);
  }
  render(): number[] {
    return this.map((n) => this.get(String(n)));
  }
}
