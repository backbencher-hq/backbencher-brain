from flask import request
def isolated():
    q = request.args.get('q')
    return q