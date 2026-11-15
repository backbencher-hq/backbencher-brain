import os
import asyncio
from typing import Optional
from .models import User, Role, Repository, format_name as fmt

def logged(fn):
    async def wrapper(*args, **kwargs):
        print(f"call {fn.__name__}")
        return await fn(*args, **kwargs)
    return wrapper

class BaseService:
    prefix = "base"

    def __init__(self, store):
        self.store = store

class UserService(BaseService, Repository[User]):
    _pattern = r"^user:"

    def __init__(self, store):
        super().__init__(store)

    @logged
    async def save(self, value: User) -> User:
        self.store[value.id] = value
        return value

    def matches(self, name: str) -> bool:
        return bool(__import__('re').match(self._pattern, name))

async def create_default() -> UserService:
    store = {}
    service = UserService(store)
    await service.save(User(id="1", name="Ada"))
    return service

def _comprehension_helper(items):
    return [i.upper() for i in items if i]
