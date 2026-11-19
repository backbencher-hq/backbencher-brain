import argparse
import urllib.request
import legacy


class ArgumentParser(argparse.ArgumentParser):
    pass


class HTTPRedirectHandler(urllib.request.HTTPRedirectHandler):
    pass


class _Profile(legacy._Profile):
    pass


class Rebind(Rebind):
    pass
