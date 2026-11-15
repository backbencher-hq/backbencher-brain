def h(user) {
    service.save(user)
    db.list(user).map { it.id }
}
