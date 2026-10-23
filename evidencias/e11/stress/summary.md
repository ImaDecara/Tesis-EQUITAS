# E08 - stress

SHA: `5b62c14c8186b1ea79c4d4c2aa7dfb8acbb26198`. Policy: `2bf56375cfba5cbb8ee4ba17073c0a5fc8c8a90744f688083f8242b907fcc751`.

**APROBADO**. One campaign; warmup excluded from main SLO.

| Phase | VUs | Requests | p50 ms | p95 ms | p99 ms | Errors | req/s | SLO required |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| warmup | 1 | 210 | 39.46 | 55.51 | 57.43 | 0 | 7.00 | False |
| stress_1 | 1 | 419 | 39.47 | 55.44 | 58.52 | 0 | 6.98 | True |
| stress_5 | 5 | 1075 | 192.84 | 220.42 | 232.22 | 0 | 17.92 | True |
| stress_10 | 10 | 1262 | 403.24 | 501.80 | 557.66 | 0 | 21.03 | True |
| stress_20 | 20 | 1292 | 881.24 | 1041.74 | 1177.09 | 0 | 21.53 | False |
| stress_40 | 40 | 1264 | 1923.23 | 2216.71 | 2267.16 | 0 | 21.07 | False |

Actual process duration: 382.085 s.



Scope: isolated production API processing; synthetic source; no cloud/Web capacity claim.
