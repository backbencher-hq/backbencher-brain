function h(user: any) {
    service.save(user)
    return db.list(user).map(u => u.id)
}
