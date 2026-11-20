from enum import Enum


class TransactionState(Enum):
    MISSING = ("missing")
    REQUIRED = ("required")
    __visit_name__ = ("enum")
