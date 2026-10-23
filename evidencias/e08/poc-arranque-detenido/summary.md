# E08 - poc

SHA: `f52c5ac13150d1ac2beb9e95995f8d8895d29975`. Policy: `2bf56375cfba5cbb8ee4ba17073c0a5fc8c8a90744f688083f8242b907fcc751`.

**FALLIDO**. One campaign; warmup excluded from main SLO.

| Phase | VUs | Requests | p50 ms | p95 ms | p99 ms | Errors | req/s | SLO required |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| poc | 1 | 0 | n/a | n/a | n/a | 0 | 0.00 | False |

Actual process duration: 0 s.

k6 returned a nonzero exit status: -1
ValueError: Wrong process, dataset or source version on loopback
Campaign shorter than the configured schedule
poc: insufficient samples
poc: incomplete phase observation
poc/list: insufficient samples
poc/filtered: insufficient samples
poc/summary: insufficient samples

Scope: isolated production API processing; synthetic source; no cloud/Web capacity claim.
