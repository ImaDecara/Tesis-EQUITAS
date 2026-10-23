# Informe académico de Calidad de Software

El entregable es [INFORME_ACADEMICO_CALIDAD.pdf](INFORME_ACADEMICO_CALIDAD.pdf). Su fuente editable es [INFORME_ACADEMICO_CALIDAD.md](INFORME_ACADEMICO_CALIDAD.md). Conserva carátula, integrantes, introducción y contenido aprovechable del avance recibido, y desarrolla los resultados actuales, metas, análisis crítico y conclusiones. No incluye índice.

El corte técnico es `1472eea8bbd87857a38a6fd0b05283ff9287eb44`, CI `39968499139`, 23/10/2026. Smoke y cargas conservan sus propias versiones/fechas. La fuente académica no modifica datos de cartera ni las pruebas del producto. La demostración final sigue en E11 y los dos tickets abiertos conservan su alcance y fecha de seguimiento.

## Regeneración

Desde la raíz del repositorio, con Python 3.12.14, preparar un entorno separado para el informe:

```powershell
python -m venv .quality/informe-venv
.quality/informe-venv/Scripts/python.exe -m pip install -r entrega/requirements-informe.txt
.quality/informe-venv/Scripts/python.exe entrega/generar_informe.py
```

En Linux se usa el Python del venv correspondiente. El generador requiere Arial normal, negrita, cursiva y Consolas. En Windows resuelve `Windows/Fonts`; en otro entorno se indica `--font-dir` con esos cuatro archivos TrueType. Se registran sus hashes; no se redistribuyen fuentes tipográficas.

Para actualizar el contenido se edita el Markdown y se regenera. Si cambian producto, configuración o pruebas, primero se agrega un corte nuevo de evidencia y se actualizan las referencias; regenerar un PDF no produce nuevos resultados de smoke o carga.

## Origen de figuras

- Logo UCC extraído sin modificación de la imagen incorporada en `tp-Calidad.md`.
- Cobertura calculada desde los numeradores/denominadores del CI técnico.
- Completitud calculada desde el mismo dataset DAT-06 rojo/verde.
- Captura de Personas del smoke E07 aceptado. El PDF muestra un detalle mediante recorte de visualización; el PNG original permanece intacto y el rectángulo se registra en el manifiesto.
- Estrés calculado desde las cinco fases de la campaña E08 aceptada. La línea objetivo se limita a los diez usuarios fijados previamente.

Los gráficos son vectoriales en el PDF y se exportan también como SVG para la fuente Markdown. [generacion.json](../evidencias/e10/generacion.json) registra versiones, hashes, fuentes y región mostrada de la captura. No se usan imágenes que simulen ejecuciones de terminal o de pipeline.

## Revisión de la exportación

Con Poppler disponible, desde la raíz:

```powershell
New-Item -ItemType Directory -Force .quality/informe-qa
pdftoppm -r 110 -png entrega/INFORME_ACADEMICO_CALIDAD.pdf .quality/informe-qa/page
```

Revisar todas las páginas: tablas y encabezados completos, legibilidad, cortes, caracteres, pies de figura, enlaces y coherencia de cifras. Las imágenes de revisión son auxiliares; el PDF publicado es la entrega. [Registro de E10](../REGISTRO_EJECUCION_E10.md) y [validación](../evidencias/e10/validacion-registros.json).
