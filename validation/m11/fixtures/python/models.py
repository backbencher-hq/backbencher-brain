from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Generic, TypeVar, Optional, List

T = TypeVar("T")

class Role(Enum):
    ADMIN = "admin"
    USER = "user"

class Repository(ABC, Generic[T]):
    @abstractmethod
    async def save(self, value: T) -> T:
        pass

@dataclass(frozen=True)
class User:
    id: str
    name: str
    role: Role = Role.USER

def format_name(name: str) -> str:
    return name.strip().title()
