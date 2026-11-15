fun h(user: Any) {
    service.save(user)
    db.list(user).map { it.id }
}
