import sys

module_lambda = lambda: sys.exit(1)

def outer():
    return lambda: module_helper()

def module_helper():
    pass
