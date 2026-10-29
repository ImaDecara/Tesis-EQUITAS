from typing import Any

import pytest
from fastapi.testclient import TestClient

from api import main


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


def test_health_and_group_definitions_are_available(client: TestClient) -> None:
    health_response = client.get("/health")
    definitions_response = client.get("/case-groups/definitions")

    assert health_response.status_code == 200
    assert health_response.json() == {"status": "ok"}
    assert definitions_response.status_code == 200
    assert "MEJORAR_DATOS" in definitions_response.json()["groups"]


def test_case_group_endpoints_forward_filters_to_service(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    received: dict[str, Any] = {}

    def fake_groups(**kwargs: Any) -> dict[str, Any]:
        received.update(kwargs)
        return {"total": 1, "items": [{"debtor_id": 1}]}

    monkeypatch.setattr(main, "get_case_groups", fake_groups)
    monkeypatch.setattr(
        main, "get_case_groups_summary", lambda **_kwargs: {"total_cases": 1}
    )

    groups_response = client.get(
        "/case-groups",
        params={
            "as_of": "2026-09-30",
            "group_key": "MEJORAR_DATOS",
            "severity_band": "ALTA",
            "tag": "SIN_CONTACTO_ACTIVO",
            "search": "agua",
            "limit": 10,
            "offset": 2,
        },
    )
    summary_response = client.get(
        "/case-groups/summary", params={"as_of": "2026-09-30"}
    )

    assert groups_response.status_code == 200
    assert groups_response.json()["items"] == [{"debtor_id": 1}]
    assert received == {
        "as_of": "2026-09-30",
        "group_key": "MEJORAR_DATOS",
        "severity_band": "ALTA",
        "tag": "SIN_CONTACTO_ACTIVO",
        "search": "agua",
        "limit": 10,
        "offset": 2,
    }
    assert summary_response.json() == {"total_cases": 1}


@pytest.mark.parametrize("query", [{"limit": 0}, {"limit": 501}, {"offset": -1}])
def test_case_groups_validates_pagination_query_parameters(
    client: TestClient,
    query: dict[str, int],
) -> None:
    response = client.get("/case-groups", params={"as_of": "2026-09-30", **query})

    assert response.status_code == 422


@pytest.mark.parametrize("path", ["/case-groups", "/case-groups/summary"])
@pytest.mark.parametrize(
    "params",
    [
        {},
        {"as_of": "2026-02-30"},
        {"as_of": "today"},
        {"as_of": "2026-09-30T00:00:00Z"},
    ],
)
def test_scoring_routes_require_declared_valid_cutoff(client, path, params):
    assert client.get(path, params=params).status_code == 422


@pytest.mark.parametrize("path", ["/case-groups", "/case-groups/summary"])
def test_incomplete_read_returns_503_without_partial_results_or_remote_payload(
    client, monkeypatch, path
):
    from services.paginated_reader import DataReadError

    def failed(**_kwargs):
        raise DataReadError("debt")

    monkeypatch.setattr(main, "get_case_groups", failed)
    monkeypatch.setattr(main, "get_case_groups_summary", failed)
    response = client.get(path, params={"as_of": "2026-09-30"})
    assert response.status_code == 503
    assert response.json() == {"detail": "READ_INCOMPLETE", "table": "debt"}
