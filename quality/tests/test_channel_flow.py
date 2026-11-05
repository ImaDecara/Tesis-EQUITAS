"""Contrato del canal con el deudor ALIGN-047: esquema, flujo, textos, datos mínimos, retención y documento."""

import copy
import functools
import itertools
import json
import random
import re
import unicodedata
import unittest
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / 'contracts/channel-flow.v1.json'
SCHEMA = ROOT / 'contracts/channel-flow.v1.schema.json'
DOCUMENT = ROOT / 'docs/tesis/canal-deudor-diseno.md'
DRAFT_MARK = 'Borrador — pendiente de aprobación (ALIGN-047, compuerta antes de cerrar)'

KEYWORDS = {'$schema', '$id', '$ref', '$defs', 'title', 'description', 'type', 'properties', 'required',
            'additionalProperties', 'items', 'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minimum',
            'maximum', 'minItems', 'maxItems', 'uniqueItems'}
TYPES = {'object': dict, 'array': list, 'string': str, 'boolean': bool, 'null': type(None)}
PLACEHOLDER = re.compile(r'\{([a-z_]+)\}')
CONTROL = {'Cc', 'Cf', 'Cs', 'Co', 'Cn'}
REQUIRED_NOT_DONE = {'NO_INFORMA_DEUDA', 'NO_CONFIRMA_EXISTENCIA', 'NO_CONSULTA_CARTERA', 'NO_PIDE_IDENTIFICACION',
                     'NO_COBRA', 'NO_DECIDE', 'NO_EJECUTA_INTERVENCIONES', 'NO_ENVIA_MENSAJES', 'NO_USA_LLM',
                     'NO_PROMETE', 'NO_AMENAZA', 'NO_INFIERE_VULNERABILIDAD', 'NO_VINCULA_AUTOMATICAMENTE',
                     'NO_RASTREA', 'NO_SE_PRESENTA_COMO_PERSONA', 'NO_USA_TERCEROS', 'NO_ALIMENTA_REGLAS_NI_MODELOS'}
# Contraejemplos de buzones independientes: no se deduplican ni comparten el límite.
MAILBOX_SCENARIOS = {'ESC-BUZONES-MISMO-MOTIVO': (['RECIBIDA'] * 4, 4), 'ESC-BUZONES-MOTIVOS-DISTINTOS': (['RECIBIDA'] * 4, 4),
                     'ESC-BUZONES-MAYUSCULAS': (['RECIBIDA'] * 2, 2)}
# Validación sobre el valor recibido: lo rechazado no crea solicitud ni toca el cupo del contacto parecido.
RAW_SCENARIOS = {'ESC-UNICODE-MISMO-MOTIVO': (['RECIBIDA', 'INVALIDA'], 1),
                 'ESC-UNICODE-NO-COMPARTE-LIMITE': (['RECIBIDA'] * 3 + ['INVALIDA'], 3),
                 'ESC-UNICODE-NO-CONSUME-CUPO': (['INVALIDA'] * 2 + ['RECIBIDA'] * 3, 3),
                 'ESC-UNICODE-PARTES-LOCALES': (['RECIBIDA'] + ['INVALIDA'] * 3, 1),
                 'ESC-ESPACIO-DURO-TELEFONO': (['RECIBIDA', 'INVALIDA'], 1),
                 'ESC-ESPACIO-DURO-CORREO': (['RECIBIDA', 'INVALIDA', 'INVALIDA'], 1),
                 'ESC-RECORTE-ESPACIOS': (['RECIBIDA'] * 2, 1),
                 'ESC-OTRO-CAMPO-INVALIDO': (['INVALIDA'] + ['RECIBIDA'] * 3, 3)}
# Vectores negativos de review-3.md y del recorte general: su retirada del contrato debe notarse.
REQUIRED_NEGATIVE_VECTORS = {
    'NOMBRE': {'\u00a0Ana', 'Ana\u2028'},
    'TELEFONO': {'\u00a0+54 000 000-0000', '+54 000 000-0000\u2028', '\u0660' * 8, '\uff10' * 8},
    'EMAIL': {'\u212a@example.org', 'K\u212a@example.org', '\u212a+uno@example.org', '\u212ab@gmail.com',
              '\u00a0persona@example.com', 'persona@example.com\u2028'},
    'REFERENCIA': {'\u212a-0001', '\u00a0SINT-0001'},
}
# Reglas de equivalencia de la clave: agregar una exige una justificación nueva en el contrato y cambiar esta lista.
LISTED_KEY_RULES = {'TEL-PRESENTACION', 'TEL-PREFIJO-INTERNACIONAL', 'TEL-PAIS-IMPLICITO', 'TEL-TRONCAL', 'TEL-CELULAR',
                    'TEL-QUINCE', 'EMAIL-RECORTE', 'EMAIL-DOMINIO-MINUSCULAS', 'EMAIL-POLITICA-PROVEEDOR'}
# Posiciones donde un carácter ajeno podría colarse: la primera de cada formato se barre con todo Unicode.
PROBE_TEMPLATES = {
    'EMAIL': ('{}@example.org', 'a{}@example.org', 'a{}b@example.org', '{}a@example.org', 'a@example.org{}', 'a@{}.example.org',
              'a@e{}ample.org', 'a@example.or{}', 'a{}example.org'),
    'TELEFONO': ('{}+54 000 000 0000', '+54 000 000 0000{}', '+54 000{}000 0000', '+54 000 000 000{}', '{}00000000',
                 '+54{}000 000 0000'),
    'REFERENCIA': ('{}-0001', '{}SINT-0001', 'SINT-0001{}', 'SINT{}0001'),
}
# Datos mínimos de la solicitud (plan v2 §7.9, ALIGN-065): campo → obligatorio.
MINIMAL_FIELDS = {'nombre': False, 'medio_preferido': True, 'contacto': True, 'motivo': True, 'referencia': False,
                  'consentimiento': True}


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def ecma_pattern(pattern: str) -> re.Pattern:
    """Compila un pattern ECMA-262 sin banderas con la misma semántica en Python.

    En ECMA-262, `$` solo coincide al final de la entrada; en Python también antes de un salto de línea final,
    así que el `$` final se traduce a `\\Z`. Se rechazan las construcciones cuyo alcance difiere entre los dos
    dialectos (`.`, `\\d`, `\\w`, `\\b`, `\\s`: U+FEFF es espacio solo en ECMA-262 y U+0085, solo en Python) y
    cualquier otro `$`.
    """
    if not (pattern.startswith('^') and pattern.endswith('$')):
        raise ValueError(f'pattern sin anclar: {pattern}')
    body = re.sub(r'\\.', '', pattern[1:-1])
    if '.' in body or '$' in body or re.search(r'\\[dwbsDWBS]', pattern):
        raise ValueError(f'pattern no portable: {pattern}')
    return re.compile(pattern[:-1] + r'\Z')


def json_equal(left, right) -> bool:
    """Igualdad de valores JSON: a diferencia de Python, false no es 0 y true no es 1."""
    if isinstance(left, bool) or isinstance(right, bool):
        return left is right
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(map(json_equal, left, right))
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(json_equal(left[key], right[key]) for key in left)
    return left == right


def schema_errors(value, schema: dict, root: dict, path: str = '$') -> list[str]:
    """Validador del subconjunto de JSON Schema 2020-12 que usa el esquema (KEYWORDS)."""
    if '$ref' in schema:
        target = root
        for part in schema['$ref'].removeprefix('#/').split('/'):
            target = target[part]
        return schema_errors(value, target, root, path)
    errors = []
    if 'type' in schema:
        allowed = schema['type'] if isinstance(schema['type'], list) else [schema['type']]
        ok = any(value is not True and value is not False and isinstance(value, int) if name == 'integer'
                 else isinstance(value, TYPES[name]) for name in allowed)
        if not ok:
            return [f'{path}: tipo {type(value).__name__} no es {allowed}']
    if 'const' in schema and not json_equal(value, schema['const']):
        errors.append(f'{path}: {value!r} distinto de {schema["const"]!r}')
    if 'enum' in schema and not any(json_equal(value, item) for item in schema['enum']):
        errors.append(f'{path}: {value!r} fuera de {schema["enum"]}')
    if isinstance(value, str):
        if len(value) < schema.get('minLength', 0) or len(value) > schema.get('maxLength', len(value)):
            errors.append(f'{path}: longitud {len(value)} fuera de rango')
        if 'pattern' in schema and not ecma_pattern(schema['pattern']).search(value):
            errors.append(f'{path}: {value!r} no cumple {schema["pattern"]}')
    number = isinstance(value, int) and not isinstance(value, bool)
    if number and not schema.get('minimum', value) <= value <= schema.get('maximum', value):
        errors.append(f'{path}: {value} fuera de rango')
    if isinstance(value, list):
        if len(value) < schema.get('minItems', 0) or len(value) > schema.get('maxItems', len(value)):
            errors.append(f'{path}: {len(value)} elementos fuera de rango')
        if schema.get('uniqueItems') and any(json_equal(item, other) for i, item in enumerate(value)
                                             for other in value[i + 1:]):
            errors.append(f'{path}: elementos repetidos')
        for index, item in enumerate(value):
            errors += schema_errors(item, schema.get('items', {}), root, f'{path}[{index}]')
    if isinstance(value, dict):
        properties = schema.get('properties', {})
        errors += [f'{path}: falta {name}' for name in schema.get('required', []) if name not in value]
        for name, item in value.items():
            if name in properties:
                errors += schema_errors(item, properties[name], root, f'{path}.{name}')
            elif schema.get('additionalProperties', True) is False:
                errors.append(f'{path}: propiedad no permitida {name}')
            elif isinstance(schema.get('additionalProperties'), dict):
                errors += schema_errors(item, schema['additionalProperties'], root, f'{path}.{name}')
    return errors


def contract_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict | list):
        for item in value.values() if isinstance(value, dict) else value:
            yield from contract_strings(item)


def subschemas(schema: dict):
    yield schema
    for name in ('properties', '$defs'):
        for child in schema.get(name, {}).values():
            yield from subschemas(child)
    for name in ('items', 'additionalProperties'):
        if isinstance(schema.get(name), dict):
            yield from subschemas(schema[name])


def fold(text: str) -> str:
    return ''.join(ch for ch in unicodedata.normalize('NFD', text) if unicodedata.category(ch) != 'Mn').lower()


def trim_spaces(value: str) -> str:
    """RECORTE_ESPACIOS: solo U+0020; str.strip() sin argumento también quitaría U+00A0, U+2028 y otros."""
    return value.strip(' ')


def collapse_spaces(value: str) -> str:
    """COLAPSO_ESPACIOS: solo U+0020."""
    return re.sub(' +', ' ', value)


def normalize_name(value: str):
    """Solo para NOMBRE, que no forma parte de ninguna clave; None si hay caracteres de control o de formato."""
    if any(unicodedata.category(ch) in CONTROL for ch in value):
        return None
    return collapse_spaces(trim_spaces(unicodedata.normalize('NFC', value)))


def stored_value(name: str, value: str) -> str:
    """Forma que se guarda y ve la persona operadora de un valor ya validado."""
    if name == 'NOMBRE':
        return normalize_name(value)
    return trim_spaces(value) if name == 'EMAIL' else collapse_spaces(trim_spaces(value))


def valid_nombre(value: str) -> bool:
    value = normalize_name(value)
    return (value is not None and 1 <= len(value) <= 80
            and any(unicodedata.category(ch).startswith('L') for ch in value)
            and all(unicodedata.category(ch)[0] in 'LM' or ch in " .'’-" for ch in value))


def valid_telefono(raw: str) -> bool:
    """Valida el valor recibido: nada no ASCII llega a una transformación."""
    if not raw.isascii():
        return False
    value = collapse_spaces(trim_spaces(raw))
    if len(value) > 25:
        return False
    body = value.removeprefix('+')
    return all(ch in '0123456789 -()' for ch in body) and 8 <= sum(ch.isdigit() for ch in body) <= 15


def valid_email(raw: str) -> bool:
    """Valida el valor recibido: nada no ASCII llega a una transformación."""
    if not raw.isascii():
        return False
    value = trim_spaces(raw)
    if len(value) > 254 or ' ' in value or value.count('@') != 1:
        return False
    local, domain = value.split('@')
    labels = domain.split('.')
    return (re.fullmatch(r'[A-Za-z0-9._%+-]{1,64}', local) is not None and len(labels) >= 2
            and all(re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?', label) for label in labels)
            and labels[-1].isalpha() and len(labels[-1]) >= 2)


def valid_referencia(raw: str) -> bool:
    """Valida el valor recibido: nada no ASCII llega a una transformación."""
    if not raw.isascii():
        return False
    value = collapse_spaces(trim_spaces(raw))
    return (1 <= len(value) <= 30 and all(ch.isalnum() or ch in ' -/.' for ch in value)
            and any(ch.isalnum() for ch in value))


def canonical_phone(raw: str, rule: dict) -> str:
    """Clave canónica de un teléfono validado (solicitud_contacto.clave_canonica.TELEFONO)."""
    if not valid_telefono(raw):
        raise ValueError('la clave canónica solo se deriva de un contacto validado')
    compact = re.sub(r'[ ()-]', '', raw)
    digits = compact.removeprefix('+')
    prefix, national_length = rule['prefijo_pais'], rule['digitos_nacionales']
    if compact.startswith('+'):
        international = digits
    elif digits.startswith('00') and digits[2:3] != '0':
        international = digits[2:]
    elif digits.startswith(prefix) and len(digits) >= len(prefix) + national_length:
        international = digits
    else:
        international = prefix + digits
    if not international.startswith(prefix):
        return f'+{international}'
    national = international[len(prefix):]
    for mark in ('0', '9'):
        if len(national) > national_length and national.startswith(mark):
            national = national[1:]
    if len(national) == national_length + 2:
        for position in rule['posiciones_15']:
            if national[position:position + 2] == '15':
                national = national[:position] + national[position + 2:]
                break
    return f'+{prefix}{national}'


def canonical_email(raw: str, rule: dict) -> str:
    """Clave canónica de un correo validado: la parte local solo cambia con una política explícita del proveedor."""
    if not valid_email(raw):
        raise ValueError('la clave canónica solo se deriva de un contacto validado')
    local, domain = trim_spaces(raw).split('@')
    domain = domain.lower()
    policy = next((item for item in rule['politicas_por_proveedor'] if domain in item['dominios']), None)
    if policy is None:
        return f'{local}@{domain}'
    if policy['parte_local_en_minusculas']:
        local = local.lower()
    if policy['quitar_etiqueta_mas']:
        local = local.split('+', 1)[0] or local
    if policy['quitar_puntos']:
        local = local.replace('.', '') or local
    return f"{local}@{policy['dominio_canonico']}"


CANONICAL = {'TELEFONO': canonical_phone, 'EMAIL': canonical_email}


def valid_submission(medium: str, item: dict) -> bool:
    """Paso FORMATO de un envío del modelo: el contacto según su medio y, si vino, la referencia."""
    return VALIDATORS[medium](item['contacto']) and ('referencia' not in item or VALIDATORS['REFERENCIA'](item['referencia']))


def submit_all(scenario: dict, keys: dict, limit: int) -> tuple[list[str], int]:
    """Modelo de referencia de los pasos FORMATO, DUPLICADO, LIMITE_CONTACTO y GUARDAR, en ese orden.

    Un envío inválido termina en FORMATO: no llega a derivar la clave ni a tocar lo que cuenta el límite por contacto.
    """
    rule = keys[scenario['medio']]
    created, results = set(), []
    for item in scenario['envios']:
        if not valid_submission(scenario['medio'], item):
            results.append('INVALIDA')
            continue
        key = CANONICAL[scenario['medio']](item['contacto'], rule)
        if (key, item['motivo']) in created:
            results.append('RECIBIDA')
        elif sum(existing == key for existing, _ in created) >= limit:
            results.append('LIMITE')
        else:
            created.add((key, item['motivo']))
            results.append('RECIBIDA')
    return results, len(created)


def visible(value: str) -> str:
    """Escritura de un vector en el documento: U+212A se ve igual que K y los espacios de los extremos no se verían."""
    core = value.strip(' ')
    start = len(value) - len(value.lstrip(' '))
    shown = ''.join(ch if ' ' <= ch <= '~' else f'\\u{ord(ch):04x}' for ch in core)
    return '\\u0020' * start + shown + '\\u0020' * (len(value) - len(core) - start)


@functools.cache
def lookalikes() -> frozenset[str]:
    """Caracteres no ASCII que una forma Unicode, un cambio de mayúsculas, quitar tildes o un recorte acercan al alfabeto.

    También dígitos de otros alfabetos, guiones, espacios, separadores y controles, que pueden pasar inadvertidos.
    """
    found = set()
    for code in range(0x80, 0x110000):
        ch = chr(code)
        category = unicodedata.category(ch)
        if category in {'Cn', 'Co', 'Cs'}:
            continue
        if (category in {'Cc', 'Cf', 'Zs', 'Zl', 'Zp', 'Nd', 'No', 'Pd'} or ch == '\u2212' or not ch.strip() or ch.isdigit()
                or ch.lower().isascii() or ch.upper().isascii() or ch.casefold().isascii()
                or unicodedata.normalize('NFKC', ch).isascii() or unicodedata.normalize('NFC', ch).isascii()
                or fold(unicodedata.normalize('NFKD', ch)).isascii()):
            found.add(ch)
    return frozenset(found)


def explained_by_listed_rule(left: str, right: str, rule: dict) -> bool:
    """¿Una regla listada justifica que dos correos validados compartan clave? Se escribe sin usar canonical_email."""
    def provider_form(local):
        untagged = re.sub(r'^([^+]+)\+.*$', r'\1', local).lower()
        return untagged.replace('.', '') or untagged

    local_left, domain_left = left.strip(' ').split('@')
    local_right, domain_right = right.strip(' ').split('@')
    domain_left, domain_right = domain_left.lower(), domain_right.lower()
    policies = {domain: policy for policy in rule['politicas_por_proveedor'] for domain in policy['dominios']}
    if domain_left not in policies or domain_right not in policies:
        return domain_left == domain_right and local_left == local_right
    if policies[domain_left] is not policies[domain_right]:
        return False
    return provider_form(local_left) == provider_form(local_right)


def language_violations(text: str, kind: str, rules: dict) -> list[str]:
    """Control parcial de un texto: detecta errores conocidos; no reemplaza la revisión semántica humana."""
    found = []
    plain = fold(text)
    if len(text) > rules['max_caracteres'][kind]:
        found.append('largo')
    found += [f'oración larga: {sentence}' for sentence in re.split(r'(?<=[.!?])\s+', text)
              if len(sentence.split()) > rules['max_palabras_por_oracion']]
    for name in ('terminos_prohibidos', 'promesas_prohibidas', 'afirmaciones_prohibidas'):
        found += [f'{name}: {term}' for term in rules[name] if fold(term) in plain]
    if any(unicodedata.category(ch) in CONTROL for ch in text):
        found.append('carácter de control')
    if re.search(r'\b\d+\s*(horas|hs|dias)\b', plain):
        found.append('plazo prometido')
    if re.search(r'https?://|www\.|\d[\d \-]{5,}\d', text):
        found.append('URL o teléfono literal')
    if re.search(r'\$|\bars\b|\bpesos?\b|\d[\d.]*,\d+|\d+\.\d+', plain):
        found.append('importe literal')
    if kind not in rules['tipos_con_digitos'] and re.search(r'\d', text):
        found.append('dígito fuera de un mensaje de error')
    shouting = set(re.findall(r'\b[A-ZÁÉÍÓÚÑ]{2,}\b', text)) - set(rules['siglas_permitidas'])
    if shouting:
        found.append(f'mayúsculas: {sorted(shouting)}')
    return found


VALIDATORS = {'NOMBRE': valid_nombre, 'TELEFONO': valid_telefono, 'EMAIL': valid_email, 'REFERENCIA': valid_referencia}


class ChannelFlowContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = load(CONTRACT)
        cls.schema = load(SCHEMA)
        cls.document = DOCUMENT.read_text(encoding='utf-8')
        cls.texts = {item['id']: item for item in cls.contract['textos']}
        cls.states = {item['id']: item for item in cls.contract['flujo']['estados']}
        cls.form = cls.contract['solicitud_contacto']

    def edges(self, state: dict) -> list[str]:
        targets = [option['destino'] for option in state['opciones']]
        return targets + list(state.get('envio', {}).get('resultados', {}).values())

    def referenced_texts(self) -> list[str]:
        refs = []
        for state in self.states.values():
            refs += state['textos'] + [option['texto'] for option in state['opciones']]
            refs += [state['envio']['texto']] if 'envio' in state else []
        refs += [ref for field in self.form['campos'] for ref in (field['etiqueta'], field.get('ayuda')) if ref]
        refs += [self.form['campo_trampa']['etiqueta'], *self.form['errores'].values()]
        refs += [item['error'] for item in self.form['formatos'].values()]
        refs += [item['texto'] for item in self.form['medios_contacto']]
        refs += [ref for item in self.form['motivos'] for ref in (item['texto'], item['plantilla_correo'])]
        return refs + self.contract['derivacion']['plantillas']

    def test_schema_uses_only_supported_keywords(self):
        used = set().union(*(set(item) for item in subschemas(self.schema)))
        self.assertEqual(used - KEYWORDS, set())
        self.assertEqual(self.schema['$schema'], 'https://json-schema.org/draft/2020-12/schema')

    def test_schema_patterns_are_portable_and_end_anchored(self):
        patterns = [item['pattern'] for item in subschemas(self.schema) if 'pattern' in item]
        self.assertGreater(len(patterns), 10)
        strings = list(contract_strings(self.contract))
        for pattern in patterns:
            with self.subTest(pattern):
                compiled = ecma_pattern(pattern)
                matched = [value for value in strings if compiled.search(value)]
                self.assertEqual([value for value in matched if compiled.search(value + '\n')], [])
        raw = self.schema['properties']['textos']['items']['properties']['texto']['pattern']
        self.assertIsNotNone(re.search(raw, 'Hola.\n'), 'sin traducir, el $ de Python acepta el salto final')
        text = ecma_pattern(raw)
        for value in ('Hola.', 'Sí', 'x'):
            self.assertIsNotNone(text.search(value), value)
        for value in ('Hola.\n', 'Hola.\nChau.', ' Hola.', 'Hola. ', 'Hola.\r', 'a\u2028b', '', '\ufeffHola.', 'Hola.\ufeff',
                      '\x85Hola.', 'Hola.\x85', '\u00a0Hola.', 'Hola.\u3000', '\x1cHola.'):
            self.assertIsNone(text.search(value), repr(value))
        with self.assertRaises(ValueError):
            ecma_pattern('^.+$')
        with self.assertRaises(ValueError):
            ecma_pattern('^\\S+$')
        with self.assertRaises(ValueError):
            ecma_pattern('^[0-9]+')

    def test_contract_matches_schema(self):
        self.assertEqual(schema_errors(self.contract, self.schema, self.schema), [])

    def test_schema_validator_distinguishes_booleans_from_numbers(self):
        rejected = [(0, {'const': False}), (1, {'const': True}), (False, {'const': 0}), (True, {'const': 1}),
                    (0, {'enum': [False]}), (1, {'enum': [True]}), (False, {'enum': [0]}), (True, {'enum': [1]}),
                    ([0], {'const': [False]}), ({'a': 1}, {'const': {'a': True}}), (1, {'type': 'boolean'}),
                    (True, {'type': 'integer'})]
        for value, schema in rejected:
            with self.subTest(value=value, schema=schema):
                self.assertNotEqual(schema_errors(value, schema, schema), [])
        accepted = [(False, {'const': False}), (True, {'const': True}), (0, {'const': 0}), (1, {'enum': [1]}),
                    (False, {'enum': [False]}), ([False], {'const': [False]}), ({'a': True}, {'const': {'a': True}}),
                    ([0, False], {'uniqueItems': True}), ([1, True], {'uniqueItems': True})]
        for value, schema in accepted:
            with self.subTest(value=value, schema=schema):
                self.assertEqual(schema_errors(value, schema, schema), [])
        self.assertNotEqual(schema_errors([1, 1], {'uniqueItems': True}, {}), [])

    def test_schema_rejects_unsafe_mutations(self):
        def mutated(change):
            data = copy.deepcopy(self.contract)
            change(data)
            return schema_errors(data, self.schema, self.schema)

        mutations = {
            'falta catálogo': lambda d: d.pop('textos'),
            'propiedad desconocida': lambda d: d.update(consulta_de_cuenta=True),
            'id de texto inválido': lambda d: d['textos'][0].update(id='bienvenida'),
            'ejecuta intensidad 3': lambda d: d.update(intensidades_ejecutables=[3]),
            'retención de 120 días': lambda d: d['retencion'].update(dias_por_defecto=120),
            'consulta la cartera': lambda d: d['solicitud_contacto']['garantias_no_revelacion'].update(
                consulta_tablas_de_cartera=True),
            'consulta la cartera como 0': lambda d: d['solicitud_contacto']['garantias_no_revelacion'].update(
                consulta_tablas_de_cartera=0),
            'misma respuesta como 1': lambda d: d['solicitud_contacto']['garantias_no_revelacion'].update(
                misma_respuesta_para_cualquier_referencia=1),
            'sin revisión semántica humana': lambda d: d['lenguaje'].update(revision_semantica_humana=False),
            'límite sin unidad de cuenta': lambda d: d['antiabuso']['limites'][2].pop('cuenta'),
            'sin clave canónica': lambda d: d['solicitud_contacto'].pop('clave_canonica'),
            'captcha de terceros': lambda d: d['antiabuso'].update(captcha_de_terceros=True),
            'normalización común otra vez': lambda d: d['solicitud_contacto'].update(normalizacion='NFC antes de validar.'),
            'NFC en el correo': lambda d: d['solicitud_contacto']['normalizacion']['por_formato']['EMAIL'].insert(0, 'NFC'),
            'NFC en el teléfono': lambda d: d['solicitud_contacto']['normalizacion']['por_formato']['TELEFONO'].insert(0, 'NFC'),
            'NFC en la referencia': lambda d: d['solicitud_contacto']['normalizacion']['por_formato']['REFERENCIA'].insert(0, 'NFC'),
            'NFKC como transformación': lambda d: d['solicitud_contacto']['normalizacion']['transformaciones'][0].update(codigo='NFKC'),
            'sin patrón sobre el valor recibido': lambda d: d['solicitud_contacto']['formatos']['EMAIL'].pop('patron_crudo'),
            'sin reglas listadas': lambda d: d['solicitud_contacto']['clave_canonica'].pop('reglas_listadas'),
            'sin regla de diseño': lambda d: d['solicitud_contacto']['clave_canonica'].pop('regla_de_diseno'),
            'contacto verificado': lambda d: d['solicitud_contacto']['campos'][2].update(verificado=True),
            'consentimiento premarcado': lambda d: d['solicitud_contacto']['campos'][5].update(valor_inicial=True),
            'estado desconocido': lambda d: d.update(estado='PUBLICADO'),
            'aprobación incompleta': lambda d: d.update(aprobacion={'por': ['usuario']}),
            'texto con salto de línea final': lambda d: d['textos'][0].update(texto='Hola.\n'),
            'texto con salto de línea interno': lambda d: d['textos'][0].update(texto='Hola.\nChau.'),
            'versión con salto de línea final': lambda d: d.update(version='1.0.0\n'),
            'id de texto con salto de línea final': lambda d: d['textos'][0].update(id='CAN-INICIO-BIENVENIDA-v1\n'),
        }
        for name, change in mutations.items():
            with self.subTest(name):
                self.assertNotEqual(mutated(change), [])

    def test_approval_state_and_draft_mark(self):
        contract = self.contract
        if contract['estado'] == 'BORRADOR_PENDIENTE_APROBACION':
            self.assertIsNone(contract['aprobacion'])
            self.assertIn(DRAFT_MARK, self.document)
        else:
            self.assertIsInstance(contract['aprobacion'], dict)
            self.assertNotIn(DRAFT_MARK, self.document)

    def test_text_ids_unique_resolved_and_used(self):
        ids = [item['id'] for item in self.contract['textos']]
        self.assertEqual(len(ids), len(set(ids)))
        major = self.contract['version'].split('.')[0]
        self.assertTrue(all(text_id.endswith(f'-v{major}') for text_id in ids))
        refs = self.referenced_texts()
        self.assertEqual(sorted(set(refs) - set(ids)), [])
        self.assertEqual(sorted(set(ids) - set(refs)), [])

    def test_text_types_match_their_use(self):
        types = {text_id: item['tipo'] for text_id, item in self.texts.items()}
        for state in self.states.values():
            self.assertTrue(all(types[ref] in {'MENSAJE', 'AYUDA'} for ref in state['textos']), state['id'])
            self.assertTrue(all(types[option['texto']] == 'OPCION' for option in state['opciones']), state['id'])
        self.assertTrue(all(types[item['texto']] == 'MOTIVO' for item in self.form['motivos']))
        self.assertTrue(all(types[item['texto']] == 'MEDIO' for item in self.form['medios_contacto']))
        operator = {text_id for text_id, item in self.texts.items() if item['audiencia'] == 'OPERADOR'}
        self.assertEqual(operator, set(self.contract['derivacion']['plantillas']))
        self.assertTrue(all(types[ref] in {'PLANTILLA', 'GUION'} for ref in operator))

    def test_flow_graph_has_no_dead_ends_and_always_offers_a_person(self):
        flow = self.contract['flujo']
        self.assertEqual(len(self.states), len(flow['estados']))
        self.assertIn(flow['estado_inicial'], self.states)
        for state in self.states.values():
            self.assertEqual(sorted(set(self.edges(state)) - set(self.states)), [], state['id'])
            labels = [option['texto'] for option in state['opciones']]
            self.assertEqual(len(labels), len(set(labels)), state['id'])
            self.assertEqual('envio' in state, state['tipo'] == 'FORMULARIO', state['id'])
        seen, queue = {flow['estado_inicial']}, deque([flow['estado_inicial']])
        while queue:
            for target in self.edges(self.states[queue.popleft()]):
                if target not in seen:
                    seen.add(target)
                    queue.append(target)
        self.assertEqual(seen, set(self.states))
        finals = {state_id for state_id, state in self.states.items() if state['tipo'] == 'FIN'}
        reaches_end = set(finals)
        while True:
            more = {s for s, state in self.states.items() if set(self.edges(state)) & reaches_end} - reaches_end
            if not more:
                break
            reaches_end |= more
        self.assertEqual(reaches_end, set(self.states))
        for state in self.states.values():
            if state['tipo'] in {'MENU', 'INFO'}:
                self.assertIn({'texto': 'CAN-OPC-PERSONA-v1', 'destino': 'CONTACTO_AVISO'}, state['opciones'])
        self.assertIn('CONTACTO_FORM', self.edges(self.states['CONTACTO_AVISO']))

    def test_submission_results_are_identical_and_echo_nothing(self):
        responses = self.form['respuestas_envio']
        results = self.states['CONTACTO_FORM']['envio']['resultados']
        self.assertEqual({key: value['estado_destino'] for key, value in responses.items()}, results)
        self.assertEqual(responses['RECIBIDA']['cuerpo'], {'resultado': 'RECIBIDA'})
        self.assertEqual(set(responses['RECIBIDA']['cuando']), {'VALIDA', 'DUPLICADA_24H', 'CAMPO_TRAMPA_CON_VALOR'})
        self.assertEqual(responses['LIMITE']['cuerpo'], {'resultado': 'LIMITE'})
        self.assertEqual(responses['ERROR']['cuerpo'], {'resultado': 'ERROR'})
        for key, value in self.form['garantias_no_revelacion'].items():
            self.assertIs(value, not key.startswith(('consulta', 'valida', 'devuelve')), key)
        municipal = set(self.contract['marcadores']['municipio'])
        for state_id in ('CONTACTO_CONFIRMACION', 'CONTACTO_LIMITE', 'CONTACTO_ERROR'):
            texts = [self.texts[ref]['texto'] for ref in self.states[state_id]['textos']]
            marks = set(PLACEHOLDER.findall(' '.join(texts)))
            self.assertTrue(marks <= municipal, state_id)
            # ALTERNATIVA_HUMANA: teléfono y atención presencial visibles en los tres resultados.
            self.assertTrue({'telefono_oficial', 'direccion_oficial'} <= marks, state_id)

    def test_placeholders_are_declared_per_audience(self):
        marks = self.contract['marcadores']
        public = set(marks['municipio']) | set(marks['parametros'])
        operator = public | set(marks['solo_operador'])
        self.assertEqual(set(marks['prohibidos']) & operator, set())
        self.assertEqual({item['clave'] for item in self.contract['configuracion_municipio']['campos']},
                         set(marks['municipio']))
        for text_id, item in self.texts.items():
            used = PLACEHOLDER.findall(item['texto'])
            self.assertEqual(item['texto'].count('{'), len(used), text_id)
            allowed = public if item['audiencia'] == 'PUBLICO' else operator
            self.assertTrue(set(used) <= allowed, text_id)

    def test_plain_dignified_language(self):
        rules = self.contract['lenguaje']
        for text_id, item in self.texts.items():
            with self.subTest(text_id):
                self.assertEqual(language_violations(item['texto'], item['tipo'], rules), [])

    def test_language_control_rejects_debt_affirmations_and_literal_amounts(self):
        rules = self.contract['lenguaje']
        counterexamples = ['Tenés pagos pendientes.', 'No tenés pagos pendientes.', 'Tenés que pagar $ 123,45.',
                           'Tu deuda es de 123 pesos.', 'Hay una deuda en esa cuenta.', 'Estás al día.',
                           'No encontramos esa referencia.', 'La cuenta tiene pagos.']
        amounts = ['El total es $ 123,45.', 'Son 123 pesos.', 'Son 123,45.', 'Son 1.234,50.', 'Son ARS 500.',
                   'Corresponden 500.']
        for kind in ('MENSAJE', 'PLANTILLA', 'GUION'):
            for text in counterexamples + amounts:
                with self.subTest(kind=kind, text=text):
                    self.assertNotEqual(language_violations(text, kind, rules), [])
        for text in ('El total es $ 123,45.', 'Son 123 pesos.', 'Son 1.234,50.'):
            self.assertIn('importe literal', language_violations(text, 'ERROR', rules))
        self.assertEqual(language_violations('Escribí entre 8 y 15 números.', 'ERROR', rules), [])
        self.assertIn('parcial', rules['alcance_de_los_controles'])
        self.assertIs(rules['revision_semantica_humana'], True)

    def test_contact_form_collects_only_minimal_data(self):
        fields = {field['id']: field for field in self.form['campos']}
        self.assertEqual({key: field['obligatorio'] for key, field in fields.items()}, MINIMAL_FIELDS)
        self.assertEqual(set(fields) & set(self.form['campos_prohibidos']), set())
        trap = self.form['campo_trampa']['id']
        self.assertNotIn(trap, set(fields) | set(self.form['campos_prohibidos']))
        personal = {key for key, field in fields.items() if field['personal']}
        self.assertEqual(personal, set(self.contract['retencion']['campos_personales']))
        self.assertEqual(personal & set(self.contract['retencion']['se_conserva']), set())
        self.assertIs(fields['consentimiento']['valor_inicial'], False)
        self.assertEqual(fields['consentimiento']['control'], 'CASILLA')
        self.assertIs(fields['contacto']['verificado'], False)
        self.assertIs(fields['referencia']['verificado'], False)
        self.assertEqual(fields['contacto']['max_caracteres'],
                         max(item['max_caracteres'] for item in self.form['medios_contacto']))
        self.assertTrue(all('(opcional)' in self.texts[field['etiqueta']]['texto']
                            for field in fields.values() if not field['obligatorio']))
        self.assertTrue(all('(opcional)' not in self.texts[field['etiqueta']]['texto']
                            for field in fields.values() if field['obligatorio']))

    def test_format_vectors_match_reference_rules(self):
        lengths = {'NOMBRE': 80, 'REFERENCIA': 30}
        fields = {field.get('formato'): field for field in self.form['campos']}
        for name, rule in self.form['formatos'].items():
            with self.subTest(name):
                self.assertTrue(all(VALIDATORS[name](value) for value in rule['validos']))
                self.assertFalse(any(VALIDATORS[name](value) for value in rule['invalidos']))
                if name in lengths:
                    self.assertEqual(fields[name]['max_caracteres'], lengths[name])
        self.assertEqual({item['formato']: item['max_caracteres'] for item in self.form['medios_contacto']},
                         {'TELEFONO': 25, 'EMAIL': 254})
        # La longitud se mide después de normalizar: 13 dígitos y 12 espacios caben en 25; 14 y 13, no.
        self.assertTrue(valid_telefono('0 ' * 13))
        self.assertFalse(valid_telefono('0 ' * 14))

    def test_canonical_contact_key_unifies_equivalent_forms(self):
        keys = self.form['clave_canonica']
        for medium, rule in ((name, keys[name]) for name in CANONICAL):
            canonical = CANONICAL[medium]
            for group in rule['equivalencias']:
                for form in group['formas']:
                    with self.subTest(medium=medium, form=form):
                        self.assertTrue(VALIDATORS[medium](form), 'la forma debe ser válida')
                        self.assertEqual(canonical(form, rule), group['clave'])
            for left, right in rule['distintos']:
                with self.subTest(medium=medium, left=left, right=right):
                    self.assertTrue(VALIDATORS[medium](left) and VALIDATORS[medium](right))
                    self.assertNotEqual(canonical(left, rule), canonical(right, rule))
        # Lo que se guarda conserva la presentación que ve el operador: por eso hace falta otra clave.
        reported = keys['TELEFONO']['equivalencias'][0]['formas'][:4]
        self.assertEqual(len({stored_value('TELEFONO', form) for form in reported}), 4)
        self.assertEqual(len({canonical_phone(form, keys['TELEFONO']) for form in reported}), 1)

    def test_independent_mailboxes_keep_their_own_key(self):
        rule = self.form['clave_canonica']['EMAIL']
        self.assertEqual({domain for item in rule['politicas_por_proveedor'] for domain in item['dominios']},
                         {'gmail.com', 'googlemail.com'})
        pairs = {frozenset(pair) for pair in rule['distintos']}
        mailboxes = [f'buzon+{name}@example.org' for name in ('uno', 'dos', 'tres', 'cuatro')]
        self.assertEqual(len({canonical_email(item, rule) for item in mailboxes}), 4)
        self.assertTrue({frozenset(mailboxes[:2]), frozenset(mailboxes[2:]),
                         frozenset(('Buzon@example.org', 'buzon@example.org'))} <= pairs)
        # Sin política, la parte local queda exactamente como se escribió y solo cambia el dominio.
        for local in ('buzon+uno', 'Buzon', 'BUZON', 'a.b', 'a.b+c.d', '+a'):
            for domain, expected in (('example.org', 'example.org'), ('EXAMPLE.ORG', 'example.org'),
                                     ('gmail.com.example.org', 'gmail.com.example.org')):
                self.assertEqual(canonical_email(f'{local}@{domain}', rule), f'{local}@{expected}')
        forms = {item for group in rule['equivalencias'] if 'gmail.com' not in group['clave'] for item in group['formas']}
        self.assertEqual({trim_spaces(item).split('@')[0] for item in forms}, {'Persona'})
        scenarios = {item['id']: item for item in self.form['escenarios_equivalencia']}
        for scenario_id, expected in MAILBOX_SCENARIOS.items():
            with self.subTest(scenario_id):
                self.assertEqual((scenarios[scenario_id]['resultados'], scenarios[scenario_id]['solicitudes_creadas']),
                                 expected)
        notes = re.findall(r'^\| ALIGN-0(?:65|71) \|.*$', self.document, flags=re.MULTILINE)
        self.assertEqual(len(notes), 2)
        for note in notes:
            self.assertEqual([item for item in (*MAILBOX_SCENARIOS, *RAW_SCENARIOS) if f'`{item}`' not in note], [])

    def test_phone_variants_never_merge_distinct_national_numbers(self):
        rule = self.form['clave_canonica']['TELEFONO']
        generator = random.Random(47)
        samples = [''.join(generator.choice('0123456789') for _ in range(10)) for _ in range(2000)]
        # Exhaustivo con 1 y 5 para forzar 15 repetidos; muestra fija con códigos de área posibles (1, 2 o 3).
        numbers = {''.join(digits) for digits in itertools.product('15', repeat=10)}
        numbers |= {number for number in samples if number[0] in '123'}
        keys = set()
        for number in numbers:
            key = f'+54{number}'
            keys.add(canonical_phone(key, rule))
            forms = [number, f'0{number}', f'+540{number}', f'+549{number}', f'54{number}', f'0054{number}',
                     *(number[:area] + '15' + number[area:] for area in rule['posiciones_15'])]
            forms += [f'0{number[:area]}15{number[area:]}' for area in rule['posiciones_15']]
            forms += [f'+54{number[:area]}15{number[area:]}' for area in rule['posiciones_15']]
            for form in forms:
                self.assertEqual(canonical_phone(form, rule), key, form)
        self.assertEqual(keys, {f'+54{number}' for number in numbers})

    def test_equivalent_forms_share_deduplication_and_limit(self):
        limit = next(item for item in self.contract['antiabuso']['limites'] if item['clave'] == 'CONTACTO')
        self.assertEqual((limit['maximo'], limit['ventana_horas'], limit['cuenta']), (3, 24, 'SOLICITUDES_CREADAS'))
        motives = {item['codigo'] for item in self.form['motivos']}
        scenarios = {item['id']: item for item in self.form['escenarios_equivalencia']}
        self.assertTrue({'ESC-TEL-MISMO-MOTIVO', 'ESC-TEL-MOTIVOS-DISTINTOS'} <= set(scenarios))
        by_ip = min(item['maximo'] for item in self.contract['antiabuso']['limites'] if item['clave'] == 'IP')
        for scenario in scenarios.values():
            with self.subTest(scenario['id']):
                self.assertTrue({item['motivo'] for item in scenario['envios']} <= motives)
                self.assertLessEqual(len(scenario['envios']), by_ip, 'el escenario no debe depender del límite por IP')
                results, created = submit_all(scenario, self.form['clave_canonica'], limit['maximo'])
                self.assertEqual(results, scenario['resultados'])
                self.assertEqual(created, scenario['solicitudes_creadas'])
        steps = [step.split(':')[0] for step in self.form['orden_de_evaluacion']]
        self.assertEqual(steps, ['TAMANO', 'CAMPO_TRAMPA', 'LIMITES_IP_MUNICIPIO', 'FORMATO', 'DUPLICADO',
                                 'LIMITE_CONTACTO', 'GUARDAR'])
        self.assertIn('clave canónica', self.contract['antiabuso']['seudonimo'])
        step = next(item for item in self.form['orden_de_evaluacion'] if item.startswith('FORMATO:'))
        for phrase in ('valor recibido', 'sin derivar la clave canónica', 'sin tocar el contador por contacto'):
            self.assertIn(phrase, step)

    def accepted_corpus(self) -> dict[str, set[str]]:
        """Entradas aceptadas de cada formato: vectores del contrato, ejemplos de reglas y variantes con espacios."""
        keys, formats = self.form['clave_canonica'], self.form['formatos']
        corpus = {name: set(rule['validos']) for name, rule in formats.items()}
        for medium in CANONICAL:
            corpus[medium] |= {form for group in keys[medium]['equivalencias'] for form in group['formas']}
            corpus[medium] |= {value for pair in keys[medium]['distintos'] for value in pair}
        for item in keys['reglas_listadas']:
            corpus[item['medio']].add(item['ejemplo']['contacto'])
        for scenario in self.form['escenarios_equivalencia']:
            corpus[scenario['medio']] |= {item['contacto'] for item in scenario['envios']}
        accepted = {name: {value for value in values if VALIDATORS[name](value)} for name, values in corpus.items()}
        return {name: values | {padded for value in values for padded in (f' {value}', f'{value}  ')
                                if VALIDATORS[name](padded)}
                for name, values in accepted.items()}

    def test_no_character_outside_the_declared_alphabet_is_accepted(self):
        marks = lookalikes()
        self.assertTrue({'\u212a', '\u00a0', '\u2003', '\u3000', '\u2028', '\u2029', '\u200b', '\u00ad', '\ufeff', '\u0085',
                         '\uff21', '\uff10', '\uff0b', '\uff20', '\uff0e', '\u0660', '\u00b2', '\u017f', '\u0131', '\u0130',
                         '\u00e9', '\u2011', '\u2212', '\u24b6'} <= marks)
        for name, required in REQUIRED_NEGATIVE_VECTORS.items():
            self.assertEqual(required - set(self.form['formatos'][name]['invalidos']), set(), name)
        for name, templates in PROBE_TEMPLATES.items():
            valid = VALIDATORS[name]
            with self.subTest(name):
                self.assertEqual([hex(code) for code in range(0x80, 0x110000) if valid(templates[0].format(chr(code)))], [])
                for template in templates:
                    self.assertEqual([hex(ord(ch)) for ch in marks if valid(template.format(ch))], [], template)
        ascii_controls = [chr(code) for code in (*range(0x20), 0x7f)]
        for name, templates in PROBE_TEMPLATES.items():
            for template, ch in itertools.product(templates, ascii_controls):
                with self.subTest(name=name, template=template, ch=hex(ord(ch))):
                    self.assertFalse(VALIDATORS[name](template.format(ch)))

    def test_normalizing_an_accepted_entry_only_applies_listed_rules(self):
        """Propiedad: normalizar una entrada aceptada no produce otra aceptada distinta, salvo por una regla listada."""
        rules = {'NFC': lambda value: unicodedata.normalize('NFC', value), 'RECORTE_ESPACIOS': trim_spaces,
                 'COLAPSO_ESPACIOS': collapse_spaces}
        normalization = self.form['normalizacion']
        self.assertEqual({item['codigo'] for item in normalization['transformaciones']}, set(rules))
        steps = normalization['por_formato']
        self.assertEqual(steps['EMAIL'], ['RECORTE_ESPACIOS'])
        self.assertEqual(steps['TELEFONO'], steps['REFERENCIA'])
        self.assertTrue(all('NFC' not in steps[name] for name in ('TELEFONO', 'EMAIL', 'REFERENCIA')))
        corpus = self.accepted_corpus()
        self.assertTrue(all(len(values) >= 3 for values in corpus.values()))
        for name, values in corpus.items():
            for raw in values:
                with self.subTest(name=name, raw=raw):
                    stored = stored_value(name, raw)
                    expected = raw
                    for step in steps[name]:
                        expected = rules[step](expected)
                    self.assertEqual(stored, expected)
                    self.assertTrue(VALIDATORS[name](stored))
                    self.assertEqual(stored_value(name, stored), stored)
                    if name == 'NOMBRE':
                        continue
                    self.assertTrue(raw.isascii())
                    self.assertEqual(stored.replace(' ', ''), raw.replace(' ', ''), 'solo pueden cambiar espacios U+0020')
                    for form in ('NFC', 'NFD', 'NFKC', 'NFKD'):
                        self.assertEqual(unicodedata.normalize(form, raw), raw)
                    if name in CANONICAL:
                        rule = self.form['clave_canonica'][name]
                        self.assertEqual(CANONICAL[name](stored, rule), CANONICAL[name](raw, rule))
                        self.assertTrue(CANONICAL[name](raw, rule).isascii())

    def test_equal_email_keys_are_always_explained_by_a_listed_rule(self):
        rule = self.form['clave_canonica']['EMAIL']
        locals_ = ('K', 'k', 'KK', 'Kk', 'kk', 'a', 'A', 'ab', 'AB', 'a.b', 'A.B', 'a+b', 'a+c', 'ab+c', '+a', '+b', '+a+b',
                   'a%b', 'a_b', 'a-b', '.', '..', '.a', 'a.', '.+a', '.+b', 'a..b')
        domains = ('example.org', 'EXAMPLE.ORG', 'Example.Org', 'example.com', 'gmail.com', 'GMAIL.COM', 'googlemail.com',
                   'GoogleMail.Com', 'mail.gmail.com', 'gmail.com.example.org', 'notgmail.example', 'gmail-com.example.org',
                   'xn--bcher-kva.example', 'XN--BCHER-KVA.EXAMPLE')
        entries = [f'{local}@{domain}' for local in locals_ for domain in domains]
        self.assertTrue(all(valid_email(entry) for entry in entries))
        keys = {entry: canonical_email(entry, rule) for entry in entries}
        for left, right in itertools.combinations(entries, 2):
            if (keys[left] == keys[right]) != explained_by_listed_rule(left, right, rule):
                self.fail(f'{left} y {right}: claves {keys[left]} y {keys[right]}')
        # Una clave de correo es su propia forma canónica; si la política dejara vacía la parte local, se conserva.
        self.assertEqual([entry for entry, key in keys.items() if canonical_email(key, rule) != key], [])
        self.assertEqual(canonical_email('.@gmail.com', rule), '.@gmail.com')
        self.assertEqual(canonical_email('..@gmail.com', rule), '..@gmail.com')

    def test_key_is_derived_only_from_a_validated_contact(self):
        keys = self.form['clave_canonica']
        for medium, canonical in CANONICAL.items():
            for value in self.form['formatos'][medium]['invalidos']:
                with self.subTest(medium=medium, value=value), self.assertRaises(ValueError):
                    canonical(value, keys[medium])

    def test_name_normalization_does_not_reach_contacts(self):
        # U+212A es K solo en un nombre, que no forma parte de ninguna clave.
        self.assertEqual(stored_value('NOMBRE', '\u212aarina'), 'Karina')
        self.assertEqual(stored_value('NOMBRE', 'Jose\u0301'), 'Jos\u00e9')
        self.assertEqual(stored_value('NOMBRE', ' Ana  María '), 'Ana María')
        self.assertFalse(valid_email('\u212a@example.org'))
        self.assertFalse(valid_referencia('\u212a-0001'))
        for space in ('\u00a0', '\u2003', '\u3000', '\u2028', '\u2029'):
            for name, valid in VALIDATORS.items():
                sample = self.form['formatos'][name]['validos'][0]
                self.assertFalse(valid(space + sample), (name, hex(ord(space))))
                self.assertFalse(valid(sample + space), (name, hex(ord(space))))
        for value in ('Ana\ud800', '\ud800'):
            self.assertFalse(valid_nombre(value))
        self.assertFalse(valid_email('\ud800@example.org'))
        self.assertFalse(valid_telefono('\ud80000000000'))

    def test_contract_declares_design_rule_and_listed_equivalences(self):
        keys = self.form['clave_canonica']
        self.assertIn('Ante la duda, dos claves distintas', keys['regla_de_diseno'])
        self.assertIn('unir a dos personas es un defecto', keys['regla_de_diseno'])
        self.assertIn('sin transformarlo antes', self.form['normalizacion']['principio'])
        self.assertEqual({item['codigo'] for item in keys['reglas_listadas']}, LISTED_KEY_RULES)
        for item in keys['reglas_listadas']:
            with self.subTest(item['codigo']):
                self.assertTrue(item['justificacion'])
                self.assertTrue(VALIDATORS[item['medio']](item['ejemplo']['contacto']))
                self.assertEqual(CANONICAL[item['medio']](item['ejemplo']['contacto'], keys[item['medio']]),
                                 item['ejemplo']['clave'])
        scenarios = {item['id']: item for item in self.form['escenarios_equivalencia']}
        for scenario_id, expected in RAW_SCENARIOS.items():
            with self.subTest(scenario_id):
                self.assertEqual((scenarios[scenario_id]['resultados'], scenarios[scenario_id]['solicitudes_creadas']),
                                 expected)

    def test_raw_patterns_agree_with_reference_validators(self):
        formats = self.form['formatos']
        self.assertNotIn('patron_crudo', formats['NOMBRE'])
        corpus = self.accepted_corpus()
        generator = random.Random(47)
        alphabets = {'EMAIL': 'aZ09._%+-@@.. ', 'TELEFONO': '09 ()-+', 'REFERENCIA': 'aZ09 ./-_'}

        def within_limits(name, raw):
            value = stored_value(name, raw)
            if name == 'EMAIL':
                return len(value) <= 254
            if name == 'TELEFONO':
                return len(value) <= 25 and 8 <= sum(ch.isdigit() for ch in value) <= 15
            return len(value) <= 30 and any(ch.isalnum() for ch in value)

        for name, alphabet in alphabets.items():
            pattern = ecma_pattern(formats[name]['patron_crudo'])
            probes = corpus[name] | set(formats[name]['invalidos'])
            probes |= {''.join(generator.choice(alphabet) for _ in range(generator.randint(1, 22))) for _ in range(6000)}
            probes |= {template.format(ch) for template in PROBE_TEMPLATES[name] for ch in lookalikes()}
            probes |= {template.format(ch) for template in PROBE_TEMPLATES[name] for ch in alphabet}
            for raw in probes:
                matched = pattern.search(raw) is not None
                expected = VALIDATORS[name](raw)
                if matched != expected and not (matched and not within_limits(name, raw)):
                    self.fail(f'{name}: {raw!r} patrón {matched}, referencia {expected}')
                if not raw.isascii():
                    self.assertFalse(matched, raw)

    def test_channel_never_reveals_decides_or_intervenes(self):
        codes = [item['codigo'] for item in self.contract['el_canal_no_hace']]
        self.assertEqual(len(codes), len(set(codes)))
        self.assertEqual(REQUIRED_NOT_DONE - set(codes), set())
        self.assertEqual(self.contract['intensidades_ejecutables'], [])
        self.assertFalse(self.contract['antiabuso']['captcha_de_terceros'])

    def test_retention_and_purge(self):
        retention = self.contract['retencion']
        self.assertEqual(retention['dias_por_defecto'], 90)
        self.assertLessEqual(retention['dias_minimo'], retention['dias_por_defecto'])
        self.assertLessEqual(retention['dias_por_defecto'], retention['dias_maximo'])
        for text_id in ('CAN-PRIVACIDAD-RETENCION-v1', 'CAN-CAMPO-CONSENTIMIENTO-v1'):
            self.assertIn('{dias_retencion}', self.texts[text_id]['texto'])
        closures = {item['codigo'] for item in self.contract['derivacion']['motivos_cierre']}
        self.assertTrue(set(retention['purga_inmediata_por_cierre']) <= closures)
        self.assertLessEqual(self.contract['antiabuso']['retencion_contadores_horas'], 24)

    def test_purge_claims_only_direct_fields_and_linked_record_is_pseudonymous(self):
        retention = self.contract['retencion']
        self.assertIn('campos directos', retention['accion'])
        self.assertIn('seudónimo', retention['registro_de_interacciones'])
        self.assertIn('no anónimo', retention['registro_de_interacciones'])
        self.assertIn('seudónimo', retention['vinculacion_con_caso'])
        self.assertIn('ALIGN-069', retention['vinculacion_con_caso'])
        self.assertIn('no borra ese vínculo', retention['vinculacion_con_caso'])
        for state_id in ('INFO_PRIVACIDAD', 'CONTACTO_AVISO'):
            self.assertIn('CAN-PRIVACIDAD-VINCULO-v1', self.states[state_id]['textos'], state_id)
        # «En ese caso» quedaba con un antecedente ambiguo en el aviso previo al formulario.
        self.assertEqual([text_id for text_id, item in self.texts.items() if 'en ese caso' in fold(item['texto'])], [])
        for text in (self.document, retention['registro_de_interacciones']):
            self.assertNotIn('ya no permite llegar', text)
        self.assertIn('no borra ese vínculo', self.document)

    def test_operator_handoff_and_log(self):
        handoff = self.contract['derivacion']
        queue = handoff['estados_cola']
        self.assertEqual(queue, ['NUEVA', 'EN_CURSO', 'RESUELTA', 'DESCARTADA'])
        self.assertFalse(any(move['desde'] in {'RESUELTA', 'DESCARTADA'} for move in handoff['transiciones']))
        responses = {item['codigo'] for item in handoff['eventos_registro'] if item['cuenta_como_respuesta']}
        self.assertEqual(responses, {'RESPUESTA_REALIZADA'})
        self.assertTrue({'nombre', 'contacto', 'referencia'} <= set(handoff['campos_prohibidos_en_registro']))
        self.assertEqual(set(handoff['campos_evento']) & set(handoff['campos_prohibidos_en_registro']), set())
        rules = [item['codigo'] for item in handoff['reglas_operador']]
        self.assertEqual(rules, [f'RO-{n:02d}' for n in range(1, len(rules) + 1)])
        self.assertTrue(all(item['plantilla_correo'] in handoff['plantillas'] for item in self.form['motivos']))
        roles = {item['rol'] for item in self.contract['acceso']}
        self.assertTrue({'anon', 'operador', 'supervisor', 'consulta', 'importador', 'importador_sistema'} <= roles)

    def test_accessibility_and_phases(self):
        codes = {item['codigo'] for item in self.contract['accesibilidad']['requisitos']}
        self.assertTrue({'ANCHO_360', 'TECLADO', 'LECTOR_PANTALLA', 'ERRORES_TEXTUALES', 'CONTRASTE',
                         'SIN_LIMITE_TIEMPO', 'IDIOMA_ES_AR', 'ALTERNATIVA_HUMANA'} <= codes)
        phases = {item['numero']: item for item in self.contract['fases']}
        self.assertEqual(phases[1]['alcance'], 'IMPRESCINDIBLE')
        self.assertTrue({'ALIGN-065', 'ALIGN-066'} <= set(phases[1]['tickets']))
        self.assertEqual((phases[2]['alcance'], phases[2]['tickets']), ('EVOLUCION', ['ALIGN-067']))
        self.assertEqual((phases[3]['alcance'], phases[3]['tickets']), ('EVOLUCION', ['ALIGN-068']))

    def test_document_reproduces_catalog_and_codes(self):
        rows = dict(re.findall(r'^\| `((?:CAN|OPE)-[A-Z0-9-]+-v\d+)` \| [^|]+ \| (.+?) \| [^|]* \|$',
                               self.document, flags=re.MULTILINE))
        self.assertEqual(rows, {text_id: item['texto'] for text_id, item in self.texts.items()})
        codes = [*self.states, *(item['codigo'] for item in self.contract['el_canal_no_hace']),
                 *(item['codigo'] for item in self.contract['derivacion']['reglas_operador']),
                 *(item['codigo'] for item in self.form['motivos']),
                 *(item['id'] for item in self.form['escenarios_equivalencia'])]
        self.assertEqual([code for code in codes if f'`{code}`' not in self.document], [])
        keys = self.form['clave_canonica']
        normalization = self.form['normalizacion']
        for text in (keys['limitaciones'], keys['EMAIL']['regla_general'], keys['TELEFONO']['por_que_no_une_personas'],
                     keys['regla_de_diseno'], normalization['principio'], normalization['validacion'],
                     normalization['presentacion']):
            self.assertIn(text, self.document)
        codes = [*(item['codigo'] for item in keys['reglas_listadas']),
                 *(item['codigo'] for item in normalization['transformaciones'])]
        self.assertEqual([code for code in codes if f'`{code}`' not in self.document], [])
        # Un vector no ASCII solo se escribe escapado: en el documento, U+212A no se distinguiría de K.
        vectors = [value for rule in self.form['formatos'].values() for value in rule['invalidos'] if not value.isascii()]
        self.assertGreater(len(vectors), 20)
        self.assertEqual([value for value in vectors if f'`{visible(value)}`' not in self.document], [])
        self.assertNotIn('\u212a', self.document)
        for path in ('contracts/channel-flow.v1.json', 'contracts/channel-flow.v1.schema.json',
                     'quality/tests/test_channel_flow.py'):
            self.assertIn(path, self.document)


if __name__ == '__main__':
    unittest.main()
