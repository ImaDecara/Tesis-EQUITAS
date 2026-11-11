"""Pruebas del circuito realmente ejecutado, no de etiquetas de las reglas."""
import json
from datetime import date, timedelta

import numpy as np
import pytest
from sklearn.metrics import adjusted_rand_score

from analytics import clustering as c
from analytics import supervised as s


def assert_same(actual, expected, where='resultado'):
    """Estructura, textos, enteros y booleanos idénticos; los decimales, con tolerancia.

    Los archivos versionados se generaron en una plataforma y el CI corre en otra: las sumas y
    productos de BLAS cambian el último dígito (se observó en la 16.ª cifra). Eso no es una
    diferencia del resultado. La tolerancia es mil millones de veces más fina que lo que se muestra.
    """
    if isinstance(expected, dict):
        assert isinstance(actual, dict) and actual.keys() == expected.keys(), where
        for key in expected:
            assert_same(actual[key], expected[key], f'{where}.{key}')
    elif isinstance(expected, list):
        assert isinstance(actual, list) and len(actual) == len(expected), where
        for index, item in enumerate(expected):
            assert_same(actual[index], item, f'{where}[{index}]')
    elif isinstance(expected, float) or isinstance(actual, float):
        assert not isinstance(actual, bool) and not isinstance(expected, bool), where
        assert actual == pytest.approx(expected, rel=1e-9, abs=1e-12), where
    else:
        assert type(actual) is type(expected) and actual == expected, where


def test_same_tolerates_only_the_last_digits():
    assert_same({'a': [1, 0.7438469715812953, 'x', True]}, {'a': [1, 0.743846971581294, 'x', True]})
    for actual, expected in [({'a': 0.7438}, {'a': 0.7439}), ({'a': 3}, {'a': 4}), ({'a': 'x'}, {'a': 'y'}),
                             ({'a': True}, {'a': 1}), ({'a': [1]}, {'a': [1, 2]}), ({'a': 1}, {'b': 1})]:
        with pytest.raises(AssertionError):
            assert_same(actual, expected)


def test_clustering_fixture_regenerates():
    stored = json.loads((c.ROOT / 'front/tests/fixtures/ml/parity.v1.json').read_text())
    assert_same(c.generate_fixture(), stored)
    assert adjusted_rand_score(stored['expected']['labels'], c.analyze(stored['rows'])['labels']) == 1


def test_numerical_steps():
    fitted = c.fit_preprocessing(np.array([[1, 2, 3], [1, 4, 3], [1, 10000, 3]]))
    assert fitted[0][1] == pytest.approx(9800.08)
    assert fitted[2][0] == 1
    assert c.transform(np.array([[1, 2, 3]]), fitted)[0][0] == 0
    assert c.sample_indices(1000, 384, c.SEED) == c.sample_indices(1000, 384, c.SEED)
    assert len(set(c.sample_indices(1000, 384, c.SEED))) == 384
    assert c.silhouette(np.array([[0], [1]]), np.array([0, 0])) is None
    assert c.silhouette(np.array([[0], [1]]), np.array([0, 1])) is None


@pytest.mark.parametrize(('rows', 'status'), [([], 'INSUFFICIENT_DATA'), ([[1, 1, 1]] * 30, 'DEGENERATE'),
                                                            ([[1, 1, 1]] * 39 + [[1000, 30, 5]], 'DEGENERATE')])
def test_degenerate(rows, status):
    assert c.analyze(rows)['status'] == status
    assert c.analyze(rows)['selectedK'] is None


def test_degenerate_resample_counts_as_instability():
    assert c.stability(np.ones((30, 3)), np.zeros(30), 2) == 0


def test_supervised_artifact_regenerates_and_is_reproducible():
    stored = json.loads((s.ROOT / 'front/lib/ml/artifacts/supervised-experiment.v1.json').read_text())
    result = s.experiment()
    repeated = s.experiment()
    for artifact in [stored, result, repeated]:
        del artifact['generatedAt']
        # La versión de parche del intérprete es dato del entorno de la corrida, no del resultado:
        # numpy, scipy y scikit-learn (fijadas) sí tienen que coincidir.
        del artifact['libraries']['python']
    # Dos corridas en la misma máquina son idénticas; contra el archivo versionado, con tolerancia.
    assert result == repeated
    assert_same(result, stored)
    assert result['controls'][0]['passed']
    assert not result['realHistory']['suitable']
    assert result['label'] == s.LABEL


def test_temporal_split_embargo_and_event_boundaries():
    observations = s.generate()
    train, embargo, test = s.split(observations)
    assert len(train) == 3600 and len(embargo) == 900 and len(test) == 1800
    assert max(o['label_available'] for o in train) < min(o['instant'] for o in test)
    assert all(o['instant'] < date(2025, 4, 1) <= o['label_available'] for o in embargo)
    assert all(o['snapshot_at'] < o['instant'] for o in observations)
    assert max(o['label_available'] for o in test) <= date(2025, 12, 10)
    assert not {o['unit'] for o in train} & {o['unit'] for o in test}
    item = observations[0]
    features = s.features_at(item)
    item['payments'].extend([item['instant'], item['instant'] + timedelta(days=1), item['instant'] + timedelta(days=91)])
    assert s.features_at(item) == features
    assert s.target_at(item) == 1
    item['payments'] = [item['instant'], item['instant'] + timedelta(days=91)]
    assert s.target_at(item) == 0


def test_preprocessing_fits_training_only():
    train, _, test = s.split(s.generate())
    x, y = s.arrays(train)
    tx, _ = s.arrays(test)
    model = s.pipeline().fit(x, y)
    scaler = model.named_steps['standardscaler']
    assert np.allclose(scaler.mean_, np.log1p(x).mean(axis=0))
    before = scaler.mean_.copy()
    model.predict_proba(tx * 1e9)
    assert np.array_equal(scaler.mean_, before)


def test_both_negative_controls_and_failed_control_remain_visible():
    result = s.experiment()
    assert {control['id'] for control in result['controls']} == {'NO_SIGNAL', 'SHUFFLED_LABELS'}
    assert all(control['passed'] for control in result['controls'])
    y = np.array([0, 1] * 100)
    assert not s.control_result('PROBE', 'Ensayo', 'Predicción perfecta', y, y)['passed']


def test_comparison_checks_candidates_labels_and_numeric_agreement():
    from analytics.compare import compare
    rows = c.synthetic_table()
    reference = c.analyze(rows)
    assert compare({'rows': rows, 'ts': reference})['parity']
    changed = {**reference, 'silhouette': reference['silhouette'] + .01}
    assert not compare({'rows': rows, 'ts': changed})['parity']
    changed = {**reference, 'labels': [0] * len(rows)}
    assert not compare({'rows': rows, 'ts': changed})['parity']
    assert not compare({'rows': rows, 'ts': {**reference, 'candidates': []}})['parity']
    for rows in [[], [[1, 1, 1]] * 30, [[1, 1, 1]] * 39 + [[1000, 30, 5]]]:
        assert compare({'rows': rows, 'ts': c.analyze(rows)})['parity']


def test_scale_adapter_uses_existing_synthetic_generator():
    from analytics.benchmark import raw_scale
    raw = raw_scale()
    assert len(raw['debtors']) == 2933
    assert len(raw['debts']) == 56286
    assert raw['batch']['as_of'] == '2026-09-30'


def test_reference_declares_online_size_limit():
    assert c.analyze([[1, 2, 3]] * 10001)['status'] == 'UNAVAILABLE'
