class WriteGate {
  int[] xs

  void store(int i, int v) {
    xs[0] = 5
    xs[i] = v
    xs[1] += 2
  }

  int load(int i) {
    xs[i]
  }
}
