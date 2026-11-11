"""Referencia sklearn del núcleo TS. Solo acepta matrices numéricas sin identidad."""
import json
from pathlib import Path

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import adjusted_rand_score, silhouette_score
from threadpoolctl import threadpool_limits

SEED = 20261111
MAX_ITERATIONS = 150
SAMPLE_SIZE = 384
RESAMPLES = 5
MAXIMUM_CASES = 10000
ROOT = Path(__file__).resolve().parents[2]


def random_numbers(seed):
    state = seed & 0xFFFFFFFF
    while True:
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        yield state / 4294967296


def sample_indices(n, size, seed):
    indices = list(range(n))
    rng = random_numbers(seed)
    for i in range(n - 1, 0, -1):
        j = int(next(rng) * (i + 1))
        indices[i], indices[j] = indices[j], indices[i]
    return sorted(indices[:size])


def fit_preprocessing(rows):
    caps = np.quantile(rows, .99, axis=0)
    logged = np.log1p(np.minimum(rows, caps))
    means = logged.mean(axis=0)
    scales = logged.std(axis=0)
    scales[scales == 0] = 1
    return caps, means, scales


def transform(rows, fitted):
    caps, means, scales = fitted
    return (np.log1p(np.minimum(rows, caps)) - means) / scales


def initial_centers(rows, k, seed=SEED):
    centers = [rows[int(next(random_numbers(seed)) * len(rows))]]
    while len(centers) < k:
        distances = np.min([np.sum((rows - center) ** 2, axis=1) for center in centers], axis=0)
        centers.append(rows[int(np.argmax(distances))])
    return np.array(centers)


def fit(rows, k, seed=SEED):
    centers = initial_centers(rows, k, seed)
    if len(np.unique(centers, axis=0)) < k:
        return None
    model = KMeans(n_clusters=k, init=centers, n_init=1, max_iter=MAX_ITERATIONS, tol=0, algorithm='lloyd')
    model.fit(rows)
    return model if len(set(model.labels_)) == k else None


def silhouette(rows, labels):
    indices = sample_indices(len(rows), SAMPLE_SIZE, SEED)
    unique = len(set(labels[indices]))
    return float(silhouette_score(rows[indices], labels[indices])) if 1 < unique < len(indices) else None


def stability(rows, labels, k):
    scores = []
    for r in range(1, RESAMPLES + 1):
        subset = rows[sample_indices(len(rows), int(len(rows) * .8), SEED + r)]
        preprocessing = fit_preprocessing(subset)
        fitted = fit(transform(subset, preprocessing), k, SEED + r)
        scores.append(float(adjusted_rand_score(labels, fitted.predict(transform(rows, preprocessing)))) if fitted else 0)
    return float(np.median(scores))


@threadpool_limits.wrap(limits=1)
def analyze(rows):
    if len(rows) > MAXIMUM_CASES:
        return {'status': 'UNAVAILABLE', 'labels': [], 'candidates': [], 'selectedK': None}
    rows = np.array(rows, dtype=float)
    if len(rows) < 30:
        return {'status': 'INSUFFICIENT_DATA', 'labels': [], 'candidates': [], 'selectedK': None}
    scaled = transform(rows, fit_preprocessing(rows))
    if len(np.unique(scaled, axis=0)) < 2:
        return {'status': 'DEGENERATE', 'labels': [], 'candidates': [], 'selectedK': None}
    candidates, best = [], None
    for k in range(2, 7):
        model = fit(scaled, k)
        counts = np.bincount(model.labels_, minlength=k) if model else np.zeros(k)
        score = silhouette(scaled, model.labels_) if model else None
        eligible = model is not None and min(counts) >= max(5, np.ceil(len(rows) * .05)) and score is not None
        candidates.append({'k': k, 'silhouette': score, 'smallestShare': float(min(counts) / len(rows)),
                           'inertia': float(model.inertia_) if model else 0, 'eligible': bool(eligible)})
        if eligible and (best is None or score > best[1] + 1e-10):
            best = model, score
    if best is None:
        return {'status': 'DEGENERATE', 'labels': [], 'candidates': candidates, 'selectedK': None}
    model, score = best
    order = sorted(range(model.n_clusters), key=lambda c: (np.median(rows[model.labels_ == c, 0]), c))
    labels = [order.index(int(c)) for c in model.labels_]
    return {'status': 'OK', 'selectedK': model.n_clusters, 'silhouette': score,
            'stability': stability(rows, model.labels_, model.n_clusters), 'labels': labels,
            'sizes': [labels.count(c) for c in range(model.n_clusters)], 'candidates': candidates}


def synthetic_table():
    rng = np.random.default_rng(SEED)
    rows = []
    for amount, days, count in [(1000, 20, 2), (40000, 250, 10), (800000, 2000, 40)]:
        for _ in range(45):
            rows.append([round(amount * np.exp(rng.normal(0, .14)), 2),
                         max(1, round(days * np.exp(rng.normal(0, .12)))),
                         max(1, round(count * np.exp(rng.normal(0, .1))))])
    return sorted(rows)


def generate_fixture():
    rows = synthetic_table()
    return {'kind': 'SYNTHETIC', 'seed': SEED, 'rows': rows, 'expected': analyze(rows)}


if __name__ == '__main__':
    target = ROOT / 'front/tests/fixtures/ml/parity.v1.json'
    target.write_text(json.dumps(generate_fixture(), ensure_ascii=False, indent=2) + '\n')
