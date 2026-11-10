"""Carga de un lote CSV en un solo paso (noche 7): recibe, valida y publica, o no cambia nada.

Es el recorrido de «Cargar CSV» de la aplicación. No hay asistente, vista previa ni editor de mapeo:
ejecuta lo mismo que la terminal (`ETL.run_etl --execute`):

- lectura, validación y transformación con `prepare_batch`, en el proceso hijo sin credenciales;
- publicación atómica con `stage_import_batch` y `publish_import_batch`; ante una falla al publicar,
  `settle_import_batch` espera el resultado durable, igual que `ETL.publication.publish_batch`.

Lo que cambia respecto de la terminal: el municipio y la persona salen de la sesión (nunca del
cuerpo ni de variables de entorno), el perfil de formato es el CSV sintético versionado, y cada
resultado vuelve como datos que la pantalla puede mostrar.

Ninguna secuencia deja al municipio sin fecha de cartera: un rechazo se registra como FALLIDO sin
antecedente, y los eventos de staging llevan la marca atómica que `equitas_current_cutoff` salta.
El destino lo valida `api.auth.load_config` en cada solicitud: solo la base local.
"""

import copy
import json
import logging
import re
import uuid
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError
from starlette.concurrency import run_in_threadpool

from api import imports
from api.auth import (
    ImporterContext,
    Session,
    SessionDep,
    TenantContext,
    UserClientDep,
    resolve_tenant_context,
    session_for_token,
)
from api.upload_store import UploadStore, UploadStoreBusy
from ETL.config import PROJECT_ROOT, ETLError
from ETL.transform import CATALOG_KEY_COLUMNS, canonical_json_hash, source_contract
from services.decision_rules_v1 import RULES_VERSION
from services.import_preview_process import PreviewSourceError, prepare_input

logger = logging.getLogger("equitas.api")

router = APIRouter(prefix="/imports", tags=["imports"])

# Formato único de esta versión: el perfil CSV sintético del repositorio. Sus catálogos y su
# validación no se tocan; solo se le declara la fecha de cartera que indica quien carga.
PROFILE_PATH = PROJECT_ROOT / "contracts" / "source-mapping.sintetico-csv.v1.json"
# El lote representa la cartera completa: si falta un objeto ya cargado, se rechaza sin escribir.
ABSENT_POLICY = "rechazar"
FORM_FIELDS = frozenset({"as_of", "revision"})
REVISION = re.compile(r"[0-9a-f]{64}")
# Tope de `stage_import_batch` (filas normalizadas: personas más objetos). Se informa antes de fallar.
MAX_STAGED_ROWS = 200_000
# La función de publicación tiene 60 s de cómputo: el cliente espera un poco más para leer su respuesta.
RPC_SECONDS = 75.0
CLOSED_STATES = frozenset({"FALLIDO", "DESCARTADO", "REQUIERE_NUEVO_PREVIEW"})
ROLE_REJECTIONS = frozenset({"ACTOR_NOT_ACTIVE_MEMBER", "ROLE_NOT_ALLOWED"})

# Resultados que ve la pantalla. Cada uno dice qué pasó con la cartera.
PUBLISHED = "PUBLICADO"
ALREADY_LOADED = "YA_CARGADO"
REJECTED = "RECHAZADO"
NEEDS_CONFIRMATION = "REQUIERE_CONFIRMACION"
# Se sabe que esta carga no escribió cartera.
NOT_COMPLETED = "NO_COMPLETADO"
# No se sabe si la publicación confirmó: repetir la misma carga lo resuelve sin duplicar.
NOT_CONFIRMED = "NO_CONFIRMADO"

# Lo único que se afirma es lo demostrable: qué hizo ESTA carga. La cartera pudo cambiar por otra vía.
NOT_MODIFIED = "Esta carga no modificó la cartera ni su fecha."

STRUCTURAL_MESSAGES = {
    "ARCHIVOS_REQUERIDOS": "El lote necesita los dos archivos: cabecera y detalle.",
    "ARCHIVO_NO_LEIBLE": "El archivo no se pudo leer con la codificación y el separador del formato.",
    "CONTENIDO_NO_TEXTO": "El archivo no es un CSV de texto (parece binario o tiene otra codificación).",
    "ESTRUCTURA_INVALIDA": "La estructura no coincide: revisá el separador, las comillas y que todas las filas tengan las mismas columnas que el encabezado.",
    "COLUMNA_OBLIGATORIA_AUSENTE": "Falta una columna obligatoria en el encabezado del archivo. Revisá también que el separador sea el del formato.",
    "LIMITE_ARCHIVO_EXCEDIDO": "El archivo supera los límites de tamaño, filas, columnas o longitud de celda.",
    "TIEMPO_LECTURA_EXCEDIDO": "El archivo tardó demasiado en leerse.",
    "FORMATO_NO_SOPORTADO": "El formato no está soportado: en esta versión el lote son dos archivos CSV.",
    "FORMATO_XLS_NO_SOPORTADO": "Los archivos de Excel no están soportados en esta versión: exportá a CSV.",
    "MACRO_NO_PERMITIDA": "Los archivos con macros no están permitidos.",
}
BLOCKER_FALLBACK = "El lote no cumple una condición necesaria para publicarse."


class _Rejected(Exception):
    """La base rechazó la operación con un código estable. Nada de esa llamada quedó escrito."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class _Unavailable(Exception):
    """No hubo respuesta utilizable: el resultado de esa llamada no se conoce."""


def _rpc(session: Session, name: str, params: dict[str, Any]) -> dict[str, Any]:
    writer = imports.writer_client(session.config)
    writer.session.timeout = httpx.Timeout(RPC_SECONDS)
    try:
        data = writer.rpc(name, params).execute().data
        if not isinstance(data, dict):
            raise TypeError("Respuesta inválida")
        return data
    except APIError as error:
        raise _Rejected(str(error.message)) from None
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        raise _Unavailable() from None
    finally:
        writer.session.close()


def _outcome(status: int, result: str, message: str, **fields: Any) -> JSONResponse:
    return JSONResponse(status_code=status, content={"resultado": result, "mensaje": message, **fields})


def _not_completed(message: str, code: str, **fields: Any) -> JSONResponse:
    return _outcome(503, NOT_COMPLETED, message, codigo=code, **fields)


def _profile(as_of: str) -> dict[str, Any]:
    profile = copy.deepcopy(json.loads(PROFILE_PATH.read_text(encoding="utf-8")))
    profile["fecha_corte"] = as_of
    return profile


# ---- Hallazgos de validación: qué puede corregir la persona


def _findings(detail: dict[str, Any]) -> dict[str, Any]:
    """Errores (excluyen o bloquean) y advertencias (se cargan igual). Los totales los calculó el proceso de
    validación sobre TODOS los hallazgos; el detalle puede venir acotado y se declara."""
    codes = source_contract()["codigos"]
    described = lambda code: codes.get(code, {}).get("descripcion", code)
    groups: dict[str, Any] = {}
    for name, effect_is_warning in (("errores", False), ("advertencias", True)):
        totals = detail["totales"][name]
        groups[name] = {
            "total": sum(totals.values()),
            "por_codigo": sorted(({"codigo": code, "descripcion": described(code), "cantidad": count}
                                  for code, count in totals.items()), key=lambda item: (-item["cantidad"], item["codigo"])),
            "detalle": [{"archivo": item["archivo"], "linea": item["linea"], "columna": item["campo"], "codigo": item["codigo"],
                         "descripcion": described(item["codigo"]), "efecto": item["efecto"]}
                        for item in detail["hallazgos"] if (item["efecto"] == "ALERTA") == effect_is_warning],
        }
    return {**groups, "hallazgos_total": detail["hallazgos_total"], "hallazgos_mostrados": len(detail["hallazgos"]),
            "truncado": detail["hallazgos_total"] > len(detail["hallazgos"])}


def _summary(prepared: dict[str, Any]) -> dict[str, Any]:
    counts = prepared["validation"]["conteos"]
    return {"objetos": counts.get("objetos"), "objetos_aceptados": counts.get("objetos_aceptados"),
            "objetos_en_cuarentena": counts.get("objetos_en_cuarentena"), "personas": counts.get("personas"),
            "obligaciones": counts.get("obligaciones_unicas"), "filas": prepared["detail"]["filas"]}


def _report(prepared: dict[str, Any]) -> dict[str, Any]:
    """Resumen y hallazgos, armados ANTES de escribir nada: después de publicar no queda cómputo que pueda fallar."""
    return {"resumen": _summary(prepared), **_findings(prepared["detail"])}


def _blockers(codes: list[str]) -> list[dict[str, str]]:
    contract = source_contract()
    described = {**{code: spec.get("descripcion", "") for code, spec in contract["codigos"].items()},
                 **contract.get("codigos_resumen", {})}
    return [{"codigo": code, "descripcion": described.get(code) or BLOCKER_FALLBACK} for code in codes]


# ---- Intento cerrado: un rechazo queda registrado y no toca la fecha de cartera


def _register_rejection(session: Session, context: TenantContext, form: imports.ReceivedForm,
                        as_of: str, counts: dict[str, Any]) -> bool:
    """FALLIDO sin antecedente, como la terminal: `equitas_current_cutoff` lo ignora. La clave es determinista
    por persona, archivos, fecha y reglas: repetir el mismo archivo rechazado no agrega eventos, y el intento
    de otra persona queda registrado a su nombre."""
    key = uuid.uuid5(uuid.NAMESPACE_URL, "equitas:carga-rechazada:{}:{}:{}:{}:{}:{}".format(
        context.tenant_id, context.user_id, form.hashes.get("cabecera"), form.hashes.get("detalle"), as_of, RULES_VERSION))
    try:
        imports._write_batch(session.config, context, file_hashes=form.hashes, as_of=as_of,
                             status="FALLIDO", idempotency_key=str(key), counts=counts)
    except HTTPException as error:
        if error.status_code == 403:
            raise
        if error.detail == "IDEMPOTENCY_KEY_CONFLICT":
            return True  # El mismo intento ya estaba registrado (con otros conteos): no se duplica.
        # El archivo ya fue rechazado y esta carga no escribió cartera: se informa igual, declarando que no quedó registrado.
        logger.error("IMPORT_RECHAZO_SIN_REGISTRO codigo=%s", error.detail)
        return False
    return True


def _structural_rejection(error: PreviewSourceError, as_of: str, registered: bool) -> JSONResponse:
    code = str(error)
    location = error.location or {}
    return _outcome(
        422, REJECTED, f"El lote no se cargó: un archivo no tiene la forma esperada. {NOT_MODIFIED}",
        fecha_corte=as_of, intento_registrado=registered,
        estructura={"codigo": code, "descripcion": STRUCTURAL_MESSAGES.get(code, "El archivo no se pudo interpretar como un lote."),
                    "archivo": location.get("archivo"), "linea": location.get("linea") or None,
                    "columna": None if location.get("campo") in (None, "*") else location.get("campo")},
    )


# ---- Publicación


def _check_catalogs(client: SyncPostgrestClient, required: dict[str, list[str]]) -> list[str]:
    """Claves que el lote necesita y la base no tiene, leídas con el token de la persona. Evita que un
    catálogo incompleto llegue a la publicación y vuelva como una falla sin explicación."""
    missing = []
    for table, keys in sorted(required.items()):
        column = CATALOG_KEY_COLUMNS[table]
        rows = client.table(table).select(column).execute().data
        if not isinstance(rows, list):
            raise TypeError("Respuesta inválida")
        present = {row[column] for row in rows}
        missing += [f"{table}:{key}" for key in keys if key not in present]
    return missing


def _previous_attempt(session: Session, context: TenantContext, identity_key: str) -> dict[str, Any] | None:
    """Recibo del intento anterior del MISMO lote (misma identidad), si quedó cerrado sin publicar. Solo sirve
    para que la persona decida reintentarlo de forma explícita (equivale a `--revalidate` de la terminal).
    `read_import_receipt` es de solo lectura: no escribe eventos ni toca la cartera."""
    try:
        receipt = _rpc(session, "read_import_receipt", {"p_actor_user": context.user_id, "p_tenant": context.tenant_id,
                                                        "p_idempotency_key": identity_key})
    except _Rejected:
        return None
    if (receipt.get("status") in CLOSED_STATES and isinstance(receipt.get("revision"), str)
            and REVISION.fullmatch(receipt["revision"])):
        return receipt
    return None


def _stage(prepared: dict[str, Any], document: dict[str, Any], revision: str | None, context: TenantContext,
           session: Session, identity_key: str) -> dict[str, Any] | JSONResponse:
    as_of = document["identity"]["parameters"]["as_of"]
    try:
        return _rpc(session, "stage_import_batch", {
            "p_actor_user": context.user_id, "p_tenant": context.tenant_id, "p_document": document,
            "p_rows": prepared["rows"], "p_expected_revision": revision})
    except _Rejected as error:
        if error.code in ROLE_REJECTIONS:
            raise HTTPException(403, "ROLE_FORBIDDEN") from None
        if error.code == "IMPORT_REVALIDATION_REQUIRED":
            try:
                previous = _previous_attempt(session, context, identity_key)
            except _Unavailable:
                previous = None
            if previous is None:
                return _not_completed(f"Este lote tuvo un intento anterior que no se completó y no se pudo leer su referencia. {NOT_MODIFIED} Repetí la carga en unos minutos.",
                                      "INTENTO_ANTERIOR_SIN_REFERENCIA")
            return _outcome(409, NEEDS_CONFIRMATION,
                            f"Este mismo lote ya se intentó cargar y ese intento no se completó. {NOT_MODIFIED} Si querés, reintentalo.",
                            fecha_corte=as_of, revision=previous["revision"], estado_anterior=previous["status"])
        if error.code == "IMPORT_REVISION_CONFLICT":
            return _outcome(409, NEEDS_CONFIRMATION,
                            f"La referencia del reintento ya no sirve: el lote o la cartera cambiaron desde ese intento. {NOT_MODIFIED} Volvé a elegir los archivos y cargalos de nuevo.",
                            fecha_corte=as_of, revision=None, estado_anterior=None)
        if error.code == "SHARED_PERSON_OTHER_TENANT":
            return _outcome(422, REJECTED, f"El lote no se cargó: incluye personas que ya pertenecen a la cartera de otro municipio. {NOT_MODIFIED}",
                            fecha_corte=as_of,
                            motivos=[{"codigo": error.code, "descripcion": "Una persona del archivo ya está registrada en otro municipio."}])
        if error.code == "IMPORT_RETRY_REQUIRED":
            return _not_completed(f"La base estaba ocupada y la carga no se completó. {NOT_MODIFIED} Repetí la misma carga.", error.code)
        return _not_completed(f"No se pudo preparar la publicación. {NOT_MODIFIED} No es un problema del archivo: repetí la misma carga.", "STAGING_NO_DISPONIBLE")
    except _Unavailable:
        # Staging nunca escribe cartera: aunque su resultado no se conozca, esta carga no la modificó.
        return _not_completed(f"No se pudo completar la carga. {NOT_MODIFIED} Repetí la misma carga.", "SERVICIO_NO_DISPONIBLE")


def _publish(prepared: dict[str, Any], report: dict[str, Any], as_of: str, revision: str | None,
             context: TenantContext, session: Session, client: SyncPostgrestClient) -> JSONResponse:
    document = {**prepared["document"], "source": imports.SOURCE_WEB}
    # Misma huella que calcula la base sobre la identidad (JSON canónico compartido).
    identity_key = canonical_json_hash(document["identity"])
    review = _stage(prepared, document, revision, context, session, identity_key)
    if isinstance(review, JSONResponse):
        return review
    status, batch_id = review.get("status"), review.get("batch_id")
    if status == "PUBLICADO":
        return _outcome(200, ALREADY_LOADED, "Este mismo lote ya estaba cargado con esa fecha. No cambió nada.",
                        fecha_corte=as_of, lote=batch_id, publicado=review.get("counts", {}), **report)
    if status == "FALLIDO":
        return _outcome(422, REJECTED,
                        f"El lote no se cargó: no trae todo lo que ya está en la cartera, y cada lote representa la cartera completa. {NOT_MODIFIED}",
                        fecha_corte=as_of, lote=batch_id, ausentes=review.get("counts", {}).get("ausentes", {}),
                        motivos=[{"codigo": "PARTIAL_LOAD_REJECTED",
                                  "descripcion": "Faltan objetos, obligaciones o titulares que la cartera ya tiene. Incluilos en el archivo y volvé a cargarlo."}],
                        **report)
    if status != "VALIDADO" or type(batch_id) is not int or not isinstance(review.get("revision"), str):
        return _not_completed(f"La preparación devolvió un estado inesperado. {NOT_MODIFIED} Repetí la misma carga.", "STAGING_ESTADO_INESPERADO")

    # La sesión se vuelve a confirmar antes de escribir: una revocación durante la validación rige.
    if resolve_tenant_context(client, session_for_token(session.token)) != context:
        raise HTTPException(403, "ROLE_FORBIDDEN")
    reference = {"p_batch_id": batch_id, "p_idempotency_key": identity_key, "p_revision": review["revision"],
                 "p_tenant": context.tenant_id, "p_actor_user": context.user_id}
    # Auditoría ANTES de publicar: sin registro no hay publicación. Registra «confirmación solicitada» por ESTA
    # persona sobre este lote y revisión; el resultado está en la cadena de `import_batch` del mismo lote.
    audit_key = uuid.uuid5(uuid.NAMESPACE_URL, "equitas:import-confirm:{}:{}:{}:{}".format(
        context.tenant_id, context.user_id, batch_id, review["revision"]))
    try:
        audit = _rpc(session, "record_access_audit", {
            "p_actor_user": context.user_id, "p_tenant": context.tenant_id, "p_action": "IMPORT_CONFIRM",
            "p_target": str(batch_id), "p_idempotency_key": str(audit_key)})
        if audit.get("audit_id") is None:
            raise _Unavailable()
    except (_Rejected, _Unavailable):
        return _not_completed(f"No se pudo registrar la auditoría de la carga, así que no se publicó. {NOT_MODIFIED} Repetí la misma carga.",
                              "AUDITORIA_NO_DISPONIBLE")
    try:
        result = _rpc(session, "publish_import_batch", reference)
    except (_Rejected, _Unavailable) as original:
        if isinstance(original, _Rejected) and original.code in ROLE_REJECTIONS:
            # La función autoriza antes de leer el lote: con este rechazo no llegó a escribir nada.
            raise HTTPException(403, "ROLE_FORBIDDEN") from None
        # Como `ETL.publication.publish_batch`: no se inventa un resultado. `settle` espera a que la
        # publicación termine y devuelve su recibo si confirmó; si no, cierra el intento como FALLIDO.
        try:
            result = _rpc(session, "settle_import_batch", {**reference, "p_idempotency_key": review["idempotency_key"],
                                                           "p_status": "FALLIDO"})
        except (_Rejected, _Unavailable):
            return _outcome(503, NOT_CONFIRMED,
                            "No se pudo confirmar si la carga se completó. Repetí la misma carga: si ya había entrado, la aplicación lo va a informar y no se duplica nada.",
                            fecha_corte=as_of, lote=batch_id)
    if result.get("status") == "PUBLICADO":
        logger.info("IMPORT_PUBLICADO lote=%s", batch_id)
        return _outcome(201, PUBLISHED, "La carga se completó. El tablero y los listados ya muestran estos datos.",
                        fecha_corte=as_of, lote=batch_id, publicado=result.get("counts", {}), **report)
    changed = result.get("status") == "REQUIERE_NUEVO_PREVIEW"
    return _not_completed(
        ("La cartera cambió mientras se preparaba esta carga, así que no se publicó. " if changed else "La carga no se completó. ")
        + f"{NOT_MODIFIED} No es un problema del archivo: podés reintentarla.",
        "PUBLICACION_NO_COMPLETADA", fecha_corte=as_of, lote=batch_id, revision=review["revision"], estado=result.get("status"))


def _prepare(form: imports.ReceivedForm, as_of: str, context: TenantContext, session: Session,
             store: UploadStore, lock_fd: int) -> dict[str, Any] | JSONResponse:
    """Lee, valida y transforma. Devuelve el lote preparado o la respuesta de rechazo; nunca escribe cartera."""
    try:
        prepared = prepare_input(store.incoming_files(form.token), _profile(as_of), context.tenant_id,
                                 ABSENT_POLICY, lock_fd=lock_fd)
    except PreviewSourceError as error:
        return _structural_rejection(error, as_of, _register_rejection(session, context, form, as_of, {}))
    except imports.STORE_ERRORS:
        raise HTTPException(503, imports.STORE_UNAVAILABLE) from None
    except ETLError as error:
        if str(error) in ("PREVIEW_TIME_LIMIT", "PREVIEW_WORK_LIMIT"):
            # Un lote que supera un límite es un rechazo del lote: el intento queda registrado y cerrado, como los demás.
            registered = _register_rejection(session, context, form, as_of, {})
            return _outcome(422, REJECTED, f"El lote es demasiado grande para procesarlo en esta versión (tiempo o memoria). {NOT_MODIFIED}",
                            fecha_corte=as_of, intento_registrado=registered, motivos=[{"codigo": "LIMITE_PROCESO_EXCEDIDO", "descripcion": "Se superó el límite de 180 segundos o de memoria del procesamiento."}])
        return _not_completed(f"No se pudo procesar el lote. {NOT_MODIFIED} No es un problema del archivo: repetí la misma carga.", "PROCESO_NO_DISPONIBLE")
    return prepared


def _load(form: imports.ReceivedForm, as_of: str, revision: str | None, context: TenantContext,
          session: Session, client: SyncPostgrestClient, store: UploadStore) -> JSONResponse:
    try:
        # Un solo trabajo pesado a la vez: una segunda carga simultánea no se encola ni se mezcla.
        with store.processing_slot() as lock_fd:
            prepared = _prepare(form, as_of, context, session, store, lock_fd)
            if isinstance(prepared, JSONResponse):
                return prepared
            report = _report(prepared)
            if not prepared["publishable"]:
                registered = _register_rejection(session, context, form, as_of, prepared["document"]["counts"])
                return _outcome(422, REJECTED, f"El lote no se cargó porque tiene errores. {NOT_MODIFIED} Corregí el archivo y volvé a cargarlo.",
                                fecha_corte=as_of, intento_registrado=registered,
                                motivos=_blockers(prepared["validation"]["motivos_bloqueo"]), **report)
            if len(prepared["rows"]) > MAX_STAGED_ROWS:
                registered = _register_rejection(session, context, form, as_of, prepared["document"]["counts"])
                return _outcome(422, REJECTED, f"El lote supera el máximo de {MAX_STAGED_ROWS} registros (personas más objetos) de esta versión. {NOT_MODIFIED}",
                                fecha_corte=as_of, intento_registrado=registered, resumen=report["resumen"],
                                motivos=[{"codigo": "LIMITE_REGISTROS_EXCEDIDO", "descripcion": "Dividir el lote no es posible: cada lote es la cartera completa. Es un límite de esta versión."}])
            try:
                missing = _check_catalogs(client, prepared["detail"]["catalogos"])
            except (APIError, httpx.HTTPError, KeyError, TypeError, ValueError, AttributeError):
                return _not_completed(f"No se pudieron leer los catálogos de la base. {NOT_MODIFIED} Repetí la misma carga.", "CATALOGOS_NO_DISPONIBLES")
            if missing:
                return _not_completed(f"La base no tiene catálogos que este formato necesita. {NOT_MODIFIED} Es un problema de configuración del entorno, no del archivo.",
                                      "CATALOGO_INCOMPLETO", faltantes=missing)
            return _publish(prepared, report, as_of, revision, context, session, client)
    except UploadStoreBusy:
        return _outcome(429, NOT_COMPLETED, f"Ya hay una carga en curso en este servicio. {NOT_MODIFIED} Esperá a que termine y repetí la carga.",
                        codigo="CARGA_EN_CURSO")


def _revision(fields: dict[str, str]) -> str | None:
    value = fields.get("revision")
    if value is None or value == "":
        return None
    if not REVISION.fullmatch(value):
        raise HTTPException(422, "REVISION_INVALIDA")
    return value


@router.post("/load")
async def load_import(request: Request, context: ImporterContext, session: SessionDep,
                      client: UserClientDep) -> JSONResponse:
    """Se autoriza antes de leer un byte del cuerpo: `Depends` corre primero."""
    boundary = imports._boundary(request)
    imports._check_declared_size(request)
    # La credencial de escritura se comprueba antes de recibir los archivos: sin ella no se recibe nada.
    imports.writer_client(session.config).session.close()
    store = imports.load_store()
    await run_in_threadpool(imports.purge_once)
    form = await imports._receive_form(request, boundary, store, FORM_FIELDS)
    try:
        as_of = imports._declared_date(form.fields, "as_of", "AS_OF_INVALIDO")
        if as_of is None:
            raise HTTPException(422, "AS_OF_INVALIDO")
        revision = _revision(form.fields)
        if set(form.hashes) == {"libro"}:
            raise HTTPException(422, "FORMATO_NO_SOPORTADO")
        if set(form.hashes) != {"cabecera", "detalle"}:
            raise HTTPException(422, "ARCHIVOS_REQUERIDOS")
        return await run_in_threadpool(_load, form, as_of, revision, context, session, client, store)
    finally:
        store.discard(form.token)
