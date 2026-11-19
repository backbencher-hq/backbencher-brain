try:
    import first_module as shared
except ImportError:
    import second_module as shared

shared.run()
