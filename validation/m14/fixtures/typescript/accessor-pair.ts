class Temperature {
  private _c: number = 0;
  get celsius(): number {
    return this._c;
  }
  set celsius(v: number) {
    this._c = v;
  }
}
