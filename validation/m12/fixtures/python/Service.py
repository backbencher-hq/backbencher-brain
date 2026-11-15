from typing import Optional, List as L
from enum import Enum
import os
import asyncio

__all__ = ["UserService", "create_default", "Role", "format_name"]


def logged(fn):
    def wrapper(*args, **kwargs):
        return fn(*args, **kwargs)

    return wrapper


class Role(Enum):
    ADMIN = "admin"
    USER = "user"


class Repository:
    def __init__(self, store):
        self.store = store


class User:
    id: str
    name: str
    role: Role = Role.USER


class BaseService:
    prefix = "base"

    def __init__(self, store):
        self.store = store

    def format(self, value: str) -> str:
        return self.prefix + value


class UserService(BaseService, Repository):
    _pattern = r"^user:"

    def __init__(self, store):
        super().__init__(store)
        self.cache = {}

    @logged
    async def save(self, value: User) -> User:
        self.store[value.id] = value
        await self.flush(value)
        return value

    async def flush(self, value: User) -> None:
        await asyncio.sleep(0)

    def matches(self, name: str) -> bool:
        return bool(__import__("re").match(self._pattern, name))

    @staticmethod
    def create(name: str) -> "UserService":
        return UserService({})

    def __str__(self) -> str:
        return "UserService"


def format_name(name: str) -> str:
    return name.strip().title()


def count_down(n: int) -> int:
    if n <= 0:
        return 0
    return count_down(n - 1)


def mutual_a(n: int) -> int:
    return mutual_b(n - 1)


def mutual_b(n: int) -> int:
    return mutual_a(n - 1)


def describe(user: User) -> str:
    return format_name(user.name)


def make_user(name: str) -> User:
    return User(id="1", name=name)


def gen(n: int):
    for i in range(n):
        yield i


async def create_default() -> UserService:
    store = {}
    service = UserService(store)
    await service.save(User(id="1", name="Ada"))
    return service
