from collections.abc import Callable

import httpx
import pytest

from ETL import load


@pytest.mark.parametrize(
    'transient_error',
    [
        httpx.RemoteProtocolError('connection terminated'),
        httpx.ReadTimeout('read timeout'),
        httpx.ConnectTimeout('connect timeout'),
        httpx.ConnectError('connect error'),
    ],
)
def test_loader_retries_each_transient_supabase_error(
    transient_error: httpx.HTTPError,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = 0
    delays: list[int] = []

    def operation() -> str:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise transient_error
        return 'ok'

    monkeypatch.setattr(load.time, 'sleep', delays.append)

    result = load.execute_supabase_operation('consulta de prueba', operation)

    assert result == 'ok'
    assert attempts == 2
    assert delays == [1]


def test_loader_propagates_a_transient_error_after_the_last_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = 0

    def operation() -> None:
        nonlocal attempts
        attempts += 1
        raise httpx.ConnectError('connection unavailable')

    monkeypatch.setattr(load.time, 'sleep', lambda _: None)

    with pytest.raises(httpx.ConnectError, match='connection unavailable'):
        load.execute_supabase_operation('consulta de prueba', operation)

    assert attempts == load.MAX_SUPABASE_ATTEMPTS
