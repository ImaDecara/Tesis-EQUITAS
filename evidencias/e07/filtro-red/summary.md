# E07 - Smoke de navegador

SHA: `0e4e84ad7d1668cd5149dfd097590395dbe2fca5`. URL: https://tesis-equitas-5p7k3nwht-equitas.vercel.app.

Resultado: **fallido**; 1 recorrido, 3/5 comprobaciones aprobadas, cero omisiones.

- availability: aprobado
- login: aprobado
- dashboard: aprobado

expect(locator).toHaveValue(expected) failed

Locator:  getByLabel('Buscar por objeto o persona')
Expected: ""
Received: "E07-NO-EXISTE"
Timeout:  30000ms

Call log:
  - Expect "toHaveValue" getByLabel('Buscar por objeto o persona') with timeout 30000ms
  - waiting for getByLabel('Buscar por objeto o persona')
    62 × locator resolved to <input id="q" value="" name="q" placeholder="Ej: OBJ-001 o Perez" class="h-9 w-full rounded-md border border-slate-300 bg-white pr-3 pl-8 text-sm text-slate-900 outline-none ring-[#163a63]/20 transition focus:ring-4"/>
       - unexpected value "E07-NO-EXISTE"

