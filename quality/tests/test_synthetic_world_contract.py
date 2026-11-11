"""The shared synthetic world spec (ALIGN-048) must stay valid, hash-locked and coherent."""

import calendar
import hashlib
import json
import unittest
from datetime import date, timedelta
from itertools import pairwise
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC_PATH = ROOT / 'contracts/synthetic-world.v1.json'
SPEC = json.loads(SPEC_PATH.read_text(encoding='utf-8'))
RULES = json.loads((ROOT / 'contracts/decision-rules.v1.json').read_text(encoding='utf-8'))
PROTOCOL = (ROOT / SPEC['documento']).read_text(encoding='utf-8')
SCENARIOS = {'PRINCIPAL', 'NULO', 'MAL_ESPECIFICADO'}


def canonical_hash(spec):
    body = {key: value for key, value in spec.items() if key not in spec['integridad']['excluye']}
    text = json.dumps(body, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def month_start(first, offset):
    index = first.month - 1 + offset
    return date(first.year + index // 12, index % 12 + 1, 1)


class SyntheticWorldIntegrityTests(unittest.TestCase):
    def test_canonical_hash_matches_and_the_protocol_cites_it(self):
        digest = SPEC['integridad']['especificacion_sha256']
        self.assertEqual(canonical_hash(SPEC), digest)
        self.assertIn(digest, PROTOCOL)
        self.assertEqual(set(SPEC['integridad']['excluye']), {'estado', 'aprobacion', 'integridad'})

    def test_approval_changes_status_without_changing_the_spec_hash(self):
        approved = {**SPEC, 'estado': 'APROBADO',
                    'aprobacion': {key: 'x' for key in SPEC['aprobacion']}}
        self.assertEqual(canonical_hash(approved), canonical_hash(SPEC))
        edited = {**SPEC, 'semillas': {**SPEC['semillas'], 'principal': SPEC['semillas']['principal'] + 1}}
        self.assertNotEqual(canonical_hash(edited), canonical_hash(SPEC))

    def test_status_and_approval_record_agree(self):
        values = SPEC['aprobacion'].values()
        self.assertIn(SPEC['estado'], {'BORRADOR_PENDIENTE_APROBACION', 'APROBADO'})
        if SPEC['estado'] == 'APROBADO':
            self.assertTrue(all(isinstance(value, str) and value for value in values))
        else:
            self.assertTrue(all(value is None for value in values))
            self.assertIn('Borrador — pendiente de aprobación (ALIGN-048, compuerta antes de cerrar)', PROTOCOL)

    def test_mandatory_labels_and_entry_control(self):
        for label in SPEC['rotulos'].values():
            self.assertIn(label, PROTOCOL)
        self.assertEqual(SPEC['rotulos']['analitica'],
                         'Factibilidad experimental con datos sintéticos; no es desempeño predictivo real')
        self.assertEqual(SPEC['control_de_entrada']['manifiesto_requerido']['clase'], 'S')
        for code in SPEC['control_de_entrada']['rechazos']:
            self.assertIn(code, PROTOCOL)


class SyntheticWorldCoherenceTests(unittest.TestCase):
    def test_history_uses_rules_v1_and_never_intense_actions(self):
        policy = SPEC['politica_de_registro']
        scale = RULES['escala_intensidad']
        self.assertEqual(policy['reglas']['version'], RULES['version'])
        self.assertEqual(policy['intensidad_maxima_historial'], scale['maximo_automatico'])
        self.assertLess(max(policy['intensidades_registradas']), scale['intensa_desde'])
        self.assertTrue(0 < policy['fraccion_aleatoria'] < 1)
        self.assertTrue(0 < policy['capacidad_mensual_fraccion'] < 1)
        levels = len(scale['niveles'])
        for name in SCENARIOS:
            for effects in SPEC['escenarios'][name]['tau_por_intensidad'].values():
                self.assertEqual(len(effects), levels)
                self.assertEqual(effects[0], 0.0)

    def test_null_scenario_is_independent_of_everything(self):
        self.assertTrue(SCENARIOS <= set(SPEC['escenarios']))
        null = SPEC['escenarios']['NULO']
        self.assertTrue(all(value == 0.0 for value in null['beta'].values()))
        self.assertEqual((null['gamma_capacidad_latente'], null['eta_vulnerable'], null['shock']), (0.0, 0.0, None))
        self.assertTrue(all(value == 0.0 for value in null['theta_segmento'].values()))
        self.assertTrue(all(value == 0.0 for row in null['tau_por_intensidad'].values() for value in row))
        self.assertEqual(len(set(null['pi_total'].values())), 1)
        self.assertTrue(all(value == 0.0 for value in null['psi_regularizacion'].values()))

    def test_scenarios_share_structure_and_valid_probabilities(self):
        segments = set(SPEC['segmentos_plantados']['probabilidades'])
        self.assertAlmostEqual(sum(SPEC['segmentos_plantados']['probabilidades'].values()), 1.0)
        for name in SCENARIOS:
            scenario = SPEC['escenarios'][name]
            self.assertEqual(set(scenario['beta']), set(SPEC['escenarios']['PRINCIPAL']['beta']))
            for key in ('theta_segmento', 'tau_por_intensidad', 'pi_total', 'psi_regularizacion'):
                self.assertEqual(set(scenario[key]), segments)
            for key in ('pi_total', 'psi_regularizacion'):
                self.assertTrue(all(0 <= value <= 1 for value in scenario[key].values()))
            low, high = scenario['fraccion_parcial']
            self.assertTrue(0 < low < high <= 1)

    def test_variable_lists_are_closed_and_disjoint(self):
        variables = SPEC['variables']
        allowed = set(variables['permitidas'])
        audited = set(variables['con_auditoria_de_proxy'])
        banned = set(variables['prohibidas'])
        self.assertTrue(variables['lista_cerrada'])
        self.assertFalse(allowed & audited or allowed & banned or audited & banned)
        self.assertTrue({'vulnerable_sintetico', 'grupo_sintetico', 'segmento_plantado',
                         'capacidad_latente', 'shock_latente', 'salidas_de_reglas', 'domicilio'} <= banned)
        flags = set(RULES['banderas']['orden'])
        self.assertTrue({name for name in audited if name.isupper()} <= flags)
        self.assertNotIn('TIPO_PERSONA_DESCONOCIDO', audited)
        self.assertNotIn('VERIFICAR_PRESCRIPCION', audited)


class SyntheticWorldTimelineTests(unittest.TestCase):
    def setUp(self):
        self.split = SPEC['particion']
        self.target = SPEC['observaciones']
        self.months = SPEC['tiempo']['meses']

    def test_partition_is_contiguous_and_covers_the_history(self):
        order = ['calentamiento', 'entrenamiento', 'embargo', 'prueba', 'censurado']
        bounds = [self.split['meses'][name] for name in order]
        self.assertEqual(bounds[0][0], 1)
        self.assertEqual(bounds[-1][1], self.months)
        for previous, current in pairwise(bounds):
            self.assertEqual(current[0], previous[1] + 1)
        self.assertGreaterEqual(bounds[0][1], self.split['ventana_frecuencia_meses'])
        self.assertEqual(self.split['corte_entrenamiento_mes'], self.split['meses']['prueba'][0])

    def test_label_maturity_holds_for_any_calendar_start(self):
        delay = timedelta(days=self.target['variable_objetivo']['ventana_dias']
                          + self.target['campos_temporales']['rezago_registro_dias'])
        cutoff = self.split['corte_entrenamiento_mes']
        for start in range(1, 13):
            first = date(2026, start, 1)
            cycle = {m: month_start(first, m - 1) for m in range(1, self.months + 2)}
            end = cycle[self.months + 1]
            for role, (low, high) in self.split['meses'].items():
                for month in range(low, high + 1):
                    available = cycle[month] + delay
                    with self.subTest(start=calendar.month_abbr[start], role=role, month=month):
                        if role == 'entrenamiento':
                            self.assertLessEqual(available, cycle[cutoff])
                        if role == 'embargo':
                            self.assertGreater(available, cycle[cutoff])
                        if role in ('calentamiento', 'entrenamiento', 'embargo', 'prueba'):
                            self.assertLessEqual(available, end)
                        if role == 'censurado':
                            self.assertGreater(available, end)

    def test_analysis_thresholds_are_preregistered(self):
        clustering = SPEC['clustering']
        self.assertEqual((clustering['k']['min'], clustering['k']['max']), (3, 8))
        self.assertLess(clustering['estabilidad']['umbral_inestable'], clustering['estabilidad']['umbral_estable'])
        self.assertEqual(clustering['instante_referencia_mes'], self.split['corte_entrenamiento_mes'])
        self.assertEqual(SPEC['propension']['intervalo_nulo']['centro'], 0.5)
        self.assertEqual(SPEC['propension']['ajuste_de_hiperparametros'], 'Ninguno: valores fijos pre-registrados')
        seeds = SPEC['semillas']
        self.assertEqual(len(set(seeds['flujos_rng'])), len(seeds['flujos_rng']))
        self.assertNotIn(seeds['semilla_independiente_utilidad'],
                         range(seeds['principal'], seeds['principal'] + seeds['replicas']))

    def test_world_draws_are_indexed_by_object_cycle_and_purpose(self):
        seeds = SPEC['semillas']
        world = seeds['flujos_del_mundo']
        self.assertTrue(set(world) < set(seeds['flujos_rng']))
        self.assertEqual(list(seeds['acoplamiento']['propositos']), world)
        self.assertTrue(all(seeds['acoplamiento']['propositos'][stream] for stream in world))
        self.assertIn('índice del objeto, mes, índice del propósito', seeds['acoplamiento']['sorteo'])


class FeasibilityScopeTests(unittest.TestCase):
    """The planted-segment ARI is a published diagnostic, never a success or feasibility gate (ticket ALIGN-048)."""

    def resolve(self, path):
        node = SPEC
        for key in path.split('.'):
            node = node[key]
        return node

    def test_diagnostics_never_condition_feasibility(self):
        listed = SPEC['criterios']['no_condicionan_factibilidad']
        self.assertTrue({'clustering.cordura_plantados', 'criterios.hipotesis'} <= set(listed))
        for path in listed:
            node = self.resolve(path)
            if 'condiciona_factibilidad' in node or path.startswith('clustering.'):
                self.assertIs(node['condiciona_factibilidad'], False, path)
        self.assertNotIn('aprobado_si', SPEC['clustering']['cordura_plantados'])

    def test_feasibility_criteria_do_not_require_recovering_planted_structure(self):
        for key, text in SPEC['criterios']['factibilidad'].items():
            with self.subTest(criterion=key):
                self.assertNotIn('recuper', text.lower())
                self.assertNotIn('aprobad', text.lower())
        self.assertIn('ALIGN-063', SPEC['clustering']['cordura_plantados']['tension_con_ALIGN_063'])
        self.assertIn('Tensión con ALIGN-063', PROTOCOL)


if __name__ == '__main__':
    unittest.main()
