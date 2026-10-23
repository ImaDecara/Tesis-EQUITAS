"""Independent load evidence evaluator: exact samples, phases and prior SLO."""

import json
import math
from collections import defaultdict
from datetime import datetime


def phases(policy, mode):
    if mode == 'poc':
        return [('poc', 1, policy['poc']['duration_seconds'])]
    result = [('warmup', 1, policy['warmup_seconds'])]
    if mode == 'stress':
        result += [('stress_' + str(v), v, policy['stress']['plateau_seconds']) for v in policy['stress']['users']]
    elif mode == 'soak':
        result += [('soak', policy['soak']['users'], policy['soak']['duration_seconds'])]
    else:
        raise ValueError('Unknown load scenario')
    return result


def percentile(values, percent):
    ordered = sorted(values)
    if not ordered:
        return None
    position = (len(ordered) - 1) * percent / 100
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def statistics(points, duration):
    values = [p['ms'] for p in points]
    count = len(points)
    return {'requests': count, 'unexpected_errors': sum(p['error'] for p in points),
            'error_rate': sum(p['error'] for p in points) / count if count else None,
            'content_mismatches': sum(p['content_error'] for p in points),
            'p50_ms': percentile(values, 50), 'p95_ms': percentile(values, 95),
            'p99_ms': percentile(values, 99), 'max_ms': max(values) if values else None,
            'requests_per_second': count / duration, 'planned_seconds': duration,
            'observed_sample_span_seconds': max(p['time'] for p in points) - min(p['time'] for p in points) if count else 0}


def evaluate(raw_path, policy, mode, exit_code, elapsed_seconds, stop_reason=None):
    grouped = defaultdict(list)
    malformed = 0
    if raw_path.exists():
        with raw_path.open(encoding='utf-8') as stream:
            for line in stream:
                try:
                    value = json.loads(line)
                    if value.get('type') != 'Point' or value.get('metric') != 'operation_ms':
                        continue
                    data = value['data']
                    tags = data['tags']
                    point = {'time': datetime.fromisoformat(data['time']).timestamp(),
                             'ms': float(data['value']), 'op': tags['op'],
                             'error': tags['unexpected'] == 'true',
                             'content_error': tags['content_mismatch'] == 'true'}
                    if not math.isfinite(point['ms']) or point['ms'] < 0 or point['op'] not in ('list', 'filtered', 'summary'):
                        raise ValueError('Invalid sample')
                    grouped[tags['phase']].append(point)
                except (ValueError, KeyError, TypeError):
                    malformed += 1
    errors = []
    if exit_code != 0:
        errors.append('k6 returned a nonzero exit status: ' + str(exit_code))
    if stop_reason:
        errors.append(stop_reason)
    if malformed:
        errors.append('Malformed/truncated raw samples: ' + str(malformed))
    expected = phases(policy, mode)
    expected_seconds = sum(p[2] for p in expected) + policy['drain_seconds'] * (len(expected) - 1)
    if elapsed_seconds < expected_seconds:
        errors.append('Campaign shorter than the configured schedule')
    if set(grouped) - {p[0] for p in expected}:
        errors.append('Samples from an unknown phase')
    rows, series = [], []
    acceptance = policy['acceptance']
    for name, users, seconds in expected:
        points = grouped[name]
        aggregate = statistics(points, seconds)
        required_slo = mode != 'poc' and name != 'warmup' and users <= acceptance['target_users']
        operations = {op: statistics([p for p in points if p['op'] == op], seconds) for op in ('list', 'filtered', 'summary')}
        minimum = 10 if mode == 'poc' or name == 'warmup' else acceptance['requests_per_phase_min']
        if len(points) < minimum:
            errors.append(name + ': insufficient samples')
        if aggregate['observed_sample_span_seconds'] < seconds - policy['request_timeout_seconds'] - 1:
            errors.append(name + ': incomplete phase observation')
        for op, stats in operations.items():
            minimum_op = 1 if mode == 'poc' or name == 'warmup' else acceptance['requests_per_operation_min']
            if stats['requests'] < minimum_op:
                errors.append(name + '/' + op + ': insufficient samples')
        slo_met = True
        for label, stats in [('all', aggregate), *operations.items()]:
            if stats['content_mismatches']:
                errors.append(name + '/' + label + ': incorrect functional content')
            meets = (stats['p95_ms'] is not None and stats['p95_ms'] <= acceptance['p95_ms_max']
                     and stats['error_rate'] <= acceptance['unexpected_error_rate_max'])
            slo_met = slo_met and meets
            if required_slo and not meets:
                errors.append(name + '/' + label + ': prior latency/error SLO failed')
            if mode == 'poc' and stats['unexpected_errors']:
                errors.append('PoC requires all responses to be valid')
        rows.append({'phase': name, 'users': users, 'slo_required': required_slo,
                     'slo_met': slo_met, **aggregate, 'operations': operations})
        buckets = defaultdict(list)
        for point in points:
            bucket = int(point['time'] // acceptance['series_bucket_seconds']) * acceptance['series_bucket_seconds']
            buckets[bucket].append(point)
        for index, bucket in enumerate(sorted(buckets)):
            series.append({'phase': name, 'bucket_start_unix': bucket,
                           'edge_bucket_may_be_partial': index in (0, len(buckets) - 1),
                           **statistics(buckets[bucket], acceptance['series_bucket_seconds'])})
    limit = next((row['users'] for row in rows if row['phase'] != 'warmup'
                  and row['users'] > acceptance['target_users'] and not row['slo_met']), None)
    return {'passed': not errors, 'errors': errors, 'phases': rows, 'time_series': series,
            'expected_schedule_seconds': expected_seconds, 'actual_process_seconds': elapsed_seconds,
            'first_above_target_slo_failure_users': limit, 'warmup_excluded_from_main_slo': True,
            'percentile_method': 'linear interpolation at (n-1)*p; unrounded threshold comparison',
            'throughput_denominator': 'configured phase seconds; 10s nominal buckets, edge buckets flagged'}
