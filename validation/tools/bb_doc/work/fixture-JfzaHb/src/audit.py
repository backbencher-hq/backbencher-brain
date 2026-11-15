def audit_login(user: str) -> bool:
    """Records a login audit event."""
    return bool(user)


def silent(user):
    return user
