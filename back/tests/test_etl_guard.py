"""Guardias del ETL: destinos ficticios, sin conexiones ni datos personales reales."""

import configparser
import os
import re
import subprocess
import sys
import traceback
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pandas as pd
import pytest

from oracle_lots import AS_OF, accepted_objects, derive_lot

from ETL import config, extract, load, run_etl

ORIGINAL = "folyslqzqvnpolexcxjo"
CENTINELAS = (
    "NOMBRE_SINTETICO_ALIGN025",
    "DOCUMENTO_FICTICIO_ALIGN025",
    "correo-sintetico-align025@example.invalid",
    "TELEFONO_FICTICIO_ALIGN025",
)


@pytest.fixture(autouse=True)
def entorno_aislado(monkeypatch, tmp_path):
    config._client_for_settings.cache_clear()
    for name in tuple(os.environ):
        if name.startswith(("SUPABASE_", "EQUITAS_")):
            monkeypatch.delenv(name)
    monkeypatch.setattr(config, "ENV_PATH", tmp_path / "sin-credenciales.env")
    monkeypatch.setattr(config, "create_client", Mock(side_effect=AssertionError("Cliente no simulado")))
    monkeypatch.setattr(httpx.Client, "send", Mock(side_effect=AssertionError("Red prohibida")))
    yield
    config._client_for_settings.cache_clear()


def preparar_ejecucion(monkeypatch):
    monkeypatch.setenv("EQUITAS_TARGET_ENV", "local")
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:54321")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "CLAVE_FICTICIA_ALIGN025")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "CLAVE_PUBLICA_FICTICIA_ALIGN026")
    monkeypatch.setenv("EQUITAS_IMPORT_SERVER_JWT", "JWT_FICTICIO_ALIGN026")
    monkeypatch.setenv("EQUITAS_IMPORT_ACTOR_USER", "7")


def fuente_sintetica():
    nombre, documento, email, telefono = CENTINELAS
    cabecera = {
        "Bien_Tipo_Id": "6", "Cuenta": "1001", "Destinatario_Id": "501",
        "Destinatario": nombre, "Destinatario_CUIT": documento,
        "Destinatario_Email": email, "Destinatario_Telefono": telefono,
        "ClaveAgrupacion": "CLAVE_SINTETICA_ALIGN025",
        "Tipo_Ingreso_Id": "801", "Fecha_Actualizacion": "10/01/2025",
    }
    detalle = {
        **cabecera, "DEUD_id": "9001", "NOTD_capital": "100",
        "NOTD_totalActualizado": "120", "NOTD_vencimiento": "01/01/2020",
    }
    return cabecera, detalle


# ALIGN-026: --execute valida el lote completo antes de cargar. Un lote derivado del oráculo, con centinelas
# en los campos personales de un objeto, reemplaza a la fuente de una sola fila que ya no sería publicable.
def lote_con_centinelas(tmp_path):
    objeto = accepted_objects()[0]["clave_agrupacion"]
    nombre, documento, email, telefono = CENTINELAS
    return objeto, derive_lot(tmp_path / "lote", cabecera_cells={
        (objeto, None, "Destinatario"): nombre,
        (objeto, None, "Destinatario_CUIT"): documento,
        (objeto, None, "Destinatario_Email"): email,
        (objeto, None, "Destinatario_Telefono"): telefono,
    })


def simular_carga(monkeypatch):
    monkeypatch.setattr(run_etl, "resolve_catalogs", lambda required, _columns: {
        table: {key: index for index, key in enumerate(sorted(keys), start=1)} for table, keys in required.items()
    })
    monkeypatch.setattr(run_etl, "fetch_published_objects", Mock(return_value={}))
    monkeypatch.setattr(run_etl, "record_import_batch", Mock(return_value=1))
    for nombre in ("load_person", "load_debtor", "load_debtor_person", "load_debtor_contact",
                   "load_debtor_profile_detail", "load_province", "load_city", "load_address"):
        monkeypatch.setattr(run_etl, nombre, Mock(return_value={"id": 1}))
    monkeypatch.setattr(run_etl, "load_debts_bulk",
                        Mock(return_value={"unique": 1, "inserted": 1, "updated": 0, "unchanged": 0}))
    monkeypatch.setattr(run_etl, "recompute_debtor_profiles",
                        Mock(side_effect=lambda ids, _as_of, **_: {debtor: 1 for debtor in ids}))


def comprobar_salida_segura(texto):
    for centinela in (*CENTINELAS, "CLAVE_SINTETICA_ALIGN025"):
        assert centinela.lower() not in texto.lower()


def test_importacion_sin_credenciales_no_crea_cliente(tmp_path):
    # Proceso nuevo: evita que conftest o la caché de imports oculten el problema.
    programa = """
import os
import socket
import supabase
import dotenv
def prohibido(*args, **kwargs):
    raise AssertionError('Efecto lateral durante importación')
supabase.create_client = prohibido
dotenv.load_dotenv = prohibido
socket.create_connection = prohibido
import ETL.config
import ETL.run_etl
import services.scoring_service
assert ETL.config.settings.supabase_url == ''
print('IMPORTACION_PURA_OK')
"""
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(("SUPABASE_", "EQUITAS_"))}
    result = subprocess.run([sys.executable, "-c", programa], env=env,
                            capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert "IMPORTACION_PURA_OK" in result.stdout


@pytest.mark.parametrize("target", ["", "production", "original", "LOCAL", "preview"])
def test_execute_rechaza_entorno_antes_de_extraer(monkeypatch, target):
    preparar_ejecucion(monkeypatch)
    monkeypatch.setenv("EQUITAS_TARGET_ENV", target)
    extraer = Mock(side_effect=AssertionError("No debe leer archivos"))
    monkeypatch.setattr(run_etl, "extract_from_input_folder_limited", extraer)
    with pytest.raises(RuntimeError, match="TARGET_ENV_INVALID"):
        run_etl.run_etl("sintetico", execute=True)
    extraer.assert_not_called()
    config.create_client.assert_not_called()


@pytest.mark.parametrize("reference", [
    ORIGINAL, ORIGINAL.upper(), f"  {ORIGINAL}  ", " ".join(ORIGINAL),
    f"https://{ORIGINAL}.supabase.co", f"https://{ORIGINAL.upper()}.supabase.co/",
    f"https://localhost/?ref={ORIGINAL}", f"https://{ORIGINAL}@localhost",
    "%66" + ORIGINAL[1:], "%2566" + ORIGINAL[1:],
    "％６６" + ORIGINAL[1:],
    "\u200b".join(ORIGINAL), "".join(chr(ord(c) + 0xFEE0) for c in ORIGINAL),
])
@pytest.mark.parametrize("variable", ["SUPABASE_URL", "SUPABASE_PROJECT_REF", "EQUITAS_TARGET_REF"])
def test_original_se_rechaza_en_url_host_o_referencia(monkeypatch, reference, variable):
    preparar_ejecucion(monkeypatch)
    monkeypatch.setenv(variable, reference)
    with pytest.raises(RuntimeError, match="TARGET_ORIGINAL_FORBIDDEN"):
        config.create_supabase_client()
    config.create_client.assert_not_called()


@pytest.mark.parametrize("url", [
    "https://example.invalid", "https://iylwghgvtydpmwidojdo.supabase.co",
    "https://localhost.example.invalid", "https://localhost@evil.invalid",
    "http://127.0.0.2", "http://2130706433", "http://127.1", "localhost",
    "//localhost", "ftp://localhost", "http://user:password@localhost",
    "http://localhost/path", "http://localhost?ref=ficticio", "http://localhost#ficticio",
    "http://local host", "http://localhost:invalido", "http://[::1", "http://localhost\\@evil.invalid",
])
def test_url_no_permitida_nunca_crea_cliente(monkeypatch, url):
    preparar_ejecucion(monkeypatch)
    monkeypatch.setenv("SUPABASE_URL", url)
    with pytest.raises(RuntimeError, match="TARGET_(URL_INVALID|HOST_FORBIDDEN)"):
        config.create_supabase_client()
    config.create_client.assert_not_called()


@pytest.mark.parametrize("target", ["local", "testing"])
@pytest.mark.parametrize("url", ["http://127.0.0.1:54321", "http://localhost:54321/", "http://[::1]:54321", "HTTPS://LOCALHOST"])
def test_allowlist_exacta_admite_loopback_con_cliente_simulado(monkeypatch, target, url):
    preparar_ejecucion(monkeypatch)
    monkeypatch.setenv("EQUITAS_TARGET_ENV", target)
    monkeypatch.setenv("SUPABASE_URL", url)
    cliente = Mock()
    monkeypatch.setattr(config, "create_client", Mock(return_value=cliente))
    assert config.create_supabase_client() is cliente
    config.create_client.assert_called_once()


def test_credenciales_se_exigen_solo_para_ejecutar(monkeypatch):
    assert config.get_settings().supabase_url == ""
    preparar_ejecucion(monkeypatch)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY")
    with pytest.raises(RuntimeError, match="SUPABASE_KEY_MISSING"):
        config.create_supabase_client()
    monkeypatch.setenv("SUPABASE_KEY", "CLAVE_ALTERNATIVA_FICTICIA")
    assert config.get_settings(execute=True).supabase_service_role_key == "CLAVE_ALTERNATIVA_FICTICIA"
    assert "CLAVE_ALTERNATIVA_FICTICIA" not in repr(config.get_settings(execute=True))


def test_cliente_perezoso_revalida_destino_aun_con_cache(monkeypatch):
    preparar_ejecucion(monkeypatch)
    cliente = Mock()
    monkeypatch.setattr(config, "create_client", Mock(return_value=cliente))
    config.supabase.table("person")
    config.supabase.table("debt")
    config.create_client.assert_called_once()
    monkeypatch.setenv("SUPABASE_URL", f"https://{ORIGINAL}.supabase.co")
    monkeypatch.setenv("SUPABASE_PROJECT_REF", "REFERENCIA_FICTICIA_PERMITIDA")
    monkeypatch.setenv("EQUITAS_ALLOW_ORIGINAL", "true")
    with pytest.raises(RuntimeError, match="TARGET_ORIGINAL_FORBIDDEN"):
        config.supabase.table("person")
    assert cliente.table.call_count == 2


def test_execute_lee_dotenv_solo_al_usar_configuracion(monkeypatch):
    # Registrar también las variables inicialmente ausentes para restaurarlas.
    for name in ("EQUITAS_TARGET_ENV", "SUPABASE_URL", "SUPABASE_KEY"):
        monkeypatch.setenv(name, "MARCADOR_SINTETICO")
        monkeypatch.delenv(name)
    config.ENV_PATH.write_text(
        "EQUITAS_TARGET_ENV=local\nSUPABASE_URL=http://localhost:54321\n"
        "SUPABASE_KEY=CLAVE_FICTICIA_EN_ARCHIVO\n"
    )
    assert config.get_settings().supabase_service_role_key == ""
    assert config.get_settings(execute=True).supabase_service_role_key == "CLAVE_FICTICIA_EN_ARCHIVO"


def test_dry_run_real_desde_tsv_sin_credenciales(monkeypatch, tmp_path, capsys):
    cabecera, detalle = fuente_sintetica()
    carpeta = tmp_path / "sintetico"
    carpeta.mkdir()
    pd.DataFrame([cabecera]).to_csv(carpeta / "cabecera.tsv", sep="\t", index=False)
    pd.DataFrame([detalle]).to_csv(carpeta / "detalle.tsv", sep="\t", index=False)
    monkeypatch.setattr(extract, "settings", replace(extract.settings, input_dir=tmp_path))
    monkeypatch.setattr(config, "load_dotenv", Mock(side_effect=AssertionError("No debe leer .env")))
    run_etl.run_etl("sintetico")
    salida = capsys.readouterr()
    comprobar_salida_segura(salida.out + salida.err)
    assert "DRY-RUN FINALIZADO" in salida.out
    config.create_client.assert_not_called()


# ALIGN-026: reemplaza la omisión fila por fila del cargador. Una fila sin clave ahora la rechaza el validador,
# con código por fila y objeto en cuarentena, antes de cualquier escritura.
@pytest.mark.parametrize(("columna", "codigo"), [
    ("Destinatario_Id", "IDENTIFICADOR_INVALIDO"), ("Cuenta", "CUENTA_NO_CANONICA"), ("Bien_Tipo_Id", "CAMPO_OBLIGATORIO_VACIO"),
])
def test_filas_sin_clave_se_rechazan_con_codigo_y_sin_datos(monkeypatch, capsys, tmp_path, columna, codigo):
    preparar_ejecucion(monkeypatch)
    simular_carga(monkeypatch)
    objeto, carpeta = lote_con_centinelas(tmp_path)
    (carpeta / "cabecera.tsv").write_text(
        "\n".join(_vaciar_celda(linea, columna, objeto) for linea in (carpeta / "cabecera.tsv").read_text("utf-8").splitlines()) + "\n",
        "utf-8",
    )
    run_etl.run_etl(str(carpeta), execute=True, cut_off=AS_OF)
    salida = capsys.readouterr()
    comprobar_salida_segura(salida.out + salida.err)
    assert f"Rechazo {codigo}: 1" in salida.out
    registradas = [llamada.args[0].get("full_name") for llamada in run_etl.load_person.call_args_list]
    assert CENTINELAS[0] not in registradas


def _vaciar_celda(linea, columna, objeto, encabezado=[]):  # noqa: B006
    celdas = linea.split("\t")
    if not encabezado:
        encabezado.extend(celdas)
    if celdas[0] == objeto:
        celdas[encabezado.index(columna)] = ""
    return "\t".join(celdas)


def test_error_del_proveedor_no_sale_en_cli_ni_traceback(monkeypatch, capsys, tmp_path):
    preparar_ejecucion(monkeypatch)
    simular_carga(monkeypatch)
    _, carpeta = lote_con_centinelas(tmp_path)
    monkeypatch.setattr(run_etl, "load_person", Mock(side_effect=RuntimeError(" ".join(CENTINELAS))))
    with pytest.raises(RuntimeError) as error:
        run_etl.run_etl(str(carpeta), execute=True, cut_off=AS_OF)
    comprobar_salida_segura("".join(traceback.format_exception(error.value)))
    monkeypatch.setattr(sys, "argv", ["etl", "--execute", "--folder", str(carpeta), "--cut-off", AS_OF])
    with pytest.raises(SystemExit) as exit_info:
        run_etl.main()
    assert exit_info.value.code == 1
    salida = capsys.readouterr()
    comprobar_salida_segura(salida.out + salida.err)
    assert re.search(r"fila=2 clave_hash=[0-9a-f]{24} codigo=ETL_FAILED", salida.err)


def test_execute_completo_preserva_payloads_y_no_los_imprime(monkeypatch, capsys, tmp_path):
    preparar_ejecucion(monkeypatch)
    simular_carga(monkeypatch)
    _, carpeta = lote_con_centinelas(tmp_path)
    run_etl.run_etl(str(carpeta), execute=True, cut_off=AS_OF)
    assert CENTINELAS[0] in [llamada.args[0]["full_name"] for llamada in run_etl.load_person.call_args_list]
    salida = capsys.readouterr()
    comprobar_salida_segura(salida.out + salida.err)
    assert "CARGA FINALIZADA" in salida.out


def test_falla_del_registro_de_una_falla_no_oculta_la_causa(monkeypatch, capsys, tmp_path):
    preparar_ejecucion(monkeypatch)
    simular_carga(monkeypatch)
    _, carpeta = lote_con_centinelas(tmp_path)
    monkeypatch.setattr(run_etl, "load_person", Mock(side_effect=config.ETLError("CAUSA_ORIGINAL")))
    monkeypatch.setattr(run_etl, "record_import_batch", Mock(side_effect=[1, RuntimeError(CENTINELAS[0])]))
    with pytest.raises(config.ETLError) as error:
        run_etl.run_etl(str(carpeta), execute=True, cut_off=AS_OF)
    assert error.value.code == "CAUSA_ORIGINAL"
    salida = capsys.readouterr()
    comprobar_salida_segura(salida.out + salida.err)
    assert "IMPORT_BATCH_FAILURE_NOT_RECORDED" in salida.out


@pytest.mark.parametrize("operacion", ["insertar", "actualizar", "bulk", "respuesta", "clave", "persona"])
def test_errores_de_load_no_revelan_payloads(monkeypatch, capsys, operacion):
    payload = dict(zip(("name", "document", "email", "phone"), CENTINELAS, strict=True))
    cliente = Mock()
    cliente.table.return_value = cliente
    cliente.insert.return_value = cliente
    cliente.update.return_value = cliente
    cliente.eq.return_value = cliente
    cliente.execute.return_value = SimpleNamespace(data=[])
    monkeypatch.setattr(load, "supabase", cliente)
    operaciones = {
        "insertar": lambda: load.insert_row("person", payload),
        "actualizar": lambda: load.update_row("person", 1, payload),
        "bulk": lambda: load.bulk_insert_rows("person", [payload]),
        "respuesta": lambda: load.get_first_response_row(CENTINELAS, "person", "select"),
        "clave": lambda: load.normalize_debt_key(payload),
        "persona": lambda: load.load_person(payload),
    }
    with pytest.raises((ValueError, RuntimeError)) as error:
        operaciones[operacion]()
    salida = capsys.readouterr()
    comprobar_salida_segura(salida.out + salida.err + "".join(traceback.format_exception(error.value)))
    assert "codigo=" in str(error.value)


def test_reintentos_no_exponen_mensaje_ni_nombre_de_operacion(monkeypatch, capsys):
    monkeypatch.setattr(load.time, "sleep", lambda _: None)
    operacion = Mock(side_effect=httpx.ConnectError(" ".join(CENTINELAS)))
    with pytest.raises(httpx.ConnectError) as error:
        load.execute_supabase_operation(" ".join(CENTINELAS), operacion)
    assert operacion.call_count == load.MAX_SUPABASE_ATTEMPTS
    salida = capsys.readouterr()
    comprobar_salida_segura(salida.out + salida.err + "".join(traceback.format_exception(error.value)))
    assert "SUPABASE_RETRY" in salida.out


@pytest.mark.parametrize(("nombre", "payload", "codigo"), [
    ("normalize_debt_key", {"debtor": 1}, "DEBT_EXTERNAL_ID_MISSING"),
    ("normalize_debt_key", {"debtor": 1, "external_id": CENTINELAS[1]}, "DEBT_KEY_INVALID"),
    ("load_debtor", {}, "DEBTOR_TENANT_MISSING"),
    ("load_debtor", {"tenant": 1}, "DEBTOR_TYPE_MISSING"),
    ("load_debtor", {"tenant": 1, "type": 6}, "DEBTOR_EXTERNAL_ID_MISSING"),
    ("load_debtor_person", {}, "RELATION_DEBTOR_MISSING"),
    ("load_debtor_person", {"debtor": 1}, "RELATION_PERSON_MISSING"),
    ("load_debt", {}, "DEBT_DEBTOR_MISSING"),
    ("load_debt", {"debtor": 1}, "DEBT_EXTERNAL_ID_MISSING"),
    ("load_province", {}, "PROVINCE_NAME_MISSING"),
    ("load_city", {}, "CITY_PROVINCE_MISSING"),
    ("load_city", {"province": 1}, "CITY_NAME_MISSING"),
    ("load_address", {}, "ADDRESS_PERSON_MISSING"),
    ("load_debtor_contact", {}, "CONTACT_PERSON_MISSING"),
    ("load_debtor_contact", {"person": 1}, "CONTACT_TYPE_MISSING"),
    ("load_debtor_contact", {"person": 1, "type": 1}, "CONTACT_VALUE_MISSING"),
    ("load_debtor_profile_detail", {}, "DETAIL_PROFILE_MISSING"),
    ("load_debtor_profile_detail", {"debtor_profile": 1}, "DETAIL_PERSON_MISSING"),
])
def test_validaciones_de_payload_solo_exponen_codigos(nombre, payload, codigo):
    with pytest.raises(ValueError, match="codigo=" + codigo) as error:
        getattr(load, nombre)({**payload, "dato_sintetico": CENTINELAS})
    comprobar_salida_segura("".join(traceback.format_exception(error.value)))


@pytest.mark.parametrize("retry", [False, True])
def test_error_remoto_arbitrario_sin_detalles(retry):
    operacion = Mock(side_effect=ValueError(" ".join(CENTINELAS)))
    with pytest.raises(config.ETLError, match="codigo=SUPABASE_OPERATION_FAILED") as error:
        load.execute_supabase_operation("consulta", operacion, retry=retry)
    assert operacion.call_count == 1
    comprobar_salida_segura("".join(traceback.format_exception(error.value)))


def test_codigos_de_error_controlados_se_conservan():
    operacion = Mock(side_effect=config.ETLError("ROW_ID_MISSING", load.etl_message("ROW_ID_MISSING")))
    with pytest.raises(config.ETLError, match="codigo=ROW_ID_MISSING"):
        load.execute_supabase_operation("consulta", operacion)


def test_respuestas_invalidas_y_catalogos_no_imprimen_valores(monkeypatch):
    cliente = Mock()
    for metodo in ("table", "select", "in_", "insert", "eq", "limit", "order", "range"):
        getattr(cliente, metodo).return_value = cliente
    cliente.execute.return_value = SimpleNamespace(data={"datos": CENTINELAS})
    monkeypatch.setattr(load, "supabase", cliente)
    with pytest.raises(config.ETLError, match="BULK_RESPONSE_INVALID") as error:
        load.bulk_insert_rows("person", [{"datos": CENTINELAS}])
    comprobar_salida_segura(str(error.value))
    with pytest.raises(config.ETLError, match="READ_RESPONSE_INVALID") as error:
        load.fetch_existing_debts_by_key([{"debtor": 1, "external_id": 2}])
    comprobar_salida_segura(str(error.value))
    with pytest.raises(ValueError, match="FILTER_NULL"):
        load.fetch_one("person", {"name": None, "value": CENTINELAS})
    cliente.execute.return_value = SimpleNamespace(data=[])
    with pytest.raises(config.ETLError, match="CATALOG_KEY_MISSING") as error:
        load.get_catalog_id_by_key("catalogo", CENTINELAS[0])
    comprobar_salida_segura(str(error.value))
    cliente.execute.return_value = SimpleNamespace(data=[{"key": CENTINELAS[0]}])
    with pytest.raises(config.ETLError, match="CATALOG_ID_MISSING") as error:
        load.get_catalog_id_by_key("catalogo", CENTINELAS[0])
    comprobar_salida_segura(str(error.value))


def test_hash_y_contexto_no_conservan_fila_de_otra_ejecucion():
    original = load.etl_message("PRUEBA")
    token = load.set_log_context(7, CENTINELAS)
    try:
        assert load.hash_key(CENTINELAS) == load.hash_key(CENTINELAS)
        assert load.hash_key(CENTINELAS) != load.hash_key(("OTRA_CLAVE_SINTETICA",))
        mensaje = load.etl_message("PRUEBA")
        assert "fila=7" in mensaje
        comprobar_salida_segura(mensaje)
    finally:
        load.reset_log_context(token)
    assert load.etl_message("PRUEBA") == original


def test_la_campana_contra_la_base_queda_fuera_de_la_suite_aislada():
    ajustes = configparser.ConfigParser()
    ajustes.read(Path(__file__).parents[1] / "pytest.ini", encoding="utf-8")
    assert ajustes["pytest"]["testpaths"].split() == ["tests"]
    assert (Path(__file__).parents[1] / "tests_real" / "test_etl_v1_load.py").is_file()
