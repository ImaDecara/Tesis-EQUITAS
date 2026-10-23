# E08 - soak

SHA: `5b62c14c8186b1ea79c4d4c2aa7dfb8acbb26198`. Policy: `2bf56375cfba5cbb8ee4ba17073c0a5fc8c8a90744f688083f8242b907fcc751`.

**APROBADO**. One campaign; warmup excluded from main SLO.

| Phase | VUs | Requests | p50 ms | p95 ms | p99 ms | Errors | req/s | SLO required |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| warmup | 1 | 222 | 31.61 | 47.36 | 48.31 | 0 | 7.40 | False |
| soak | 10 | 15149 | 318.46 | 360.06 | 384.79 | 0 | 25.25 | True |

Actual process duration: 642.122 s.



Scope: isolated production API processing; synthetic source; no cloud/Web capacity claim.
