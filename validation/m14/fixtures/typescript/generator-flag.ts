class Gen {
  *numbers(): Generator<number> {
    yield 1;
  }
  plain(): number {
    return 1;
  }
}
