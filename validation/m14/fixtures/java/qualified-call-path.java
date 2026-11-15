public class H {
    public void h(Object user) {
        service.save(user);
        db.list(user).map(u -> u.getId());
    }
}
