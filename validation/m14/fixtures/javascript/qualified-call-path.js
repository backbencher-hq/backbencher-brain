function h(user) {
    service.save(user)
    return db.list(user).map(u => u.id)
}
