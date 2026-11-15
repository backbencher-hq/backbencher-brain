class Store {
  private int count = 0;

  int bare() {
    return count;
  }

  int dotted() {
    return this.count;
  }

  int shadowed() {
    int count = 5;
    return count;
  }
}
