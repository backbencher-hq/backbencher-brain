class Registry {
  static {
    initRegistry();
    Registry.seed();
  }
  static field = buildField();
  instance() {
    helper();
  }
}