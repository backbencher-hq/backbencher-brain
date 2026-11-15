class Cache {
  constructor() {
    this.data = {};
  }
  get(key) {
    return this.data[key] ?? 0;
  }
  map(fn) {
    return Object.values(this.data).map(fn);
  }
  renderAll() {
    return this.map((n) => this.get(String(n)));
  }
}
