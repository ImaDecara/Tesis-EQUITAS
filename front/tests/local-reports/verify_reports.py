"""ALIGN-028. Verifica las respuestas de run-http.mjs con el modulo csv de Python, sin codigo de la aplicacion.

Uso: python3 -I tests/local-reports/verify_reports.py <salida de run-http> <expected.json>
Publica solo conteos y nombres de comprobacion. Sale con 1 si algo falla.
"""
import csv
import io
import json
import re
import sys
from decimal import Decimal
from pathlib import Path

folder = Path(sys.argv[1])
expected = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
results = json.loads((folder / "results.json").read_text(encoding="utf-8"))
failures = []
checks = 0


def check(name, condition, detail=""):
    global checks
    checks += 1
    if not condition:
        failures.append(f"{name} {detail}".strip())


def result(account, path, tenant=None, method="GET"):
    return next(r for r in results if r["account"] == account and r["path"] == path and r["tenant"] == tenant and r["method"] == method)


def read_csv(row):
    raw = (folder / row["file"]).read_bytes()
    check(f"BOM {row['file']}", raw.startswith(b"\xef\xbb\xbf"))
    text = raw.decode("utf-8-sig")
    check(f"CRLF {row['file']}", "\n" not in text.replace("\r\n", ""))
    return list(csv.DictReader(io.StringIO(text, newline=""), delimiter=";"))


def page_flight(row):
    """Contenido de la pantalla: el HTML solo trae "Validando sesion..."; el resto viaja en el payload Flight."""
    raw = (folder / row["file"]).read_text(encoding="utf-8")
    chunks = re.findall(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', raw)
    return "".join(json.loads(chunk) for chunk in chunks).replace("\xa0", " ")


def card_value(flight, label):
    """Primer texto despues del rotulo de una tarjeta. Flight escribe un `$` inicial como `$$`."""
    found = re.search(rf'"children":"{re.escape(label)}"(.*?)"children":"([^"]*)"', flight, flags=re.S)
    return found.group(2) if found else None


def counter(flight):
    found = re.search(r'"([\d.]+)(?:",")? casos"', flight)
    return int(found.group(1).replace(".", "")) if found else None


def number(cell):
    return Decimal(cell.replace(",", ".")) if re.fullmatch(r"-?\d+(,\d{2})?", cell) else None


def details(rows):
    return [r for r in rows if r["tipo_fila"] == "DETALLE"]


def total(rows):
    found = [r for r in rows if r["tipo_fila"] == "TOTAL"]
    check("una sola fila TOTAL", len(found) == 1)
    return found[0]


def aggregated(rows, indicator, category="TOTAL"):
    found = [r for r in rows if r["indicador"] == indicator and r["categoria"] == category]
    check(f"indicador {indicator}/{category}", len(found) == 1)
    return found[0] if found else {"valor": "AUSENTE", "numerador": "AUSENTE", "denominador": "AUSENTE"}


REPORTS = ["queue", "decisions", "supervision", "data-quality"]
PATHS = {name: f"/api/reports/{name}" for name in REPORTS}
ALLOWED = {
    "consulta": {"queue", "decisions", "data-quality"},
    "operador": {"queue", "decisions", "data-quality"},
    "supervisor": set(REPORTS),
    "otro-operador": {"queue", "decisions", "data-quality"},
    "tp-e06-a": {"queue", "data-quality"},
    "importador": set(),
    "sin-membresia": set(),
    "inactivo": set(),
    "tp-e06-none": set(),
    "tp-e06-inactive": set(),
}
SECRETS = [b"TP-A028-PERSONA", b"TP-A028-DOC", b"tp-a028-uno@", b"DESCRIPCION-SECRETA", b"EXPLICACION-SECRETA", b"TP-A028-TEXTO-LIBRE", b"Persona sintetica", b"persona-a@"]

# 1. Autorizacion real: rol por reporte, sin archivo cuando se deniega.
for name in REPORTS:
    anonymous = result("anonimo", PATHS[name])
    check(f"anonimo {name} 307", anonymous["status"] == 307, str(anonymous["status"]))
    check(f"anonimo {name} a login", (anonymous["location"] or "").startswith("/login"))
    check(f"anonimo {name} sin CSV", "text/csv" not in (anonymous["contentType"] or ""))
for account, allowed in ALLOWED.items():
    for name in REPORTS:
        row = result(account, PATHS[name])
        if name in allowed:
            check(f"{account}/{name} 200", row["status"] == 200, str(row["status"]))
            check(f"{account}/{name} text/csv", row["contentType"] == "text/csv; charset=utf-8")
            check(f"{account}/{name} no-store", row["cacheControl"] == "private, no-store")
            check(f"{account}/{name} adjunto", (row["disposition"] or "").startswith("attachment;"))
        else:
            check(f"{account}/{name} denegado", row["status"] == 403, str(row["status"]))
            check(f"{account}/{name} sin CSV", "application/json" in (row["contentType"] or "") and row["disposition"] is None)

check("HEAD autorizado", result("supervisor", PATHS["supervision"], method="HEAD")["status"] == 200)
check("HEAD denegado", result("consulta", PATHS["supervision"], method="HEAD")["status"] == 403)
check("POST no existe", result("supervisor", PATHS["supervision"], method="POST")["status"] == 405)

# 2. Dos membresias y cookies ajenas.
for name in REPORTS:
    check(f"multi sin eleccion {name}", result("otro-supervisor", PATHS[name])["status"] == 409)
    check(f"multi cookie ajena {name}", result("otro-supervisor", PATHS[name], "910001")["status"] == 403)
    check(f"multi B {name}", result("otro-supervisor", PATHS[name], "920002")["status"] == 200)
    check(f"una membresia con cookie de otro {name}", result("supervisor", PATHS[name], "920002")["status"] == 403)
    as_consulta = result("otro-supervisor", PATHS[name], "920001")["status"]
    check(f"multi A como consulta {name}", as_consulta == (403 if name == "supervision" else 200), str(as_consulta))

# 3. Ningun archivo trae datos personales, texto libre ni identidad; ninguno cruza municipios.
for row in results:
    if row["method"] != "GET" or row["status"] != 200 or row["contentType"] != "text/csv; charset=utf-8":
        continue
    raw = (folder / row["file"]).read_bytes()
    for secret in SECRETS:
        check(f"sin {secret!r} en {row['file']}", secret not in raw)
    in_a = row["account"] in {"consulta", "operador", "supervisor"} or row["tenant"] == "920001"
    if in_a:
        check(f"sin municipio B en {row['file']}", b"AJENO-B" not in raw and b"AJENO_B" not in raw)
    in_b = row["account"] == "otro-operador" or row["tenant"] == "920002"
    if in_b:
        check(f"sin municipio A en {row['file']}", b"TP-A028-CONTACTO" not in raw and b"REINCIDENCIA" not in raw)

# 4. Cola = SQL y = pantalla, con los mismos filtros.
queue = read_csv(result("operador", PATHS["queue"]))
rows = details(queue)
queue_total = total(queue)
check("cola objetos = SQL", len(rows) == expected["objetos"], f"{len(rows)} {expected['objetos']}")
check("cola total = filas", number(queue_total["objetos"]) == len(rows))
check("cola obligaciones = SQL", number(queue_total["obligaciones"]) == expected["obligaciones"])
detail_sum = sum(number(r["deuda_total_ars"]) or Decimal(0) for r in rows)
check("cola suma de filas = total", detail_sum == number(queue_total["deuda_total_ars"]), f"{detail_sum}")
check("cola suma = SQL", detail_sum == Decimal(str(expected["deuda_total"])), f"{detail_sum} {expected['deuda_total']}")
check("cola corte sin reloj", all(r["fecha_corte"] == "NO_INTEGRADO" for r in queue), "aunque haya un lote publicado que el lector no usa")
check("cola fecha de calculo rotulada", all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", r["fecha_calculo_usada"]) for r in queue))
check("cola generado_en", all(re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", r["generado_en"]) for r in queue))
check("cola version", all(r["version_reglas"] == "1.0.0" for r in queue))
check("cola definiciones", all(r["definiciones"] == "docs/tesis/catalogo-indicadores-v1.md#reporte-cola" for r in queue))
by_id = {r["objeto_id"]: r for r in rows}
check("formula neutralizada", by_id["928103"]["identificador"].startswith("'="))
check("texto negativo neutralizado", by_id["928104"]["identificador"] == "'-2+3")
check("arroba neutralizada", by_id["928105"]["identificador"] == "'@SUM(A1)")
check("importe negativo numerico", by_id["928106"]["deuda_total_ars"] == "-50")
check("sin vencimiento declara severidad", by_id["928107"]["severidad_estado"] == "NO_DISPONIBLE")
check("sin obligaciones suma 0 derivado", by_id["920001"]["deuda_total_ars"] == "0")
for query in ["", "?contact=without", "?contact=with", "?risk=ALTO", "?minAmount=100000", "?q=TP-A028-PERSONA-DOS", "?type=NO-EXISTE"]:
    report = read_csv(result("operador", f"{PATHS['queue']}{query}"))
    count = counter(page_flight(result("operador", f"/priority-cases{query}")))
    check(f"pantalla con contador {query}", count is not None)
    check(f"cola = pantalla {query}", len(details(report)) == count, f"{len(details(report))} {count}")
    check(f"total con metadatos {query}", number(total(report)["objetos"]) == len(details(report)) and bool(total(report)["generado_en"]))
shown_total = card_value(page_flight(result("operador", "/debt-aging")), "Deuda total")
check("/debt-aging muestra la deuda", shown_total is not None and re.fullmatch(r"\$\$? ?[\d.]+", shown_total) is not None, str(shown_total))
if shown_total:
    # La pantalla redondea a pesos enteros.
    screen_total = Decimal(re.sub(r"[^\d]", "", shown_total))
    check("cola total = /debt-aging", abs(detail_sum - screen_total) <= Decimal("0.5"), f"{detail_sum} {screen_total}")

# 5. Calidad = SQL y = pantalla.
quality = read_csv(result("operador", PATHS["data-quality"]))
check("calidad objetos = SQL", number(aggregated(quality, "objetos_leidos")["valor"]) == expected["objetos"])
check("calidad obligaciones = SQL", number(aggregated(quality, "obligaciones_leidas")["valor"]) == expected["obligaciones"])
without = aggregated(quality, "objetos_sin_contacto")
check("calidad sin contacto = SQL", number(without["valor"]) == expected["sin_contacto"], without["valor"])
no_contact = card_value(page_flight(result("operador", "/no-contact")), "Total sin contacto")
check("calidad sin contacto = /no-contact", no_contact == without["valor"], str(no_contact))
for indicator in ["presencia_deuda_total", "presencia_deuda_vencida", "presencia_contactos", "presencia_atraso", "presencia_severidad", "severidad_estado"]:
    categories = [r for r in quality if r["indicador"] == indicator]
    check(f"{indicator} suma el universo", sum(number(r["valor"]) for r in categories) == expected["objetos"])

# 6. Decisiones y supervision = SQL.
decisions = read_csv(result("supervisor", PATHS["decisions"]))
supervision = read_csv(result("supervisor", PATHS["supervision"]))
check("decisiones eventos = SQL", len(details(decisions)) == expected["eventos"])
check("decisiones vigentes = SQL", number(total(decisions)["vigentes"]) == expected["vigentes"])
check("decisiones corte de la fila", {r["fecha_corte"] for r in details(decisions)} == {"2026-09-30", "2026-10-15"})
check("decisiones total intervalo", total(decisions)["fecha_corte"] == "2026-09-30/2026-10-15")
check("decisiones versiones", total(decisions)["version_reglas"] == "1.0.0|1.1.0")
check("decisiones sin intensidad 0 inventada", {r["intensidad_decidida"] for r in details(decisions) if r["decision"] in ("RECHAZA", "POSPONE")} == {"NO_APLICA"})
check("decisiones sin identidades", not {"reviewer", "approver", "reason_text"} & set(decisions[0]))
check("supervision vigentes = SQL", number(aggregated(supervision, "decisiones_vigentes")["valor"]) == expected["vigentes"])
for decision, count in expected["por_tipo"].items():
    check(f"supervision {decision} = SQL", number(aggregated(supervision, "decisiones_por_tipo", decision)["valor"]) == count)
discrepancy = aggregated(supervision, "porcentaje_discrepancia")
check("discrepancia numerador", number(discrepancy["numerador"]) == expected["no_acepta"])
check("discrepancia denominador", number(discrepancy["denominador"]) == expected["vigentes"])
check("discrepancia valor", abs(number(discrepancy["valor"]) - Decimal(100 * expected["no_acepta"]) / expected["vigentes"]) < Decimal("0.01"))
for code, count in expected["motivos"].items():
    check(f"motivo {code} = SQL", number(aggregated(supervision, "motivos_decision", code)["valor"]) == count)
check("requerida = SQL", number(aggregated(supervision, "aprobacion_requerida")["valor"]) == expected["requerida"])
check("pendientes = SQL", number(aggregated(supervision, "pendientes_aprobacion")["valor"]) == expected["pendientes"])
check("aprueba = SQL", number(aggregated(supervision, "aprobaciones_vigentes", "APRUEBA")["valor"]) == expected["aprueba"])
check("objeta = SQL", number(aggregated(supervision, "aprobaciones_vigentes", "OBJETA")["valor"]) == expected["objeta"])
check("supervision sin filas individuales", {r["tipo_fila"] for r in supervision} == {"AGREGADO"} and "objeto_id" not in supervision[0])
for query in ["?corte=2026-09-30", "?corte=2026-10-15", "?corte=2030-01-01"]:
    filtered_decisions = read_csv(result("supervisor", f"{PATHS['decisions']}{query}"))
    filtered_supervision = read_csv(result("supervisor", f"{PATHS['supervision']}{query}"))
    current = [r for r in details(filtered_decisions) if r["vigente"] == "SI"]
    check(f"supervision = decisiones {query}", number(aggregated(filtered_supervision, "decisiones_vigentes")["valor"]) == len(current))
empty = read_csv(result("supervisor", f"{PATHS['supervision']}?corte=2030-01-01"))
check("sin decisiones: porcentaje NO_APLICA", aggregated(empty, "porcentaje_discrepancia")["valor"] == "NO_APLICA")

# 7. Filtros invalidos.
for query in ["?risk=XYZ", "?tenant=920002", "?nada=1"]:
    row = result("operador", f"{PATHS['queue']}{query}")
    check(f"400 {query}", row["status"] == 400 and row["disposition"] is None, str(row["status"]))

# 8. tp_operator real: lee la cartera E06 y solo la suya.
tp = read_csv(result("tp-e06-a", PATHS["queue"]))
check("tp_operator solo su municipio", {r["identificador"] for r in details(tp)} == {"TP-A"})

print(f"comprobaciones={checks} fallas={len(failures)} solicitudes={len(results)}")
for failure in failures:
    print(f"FALLA {failure}")
sys.exit(1 if failures else 0)
