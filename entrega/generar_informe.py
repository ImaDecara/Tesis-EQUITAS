"""Genera el informe PDF y sus gráficos desde Markdown y evidencia versionada."""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from urllib.parse import quote

from PIL import Image as PILImage
from reportlab.graphics import renderSVG
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.lineplots import LinePlot
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    CondPageBreak,
    Flowable,
    Image,
    KeepTogether,
    LongTable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    TableStyle,
    XPreformatted,
)

ROOT = Path(__file__).resolve().parents[1]
HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'INFORME_ACADEMICO_CALIDAD.md'
FIGURES = HERE / 'figuras'
EVIDENCE = ROOT / 'evidencias/e10'
WIDTH = 504
BLUE = colors.HexColor('#1e456a')
GRAY = colors.HexColor('#747f89')
PALE = colors.HexColor('#f1f4f6')
BORDER = colors.HexColor('#d9d9d9')
REPO = 'https://github.com/ImaDecara/Tesis-EQUITAS/blob/main/'


def read_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def digest(path: Path):
    if path.suffix.lower() in {'.md', '.py', '.json', '.svg', '.txt', '.log'}:
        return hashlib.sha256(path.read_text(encoding='utf-8-sig').encode('utf-8')).hexdigest()
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_fonts(font_dir: Path | None):
    if font_dir is None:
        font_dir = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'
    names = {'Body': 'arial.ttf', 'BodyBold': 'arialbd.ttf', 'BodyItalic': 'ariali.ttf', 'Mono': 'consola.ttf'}
    files = {}
    for name, filename in names.items():
        path = font_dir / filename
        if not path.is_file():
            raise FileNotFoundError(f'Falta {filename}; indicar --font-dir con fuentes TrueType compatibles.')
        pdfmetrics.registerFont(TTFont(name, str(path)))
        files[filename] = digest(path)
    pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodyBold', italic='BodyItalic', boldItalic='BodyBold')
    return files


def base_drawing(title, ylabel):
    d = Drawing(WIDTH, 244)
    d.add(String(WIDTH / 2, 228, title, textAnchor='middle', fontName='BodyBold', fontSize=11))
    d.add(String(8, 207, ylabel, fontName='Body', fontSize=9))
    return d


def legend(d, labels, fills):
    x = 154
    for label, fill in zip(labels, fills):
        d.add(Rect(x, 190, 10, 7, fillColor=fill, strokeColor=fill))
        d.add(String(x + 15, 189, label, fontName='Body', fontSize=9))
        x += 125


def bars(title, categories, data, labels, decimals=2):
    d = base_drawing(title, 'Porcentaje (%)')
    chart = VerticalBarChart()
    chart.x, chart.y, chart.width, chart.height = 45, 34, 440, 142
    chart.data = data
    chart.categoryAxis.categoryNames = categories
    chart.categoryAxis.labels.fontName = 'Body'
    chart.categoryAxis.labels.fontSize = 9
    chart.valueAxis.valueMin, chart.valueAxis.valueMax, chart.valueAxis.valueStep = 0, 112, 20
    chart.valueAxis.labels.fontName = 'Body'
    chart.valueAxis.labels.fontSize = 8
    chart.valueAxis.visibleGrid = True
    chart.valueAxis.gridStrokeColor = BORDER
    chart.bars[0].fillColor = BLUE
    chart.bars[1].fillColor = GRAY
    chart.bars.strokeColor = None
    chart.barLabelFormat = lambda v: f'{v:.{decimals}f}'.replace('.', ',')
    chart.barLabels.fontName = 'Body'
    chart.barLabels.fontSize = 8.5
    chart.barLabels.nudge = 6
    chart.groupSpacing = 18
    d.add(chart)
    legend(d, labels, [BLUE, GRAY])
    return d


def figures():
    summary = read_json(EVIDENCE / 'ci-summary.json')
    front = summary['components']['frontend']['metrics']['coverage']
    back = summary['components']['backend']['metrics']['coverage']
    coverage = bars('Cobertura por módulo al 23 de octubre de 2026', ['Sentencias', 'Ramas'], [
        [100 * front['statements']['covered'] / front['statements']['total'], 100 * front['branches']['covered'] / front['branches']['total']],
        [100 * back['covered_lines'] / back['num_statements'], 100 * back['covered_branches'] / back['num_branches']],
    ], ['Frontend', 'Backend'], 4)
    comparison = read_json(ROOT / 'evidencias/e03/comparacion-dat-06.json')
    rows = {x['serverMaxRows']: x for x in comparison['red'] if x['route'] == 'objetos'}
    complete = bars('Completitud de lectura con 3507 filas conocidas', ['Máximo 1000 por respuesta', 'Máximo 3000 por respuesta'], [
        [100 * rows[n]['received'] / rows[n]['expected'] for n in [1000, 3000]], [100, 100],
    ], ['Antes', 'Después'])
    load = read_json(ROOT / 'evidencias/e08/resultados.json')
    phases = load['campaigns']['stress']['phases']
    stress = base_drawing('Estrés de FastAPI con fuente sintética local', 'Latencia p95 (ms)')
    chart = LinePlot()
    chart.x, chart.y, chart.width, chart.height = 48, 38, 438, 137
    chart.data = [[(p['users'], p['p95_ms']) for p in phases], [(1, 2000), (10, 2000)]]
    chart.xValueAxis.valueMin, chart.xValueAxis.valueMax, chart.xValueAxis.valueSteps = 0, 40, [1, 5, 10, 20, 30, 40]
    chart.yValueAxis.valueMin, chart.yValueAxis.valueMax, chart.yValueAxis.valueStep = 0, 2200, 500
    for axis in [chart.xValueAxis, chart.yValueAxis]:
        axis.labels.fontName, axis.labels.fontSize = 'Body', 8
    chart.yValueAxis.visibleGrid = True
    chart.yValueAxis.gridStrokeColor = BORDER
    chart.lines[0].strokeColor, chart.lines[0].strokeWidth = BLUE, 2
    chart.lines[1].strokeColor, chart.lines[1].strokeWidth = GRAY, 1.3
    chart.lines[1].strokeDashArray = [4, 3]
    stress.add(chart)
    stress.add(String(WIDTH / 2, 12, 'Usuarios virtuales', textAnchor='middle', fontName='Body', fontSize=9))
    legend(stress, ['p95 observado', 'Objetivo hasta 10'], [BLUE, GRAY])
    result = {'cobertura-actual.svg': coverage, 'completitud-dat.svg': complete, 'estres-p95.svg': stress}
    FIGURES.mkdir(exist_ok=True)
    for name, drawing in result.items():
        renderSVG.drawToFile(drawing, str(FIGURES / name))
        svg = FIGURES / name
        svg.write_bytes(svg.read_bytes().replace(b'\r\n', b'\n'))
    inputs = ['evidencias/e10/ci-summary.json', 'evidencias/e03/comparacion-dat-06.json', 'evidencias/e08/resultados.json', 'evidencias/e07/personas.png', 'tp-Calidad.md']
    return result, {name: digest(ROOT / name) for name in inputs}


def url_for(target):
    if target.startswith(('https://', 'http://', 'mailto:')):
        return target
    path, mark, anchor = target.partition('#')
    resolved = (SOURCE.parent / path).resolve()
    relative = resolved.relative_to(ROOT).as_posix()
    return REPO + quote(relative) + ('#' + quote(anchor) if mark else '')


def inline(text):
    pattern = r'(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))'
    output = []
    for part in re.split(pattern, text):
        if part.startswith('`') and part.endswith('`'):
            output.append('<font name="Mono" size="8.7">' + html.escape(part[1:-1]) + '</font>')
        elif part.startswith('**') and part.endswith('**'):
            output.append('<b>' + html.escape(part[2:-2]) + '</b>')
        elif part.startswith('[') and '](' in part and part.endswith(')'):
            label, dest = part[1:-1].split('](', 1)
            output.append('<link href="' + html.escape(url_for(dest), quote=True) + '" color="#1e456a">' + html.escape(label) + '</link>')
        else:
            output.append(html.escape(part))
    return ''.join(output)


def styles():
    s = getSampleStyleSheet()
    for style in s.byName.values():
        style.fontName = 'Body'
        style.textColor = colors.black
    s.add(ParagraphStyle('Prose', fontName='Body', fontSize=11, leading=14.7, alignment=TA_LEFT, spaceAfter=6, allowWidows=0, allowOrphans=0))
    s.add(ParagraphStyle('Section', fontName='BodyBold', fontSize=14.5, leading=18, textColor=colors.black, spaceBefore=14, spaceAfter=8, keepWithNext=True))
    s.add(ParagraphStyle('Subsection', fontName='BodyBold', fontSize=12, leading=15, textColor=colors.black, spaceBefore=10, spaceAfter=6, keepWithNext=True))
    s.add(ParagraphStyle('Cell', fontName='Body', fontSize=9.4, leading=12.2, alignment=TA_LEFT, spaceAfter=0, splitLongWords=True))
    s.add(ParagraphStyle('CellHead', parent=s['Cell'], fontName='BodyBold', textColor=colors.white))
    s.add(ParagraphStyle('CaptionText', fontName='Body', fontSize=9.2, leading=12, spaceBefore=5, spaceAfter=9, alignment=TA_LEFT))
    s.add(ParagraphStyle('CodeBlock', fontName='Mono', fontSize=8.7, leading=11, spaceBefore=5, spaceAfter=10, backColor=PALE, borderPadding=7))
    s.add(ParagraphStyle('Cover', fontName='Body', fontSize=11.5, leading=17, alignment=TA_CENTER, spaceAfter=5))
    s.add(ParagraphStyle('CoverTitle', parent=s['Cover'], fontName='BodyBold', fontSize=24, leading=30, spaceAfter=12))
    s.add(ParagraphStyle('CoverSubtitle', parent=s['Cover'], fontName='BodyBold', fontSize=14, leading=19))
    return s


def widths(headers):
    n = len(headers)
    first = headers[0]
    if first.startswith('Criterio') and n == 5: return [240, 54, 70, 70, 70]
    if first.startswith('Grupo disjunto'): return [135, 70, 299]
    if first.startswith('Regla'): return [45, 95, 105, 203, 56]
    if first.startswith('Característica'): return [109, 124, 137, 134]
    if first.startswith('Fase') and n == 6: return [63, 105, 92, 69, 57, 118]
    if first.startswith('Momento'): return [111, 111, 111, 171]
    if first.startswith('Requisito'): return [111, 217, 176]
    if n == 2: return [135, 369]
    if n == 3: return [130, 145, 229]
    if n == 4: return [112, 121, 133, 138]
    if n == 5: return [60, 110, 110, 164, 60]
    if n == 6: return [75, 105, 90, 65, 65, 104]
    return [WIDTH / n] * n


def table(lines, s):
    values = [[c.strip() for c in line.strip().strip('|').split('|')] for line in lines]
    values = [row for row in values if not all(re.fullmatch(r':?-+:?', v.strip()) for v in row)]
    col_widths = widths(values[0])
    if sum(col_widths) != WIDTH: raise ValueError('El ancho de tabla no coincide con la caja de texto.')
    rows = [[Paragraph(inline(v), s['CellHead'] if i == 0 else s['Cell']) for v in row] for i, row in enumerate(values)]
    result = LongTable(rows, colWidths=col_widths, repeatRows=1, hAlign='LEFT', spaceBefore=3, spaceAfter=10)
    commands = [('BACKGROUND', (0, 0), (-1, 0), BLUE), ('GRID', (0, 0), (-1, -1), 0.45, BORDER), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6), ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]
    for i in range(1, len(rows)):
        commands.append(('BACKGROUND', (0, i), (-1, i), colors.white if i % 2 else PALE))
    result.setStyle(TableStyle(commands))
    return result


def cover(s):
    story = [Spacer(1, 22), Paragraph('UNIVERSIDAD CATÓLICA DE CÓRDOBA', s['CoverSubtitle']), Spacer(1, 15)]
    story += [Image(str(FIGURES / 'ucc-original.png'), width=88, height=88 * 320 / 323), Spacer(1, 16)]
    for text in ['FACULTAD DE INGENIERÍA', 'INGENIERÍA DE SISTEMAS']:
        story.append(Paragraph(text, s['Cover']))
    story += [Spacer(1, 35), Paragraph('Calidad de Software', s['CoverTitle']), Paragraph('Trabajo Práctico Integrador', s['CoverSubtitle']), Spacer(1, 7), Paragraph('Evaluación del primer MVP de EQUITAS', s['Cover']), Spacer(1, 28), Paragraph('<b>Estudiantes</b>', s['Cover'])]
    for text in ['Ignacio Magoia', 'Axel Azcune', 'Imanol Decara']:
        story.append(Paragraph(text, s['Cover']))
    story += [Spacer(1, 20), Paragraph('Nivel 2 Prototipo parcial', s['Cover']), Spacer(1, 22), Paragraph('Córdoba, 2026', s['Cover']), Paragraph('Presentación 26 de octubre de 2026', s['Cover']), Paragraph('Corte de resultados 23 de octubre de 2026', s['Cover']), PageBreak()]
    return story


class ScreenshotDetail(Flowable):
    """Recorta en el PDF la región declarada, preservando la captura original."""
    def __init__(self, path, box):
        super().__init__()
        self.path, self.box = path, box
        self.image_width, self.image_height = PILImage.open(path).size
        self.width = WIDTH
        self.scale = WIDTH / (box[2] - box[0])
        self.height = (box[3] - box[1]) * self.scale

    def draw(self):
        x0, y0, x1, y1 = self.box
        canv = self.canv
        canv.saveState()
        clip = canv.beginPath()
        clip.rect(0, 0, self.width, self.height)
        canv.clipPath(clip, stroke=0, fill=0)
        canv.drawImage(ImageReader(str(self.path)), -x0 * self.scale, -(self.image_height - y1) * self.scale, width=self.image_width * self.scale, height=self.image_height * self.scale)
        canv.restoreState()


def add_heading(story, text, style, lines, index, s):
    paragraph = Paragraph(inline(text), style)
    cursor = index + 1
    while cursor < len(lines) and not lines[cursor].strip(): cursor += 1
    if cursor < len(lines) and lines[cursor].startswith('|'):
        # Mantener título y primeras filas sin trasladar una tabla completa.
        block = lines[cursor:cursor + 3]
        first_rows = table(block, s)
        _, row_height = first_rows.wrap(WIDTH, 1000)
        _, title_height = paragraph.wrap(WIDTH, 1000)
        story.append(CondPageBreak(row_height + title_height + style.spaceBefore + style.spaceAfter + 16))
        paragraph.keepWithNext = False
    story.append(paragraph)


def parse_source(s, charts):
    text = SOURCE.read_text(encoding='utf-8').split('<!-- salto -->', 1)[1]
    lines = text.splitlines()
    story = cover(s)
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith('<!--'):
            if line == '<!-- salto -->': story.append(PageBreak())
            i += 1
            continue
        if line.startswith('### '):
            add_heading(story, line[4:], s['Subsection'], lines, i, s)
            i += 1
            continue
        if line.startswith('## '):
            add_heading(story, line[3:], s['Section'], lines, i, s)
            i += 1
            continue
        if line.startswith('```'):
            block = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                block.append(html.escape(lines[i]))
                i += 1
            story.append(XPreformatted('\n'.join(block), s['CodeBlock']))
            i += 1
            continue
        if line.startswith('|'):
            block = []
            while i < len(lines) and lines[i].lstrip().startswith('|'):
                block.append(lines[i])
                i += 1
            story.append(table(block, s))
            continue
        image_match = re.fullmatch(r'!\[([^]]*)\]\(([^)]+)\)', line)
        if image_match:
            target = (SOURCE.parent / image_match[2]).resolve()
            if target.suffix == '.svg':
                picture = charts[target.name]
            elif target.name == 'personas.png':
                picture = ScreenshotDetail(target, (312, 775, 1420, 1057))
            else:
                w, h = PILImage.open(target).size
                picture = Image(str(target), width=WIDTH, height=WIDTH * h / w)
            group = [picture]
            i += 1
            while i < len(lines) and not lines[i].strip(): i += 1
            if i < len(lines) and lines[i].startswith('Figura'):
                group.append(Paragraph(inline(lines[i]), s['CaptionText']))
                i += 1
            story.append(KeepTogether(group))
            continue
        paragraph = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not lines[i].startswith(('#', '|', '```', '![')):
            paragraph.append(lines[i].strip())
            i += 1
        story.append(Paragraph(inline(' '.join(paragraph)), s['Prose']))
    return story


class ReportCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        kwargs['invariant'] = 1
        super().__init__(*args, **kwargs)
        self.setTitle('Calidad de Software en EQUITAS')
        self.setAuthor('Ignacio Magoia, Axel Azcune e Imanol Decara')
        self.setSubject('Trabajo Practico Integrador de Calidad de Software')
        self.setCreator('Equipo EQUITAS')
        self.setKeywords('EQUITAS, Calidad de Software, Nivel 2, 2026')


def footer(canv, doc):
    if doc.page == 1: return
    canv.saveState()
    canv.setFont('Body', 8.5)
    canv.setFillColor(colors.HexColor('#444444'))
    canv.drawString(54, 31, 'EQUITAS  |  Calidad de Software  |  Octubre 2026')
    canv.drawRightString(558, 31, str(doc.page))
    canv.restoreState()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--font-dir', type=Path)
    parser.add_argument('--output', type=Path, default=HERE / 'INFORME_ACADEMICO_CALIDAD.pdf')
    parser.add_argument('--manifest', type=Path, default=EVIDENCE / 'generacion.json')
    args = parser.parse_args()
    font_hashes = load_fonts(args.font_dir)
    # Fecha documental fija para poder reproducir el binario del corte publicado.
    os.environ['SOURCE_DATE_EPOCH'] = str(int(datetime(2026, 10, 23, tzinfo=timezone.utc).timestamp()))
    charts, inputs = figures()
    s = styles()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(args.output), pagesize=letter, leftMargin=54, rightMargin=54, topMargin=46, bottomMargin=49, pageCompression=1, title='Calidad de Software en EQUITAS', author='Ignacio Magoia, Axel Azcune e Imanol Decara', creator='Equipo EQUITAS', subject='Trabajo Practico Integrador de Calidad de Software', keywords='EQUITAS, Calidad de Software, Nivel 2, 2026')
    doc.build(parse_source(s, charts), onFirstPage=footer, onLaterPages=footer, canvasmaker=ReportCanvas)
    manifest = {'source': SOURCE.relative_to(ROOT).as_posix(), 'source_sha256_normalized_LF': hashlib.sha256(SOURCE.read_text(encoding='utf-8').encode()).hexdigest(), 'pdf': args.output.resolve().relative_to(ROOT).as_posix(), 'pdf_sha256': digest(args.output), 'packages': {n: version(n) for n in ['reportlab', 'pillow', 'pypdf']}, 'fonts_sha256': font_hashes, 'figure_inputs_sha256': inputs, 'figures_sha256': {(FIGURES / n).relative_to(ROOT).as_posix(): digest(FIGURES / n) for n in charts}, 'screenshot_detail': {'source': 'evidencias/e07/personas.png', 'box_pixels_left_top_right_bottom': [312, 775, 1420, 1057], 'method': 'PDF clipping only; original PNG unchanged'}, 'scope': 'Report generated from measured project evidence; screenshots retain original run and date.'}
    manifest['generator_sha256'] = digest(Path(__file__))
    manifest['document_date'] = '2026-10-23'
    manifest['text_hash_normalization'] = 'UTF-8 with LF line endings for Markdown, Python, JSON, SVG, text and logs; binary PDF, PNG and fonts use raw bytes.'
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'pdf': str(args.output), 'sha256': manifest['pdf_sha256'], 'packages': manifest['packages']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
