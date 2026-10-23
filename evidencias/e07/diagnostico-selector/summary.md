# E07 - Smoke de navegador

SHA: `4906c9b3019178131690f4c148d8d061e2c89eca`. URL: https://tesis-equitas-p2z915b23-equitas.vercel.app.

Resultado: **fallido**; 1 recorrido, 3/5 comprobaciones aprobadas, cero omisiones.

- availability: aprobado
- login: aprobado
- dashboard: aprobado

expect(locator).toBeVisible() failed

Locator: getByRole('table').getByRole('row').filter({ hasText: 'Persona sintetica A' })
Expected: visible
Error: strict mode violation: getByRole('table').getByRole('row').filter({ hasText: 'Persona sintetica A' }) resolved to 2 elements:
    1) <tr class="border-b transition-colors duration-150 data-[state=selected]:bg-[#e6eef8] hover:bg-[#eef3fa]">…</tr> aka getByRole('row', { name: 'Persona sintetica A Sin documento Bajo (20) 20.00 1', exact: true })
    2) <tr class="border-b transition-colors duration-150 data-[state=selected]:bg-[#e6eef8] hover:bg-[#eef3fa]">…</tr> aka getByRole('row', { name: 'Persona sintetica A Sin documento Bajo (20) 20.00 1 Disponible $ 1.250 Ver' })

Call log:
  - Expect "toBeVisible" getByRole('table').getByRole('row').filter({ hasText: 'Persona sintetica A' }) with timeout 30000ms
  - waiting for getByRole('table').getByRole('row').filter({ hasText: 'Persona sintetica A' })

