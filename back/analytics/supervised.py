"""Experimento reducido autorizado el 11/11/2026. No implementa el mundo v1 completo."""
import json
import platform
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import scipy
import sklearn
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    log_loss,
    roc_auc_score,
)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler
from threadpoolctl import threadpool_limits

SEED = 20261111
LABEL = 'Experimento con datos sintéticos; no predice pagos reales de La Falda'
ROOT = Path(__file__).resolve().parents[2]
FEATURES = [('overdue_amount', 'Deuda vencida sintética'), ('max_overdue_days', 'Atraso máximo sintético'),
            ('obligation_count', 'Obligaciones sintéticas'), ('payments_180d', 'Pagos anteriores en 180 días'),
            ('prior_payment_90d', 'Algún pago anterior en 90 días')]


def features_at(observation):
    instant = observation['instant']
    past = [event for event in observation['payments'] if instant - timedelta(days=180) <= event < instant]
    return [*observation['snapshot'], len(past), int(any(event >= instant - timedelta(days=90) for event in past))]


def target_at(observation):
    instant = observation['instant']
    return int(any(instant < event <= instant + timedelta(days=90) for event in observation['payments']))


def generate(seed=SEED, no_signal=False):
    rng = np.random.default_rng(seed)
    observations = []
    # Una cohorte nueva de 300 objetos por mes: no hay objetos compartidos entre particiones.
    for month in range(21):
        instant = date(2024 + month // 12, month % 12 + 1, 1)
        for _ in range(300):
            snapshot = [float(np.exp(rng.normal(10, 1.1))), int(rng.integers(1, 1500)), int(rng.integers(1, 40))]
            payments = [instant - timedelta(days=int(rng.integers(1, 181))) for _ in range(int(rng.poisson(2)))]
            observation = {'unit': len(observations), 'instant': instant, 'snapshot_at': instant - timedelta(days=1),
                           'snapshot': snapshot, 'payments': payments,
                           'label_available': instant + timedelta(days=100)}
            x = features_at(observation)
            # Supuesto explícito: deuda/atraso reducen la probabilidad; historia de pagos la aumenta.
            logit = -.3 - .75 * (np.log1p(x[0]) - 10) - .7 * (np.log1p(x[1]) - 6) + .65 * (x[3] - 2) + .65 * x[4]
            probability = .4 if no_signal else 1 / (1 + np.exp(-logit))
            if rng.random() < probability:
                payments.append(instant + timedelta(days=int(rng.integers(1, 91))))
            observations.append(observation)
    return observations


def split(observations):
    start = date(2025, 4, 1)
    train = [o for o in observations if o['label_available'] < start]
    embargo = [o for o in observations if o['instant'] < start <= o['label_available']]
    test = [o for o in observations if o['instant'] >= start]
    return train, embargo, test


def arrays(observations):
    return np.array([features_at(o) for o in observations]), np.array([target_at(o) for o in observations])


def metrics(y, probabilities):
    return {'rocAuc': float(roc_auc_score(y, probabilities)), 'prAuc': float(average_precision_score(y, probabilities)),
            'brier': float(brier_score_loss(y, probabilities)), 'logLoss': float(log_loss(y, probabilities))}


def pipeline():
    return make_pipeline(FunctionTransformer(np.log1p), StandardScaler(),
                         LogisticRegression(C=1, max_iter=500, random_state=SEED))


def split_part(observations):
    return {'from': min(o['instant'] for o in observations).strftime('%Y-%m'),
            'to': max(o['instant'] for o in observations).strftime('%Y-%m'),
            'observations': len(observations), 'positives': sum(target_at(o) for o in observations)}


def control_result(code, label, description, y, probabilities):
    measured = metrics(y, probabilities)
    n1, n0 = int(y.sum()), int(len(y) - y.sum())
    margin = 3.29 * np.sqrt((n1 + n0 + 1) / (12 * n1 * n0))
    return {'id': code, 'label': label, 'description': description, 'metrics': measured,
            'expected': f'AUC en 0,5 ± {margin:.6f}'.replace('.', ',') + ' (3,29 errores estándar bajo independencia, fijado antes de evaluar).',
            'passed': bool(abs(measured['rocAuc'] - .5) <= margin)}


@threadpool_limits.wrap(limits=1)
def experiment(seed=SEED):
    data = generate(seed)
    train, embargo, test = split(data)
    x_train, y_train = arrays(train)
    x_test, y_test = arrays(test)
    model = pipeline().fit(x_train, y_train)
    base = np.full(len(test), y_train.mean())
    # Regla sencilla, sin puntaje municipal: tasa de entrenamiento según pago previo en 90 días.
    rates = [(y_train[x_train[:, 4] == flag].sum() + 1) / (sum(x_train[:, 4] == flag) + 2) for flag in [0, 1]]
    heuristic = np.array([rates[int(flag)] for flag in x_test[:, 4]])
    results = []
    for code, label, baseline, description, probabilities in [
        ('BASE_RATE', 'Tasa base', True, 'Frecuencia positiva del entrenamiento, constante en evaluación.', base),
        ('HEURISTIC', 'Heurística de pago reciente', True, 'Tasa por presencia de pago previo en 90 días, ajustada solo en entrenamiento con suavizado de Laplace.', heuristic),
        ('LOGISTIC_REGRESSION', 'Regresión logística', False, 'Pipeline log1p, StandardScaler y regresión logística L2, C=1. Sin búsqueda de hiperparámetros.', model.predict_proba(x_test)[:, 1]),
    ]:
        results.append({'id': code, 'label': label, 'isBaseline': baseline, 'description': description, 'metrics': metrics(y_test, probabilities)})
    null_train, _, null_test = split(generate(seed, no_signal=True))
    nx, ny = arrays(null_train)
    tx, ty = arrays(null_test)
    no_signal = control_result('NO_SIGNAL', 'Control sin señal',
                               'Mismo generador, probabilidad futura constante 0,4 independiente de todas las variables; pipeline reajustado en su entrenamiento.',
                               ty, pipeline().fit(nx, ny).predict_proba(tx)[:, 1])
    shuffled_train = np.random.default_rng(seed + 17).permutation(y_train)
    shuffled_test = np.random.default_rng(seed + 18).permutation(y_test)
    shuffled = control_result('SHUFFLED_LABELS', 'Control con etiquetas mezcladas',
                              'Etiquetas permutadas por separado dentro de entrenamiento y evaluación (semillas +17 y +18); preserva prevalencias, rompe la señal y reajusta el pipeline. No mezcla particiones.',
                              shuffled_test, pipeline().fit(x_train, shuffled_train).predict_proba(x_test)[:, 1])
    best = min(result['metrics']['logLoss'] for result in results if result['isBaseline'])
    beats = results[-1]['metrics']['logLoss'] < best
    return {'contractVersion': '1.0.0', 'label': LABEL, 'generatedAt': datetime.now(UTC).isoformat(),
            'codeVersion': 'analytics-reduced-v1', 'seed': seed,
            'libraries': {'python': platform.python_version(), 'numpy': np.__version__, 'scipy': scipy.__version__, 'scikit-learn': sklearn.__version__},
            'dataset': {'kind': 'SYNTHETIC', 'generator': 'analytics.supervised.generate/v1; cohortes independientes mensuales',
                        'units': len(data), 'observations': len(data), 'features': [{'key': k, 'label': v} for k, v in FEATURES],
                        'target': {'key': 'payment_90d', 'definition': 'Algún evento de pago sintético en (instante de predicción, instante +90 días]; etiqueta disponible a los 100 días.', 'windowDays': 90},
                        'positiveRate': sum(target_at(o) for o in data) / len(data)},
            'split': {'kind': 'TEMPORAL', 'train': split_part(train), 'embargo': split_part(embargo), 'test': split_part(test),
                      'note': 'Corte de ajuste 2025-04-01. Solo etiquetas disponibles estrictamente antes del corte; embargo enero–marzo 2025. Eventos de variables estrictamente anteriores al instante. Cohortes sin objetos compartidos. Toda evaluación madura al 2025-12-10.'},
            'models': results,
            'controls': [no_signal, shuffled],
            'verdict': {'modelBeatsBaseline': bool(beats), 'text': f'La logística {"supera" if beats else "no supera"} al mejor baseline por log-loss en esta evaluación sintética. No mide desempeño real ni utilidad de una intervención.'},
            'realHistory': {'suitable': False, 'text': 'El esquema observado registra obligaciones y estados actuales, vencimientos y last_collection_date; no acredita eventos históricos de pago, importes pagados ni instantáneas anteriores. No permite reconstruir variables al instante ni resultados futuros sin fuga. Haría falta un historial prospectivo fechado y auditable; no se afirma que existan fuentes externas no inspeccionadas.'},
            'limitations': ['Alcance reducido autorizado por el usuario el 11/11/2026; el protocolo previo sigue como borrador pendiente de aprobación íntegra.',
                            'Una semilla, un escenario con señal y dos controles (sin señal y etiquetas mezcladas); sin 20 réplicas, bootstrap, simulación causal ni auditoría de equidad completa.',
                            'Se reutilizan ventana de 90 días, rezago de 10 días, historia previa de 180 días, embargo temporal y control nulo del protocolo; no se implementa todo su mundo sintético.',
                            'Señal impuesta por el generador; AUC-PR se informa como average precision. La comparación principal usa log-loss.',
                            'No se guarda ni se aplica el modelo a contribuyentes reales. Las métricas son de una sola evaluación sintética.']}


if __name__ == '__main__':
    target = ROOT / 'front/lib/ml/artifacts/supervised-experiment.v1.json'
    target.write_text(json.dumps(experiment(), ensure_ascii=False, indent=2) + '\n')
