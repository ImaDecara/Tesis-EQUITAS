from typing import Any

from fastapi.testclient import TestClient
import pytest

from api import main


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


def test_health_and_group_definitions_are_available(client: TestClient) -> None:
    health_response = client.get('/health')
    definitions_response = client.get('/case-groups/definitions')

    assert health_response.status_code == 200
    assert health_response.json() == {'status': 'ok'}
    assert definitions_response.status_code == 200
    assert 'critical_no_contact' in definitions_response.json()['groups']


def test_case_group_endpoints_forward_filters_to_service(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    received: dict[str, Any] = {}

    def fake_groups(**kwargs: Any) -> dict[str, Any]:
        received.update(kwargs)
        return {'total': 1, 'items': [{'debtor_id': 1}]}

    monkeypatch.setattr(main, 'get_case_groups', fake_groups)
    monkeypatch.setattr(main, 'get_case_groups_summary', lambda: {'total_cases': 1})

    groups_response = client.get(
        '/case-groups',
        params={
            'group_key': 'critical_no_contact',
            'risk_band': 'critical',
            'tag': 'no_contact',
            'search': 'agua',
            'limit': 10,
            'offset': 2,
        },
    )
    summary_response = client.get('/case-groups/summary')

    assert groups_response.status_code == 200
    assert groups_response.json()['items'] == [{'debtor_id': 1}]
    assert received == {
        'group_key': 'critical_no_contact',
        'risk_band': 'critical',
        'tag': 'no_contact',
        'search': 'agua',
        'limit': 10,
        'offset': 2,
    }
    assert summary_response.json() == {'total_cases': 1}


@pytest.mark.parametrize('query', [{'limit': 0}, {'limit': 501}, {'offset': -1}])
def test_case_groups_validates_pagination_query_parameters(
    client: TestClient,
    query: dict[str, int],
) -> None:
    response = client.get('/case-groups', params=query)

    assert response.status_code == 422
