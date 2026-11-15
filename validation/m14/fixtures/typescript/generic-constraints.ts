interface HasId {
  id: number;
}
class Store<T extends HasId> {
  items: T[] = [];
  put(item: T): void {
    this.items.push(item);
  }
}
