_LOCALHOST = {'127.0.0.1', '::1', 'localhost'}


def _is_localhost(host: str | None) -> bool:
    return (host or '') in _LOCALHOST