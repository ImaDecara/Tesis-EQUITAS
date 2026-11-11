"""Recibe la tabla solo por stdin y devuelve exclusivamente agregados; nada se persiste."""
import json
import sys

from sklearn.metrics import adjusted_rand_score

from analytics.clustering import analyze


def compare(payload):
    reference = analyze(payload['rows'])
    ts = payload['ts']
    same_status = ts['status'] == reference['status']
    same_k = ts['selectedK'] == reference['selectedK']
    both_ok = ts['status'] == reference['status'] == 'OK'
    ari = float(adjusted_rand_score(ts['labels'], reference['labels'])) if both_ok else None
    silhouette_delta = abs(ts['silhouette'] - reference['silhouette']) if both_ok else None
    stability_delta = abs(ts['stability'] - reference['stability']) if both_ok else None
    candidates_match = len(ts['candidates']) == len(reference['candidates']) and all(
        a['k'] == b['k'] and a['eligible'] == b['eligible'] and
        ((a['silhouette'] is None and b['silhouette'] is None) or
         (a['silhouette'] is not None and b['silhouette'] is not None and abs(a['silhouette'] - b['silhouette']) < 1e-8))
        for a, b in zip(ts['candidates'], reference['candidates'])
    )
    parity = same_status and same_k and candidates_match and (not both_ok or (ari == 1 and silhouette_delta < 1e-8 and stability_delta < 1e-8))
    return {'parity': parity, 'sameStatus': same_status, 'sameK': same_k, 'candidatesMatch': candidates_match,
            'adjustedRandTSvsSklearn': ari, 'silhouetteDelta': silhouette_delta, 'stabilityDelta': stability_delta,
            'reference': {key: value for key, value in reference.items() if key in ['status', 'selectedK', 'silhouette', 'stability', 'sizes']}}


if __name__ == '__main__':
    try:
        print(json.dumps(compare(json.load(sys.stdin))))
    except (ValueError, TypeError, KeyError, OSError, RuntimeError):
        sys.stderr.write('No se pudo comparar la tabla privada.\n')
        sys.exit(1)
