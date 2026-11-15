"""PY-D18 (round 10) — `global X` plus a creating write binds X in the MODULE namespace.

The module-level names this file declares are also the dedupe's input: `BOUND` is bound at module
level and `os` is bound by an import, so neither may be published twice.
"""

import os


def make_runner():
    return 1


def init():
    global RUN
    RUN = make_runner()


def netter():
    global BOUND
    BOUND = 2


BOUND = 1


def rebinds_an_import():
    global os
    os = object()


def annotated_only():
    global ANNOT_ONLY
    ANNOT_ONLY: int


def bumped():
    global COUNTER
    COUNTER += 1


def deleted():
    global GONE
    del GONE


def outer_declares_but_nested_writes():
    global NOT_A_PAIR

    def inner_unrelated():
        NOT_A_PAIR = 3


def nested_owner():
    global P
    P = 1

    def inner():
        global INNER_ONLY
        INNER_ONLY = 2


RUN()


class Uses:
    field: RUN
