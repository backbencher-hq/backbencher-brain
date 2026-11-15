class Store[T](private val item: T) {
  protected def map[R](value: R): R = value
}
