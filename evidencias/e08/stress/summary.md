# E08 - stress

SHA: `f6f83f9a3172fc2e42912305a181057130d9577b`. Policy: `2bf56375cfba5cbb8ee4ba17073c0a5fc8c8a90744f688083f8242b907fcc751`.

**APROBADO**. One campaign; warmup excluded from main SLO.

| Phase | VUs | Requests | p50 ms | p95 ms | p99 ms | Errors | req/s | SLO required |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| warmup | 1 | 226 | 29.24 | 45.89 | 48.74 | 0 | 7.53 | False |
| stress_1 | 1 | 447 | 30.29 | 47.20 | 50.90 | 0 | 7.45 | True |
| stress_5 | 5 | 1225 | 152.88 | 174.14 | 180.63 | 0 | 20.42 | True |
| stress_10 | 10 | 1486 | 327.76 | 389.46 | 424.04 | 0 | 24.77 | True |
| stress_20 | 20 | 1641 | 683.48 | 794.16 | 824.43 | 0 | 27.35 | False |
| stress_40 | 40 | 1609 | 1471.78 | 1647.00 | 1674.56 | 0 | 26.82 | False |

Actual process duration: 382.076 s.



Scope: isolated production API processing; synthetic source; no cloud/Web capacity claim.
