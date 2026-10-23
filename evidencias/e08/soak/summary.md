# E08 - soak

SHA: `f6f83f9a3172fc2e42912305a181057130d9577b`. Policy: `2bf56375cfba5cbb8ee4ba17073c0a5fc8c8a90744f688083f8242b907fcc751`.

**APROBADO**. One campaign; warmup excluded from main SLO.

| Phase | VUs | Requests | p50 ms | p95 ms | p99 ms | Errors | req/s | SLO required |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| warmup | 1 | 207 | 41.10 | 59.01 | 62.61 | 0 | 6.90 | False |
| soak | 10 | 12160 | 419.48 | 532.58 | 598.35 | 0 | 20.27 | True |

Actual process duration: 642.148 s.



Scope: isolated production API processing; synthetic source; no cloud/Web capacity claim.
