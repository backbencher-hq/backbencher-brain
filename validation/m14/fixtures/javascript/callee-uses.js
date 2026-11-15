function handler() {
  const result = svc.fetch();
  const val = this.value;
  this.value = 2;
  return result + val;
}