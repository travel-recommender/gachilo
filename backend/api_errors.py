class ApiError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def require(ok, message):
    if not ok:
        raise ApiError(400, message)
