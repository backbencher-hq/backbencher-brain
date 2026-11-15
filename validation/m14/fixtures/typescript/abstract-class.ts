abstract class Shape2 {
  abstract area(): number;
  describe(): string {
    return `area ${this.area()}`;
  }
}

class Square extends Shape2 {
  constructor(public side: number) {
    super();
  }
  area(): number {
    return this.side * this.side;
  }
}
