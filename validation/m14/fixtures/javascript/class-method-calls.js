class Widget {
  constructor(name) {
    this.name = name;
  }
  render(input) {
    return this.transform(input);
  }
  transform(x) {
    return x.toUpperCase();
  }
}
