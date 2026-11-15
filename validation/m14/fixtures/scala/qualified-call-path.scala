object H {
  def h(user: Any): Unit = {
    service.save(user)
    db.list(user).map(u => u.id)
  }

  def curried(): Unit = {
    val m = List.fill(2)("a")
    self.add(1)(2)
  }
}
