class Handler {
  value = 0;
  inc() {
    this.value++;
  }
  read() {
    const v = this.value;
    return v;
  }
  write() {
    this.value = 2;
  }
}
