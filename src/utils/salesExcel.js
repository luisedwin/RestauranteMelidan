/**
 * src/utils/salesExcel.js - Generador Nativo OOXML (.xlsx) de Reporte Detallado de Ventas (Melidan)
 * Sin dependencias externas: genera un archivo Excel 100% estándar compatible con Microsoft Excel,
 * Excel Online, LibreOffice Calc y Google Sheets, incluyendo:
 * - Hoja 1 "Resumen Ejecutivo": Tablas KPI, Ventas por Medio de Pago, Ventas por Categoría,
 *   Top 10 Platos Más Vendidos + Gráfico de Barras nativo + Gráfico de Pastel nativo.
 * - Hoja 2 "Platos Vendidos": Tabla completa de todos los platos vendidos con cantidades, precios e ingresos.
 * - Hoja 3 "Detalle de Ventas": Registro completo de cada comprobante/venta con totales, IGV y platos.
 * - Hoja 4 "Detalle por Ítem": Auditoría línea por línea de cada plato vendido por comprobante.
 */

const zlib = require('zlib');

// ============================================================================
// 1. UTILIDADES XML Y ZIP (CRC32 + DEFLATE RAW)
// ============================================================================
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function getDosDateTime(date = new Date()) {
  const yr = Math.max(1980, date.getFullYear()) - 1980;
  const mo = date.getMonth() + 1;
  const dy = date.getDate();
  const hr = date.getHours();
  const mn = date.getMinutes();
  const sc = Math.floor(date.getSeconds() / 2);
  return {
    dosDate: ((yr & 0x7f) << 9) | ((mo & 0x0f) << 5) | (dy & 0x1f),
    dosTime: ((hr & 0x1f) << 11) | ((mn & 0x3f) << 5) | (sc & 0x1f)
  };
}

function buildZipBuffer(entries) {
  const { dosDate, dosTime } = getDosDateTime(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const rawBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const compBuf = zlib.deflateRawSync(rawBuf, { level: 6 });
    const checksum = crc32(rawBuf);

    // Local File Header (30 bytes + filename)
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8 flag
    lh.writeUInt16LE(8, 8);      // DEFLATE
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(checksum, 14);
    lh.writeUInt32LE(compBuf.length, 18);
    lh.writeUInt32LE(rawBuf.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    localParts.push(lh, nameBuf, compBuf);

    // Central Directory Header (46 bytes + filename)
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(checksum, 16);
    ch.writeUInt32LE(compBuf.length, 20);
    ch.writeUInt32LE(rawBuf.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);

    centralParts.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + compBuf.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function xmlEscape(val) {
  return String(val ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colLetter(colIndex1Based) {
  let n = colIndex1Based;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellRef(col1, row1) {
  return `${colLetter(col1)}${row1}`;
}

function round2(n) {
  return Number((Number(n || 0)).toFixed(2));
}

// ============================================================================
// 2. TABLA DE CADENAS COMPARTIDAS Y CONSTRUCTOR DE HOJAS
// ============================================================================
class SharedStrings {
  constructor() {
    this.map = new Map();
    this.list = [];
  }

  add(str) {
    const clean = String(str ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    if (this.map.has(clean)) return this.map.get(clean);
    const idx = this.list.length;
    this.list.push(clean);
    this.map.set(clean, idx);
    return idx;
  }

  toXml() {
    const items = this.list.map((s) => {
      const needsPreserve = /^\s|\s$|\n/.test(s);
      return `<si><t${needsPreserve ? ' xml:space="preserve"' : ''}>${xmlEscape(s)}</t></si>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.list.length}" uniqueCount="${this.list.length}">${items}</sst>`;
  }
}

class SheetBuilder {
  constructor(name, sst, options = {}) {
    this.name = name;
    this.sst = sst;
    this.rows = new Map(); // rowIndex (1-based) -> { height, cells: Map(col1 -> cellObj) }
    this.merges = [];
    this.colWidths = options.colWidths || [];
    this.freezeRow = options.freezeRow || 0;
    this.autoFilterRange = options.autoFilterRange || '';
    this.drawingRelId = options.drawingRelId || '';
    this.maxRow = 1;
    this.maxCol = 1;
  }

  ensureRow(r, height = null) {
    if (!this.rows.has(r)) {
      this.rows.set(r, { height, cells: new Map() });
    } else if (height !== null) {
      this.rows.get(r).height = height;
    }
    if (r > this.maxRow) this.maxRow = r;
    return this.rows.get(r);
  }

  setRowHeight(r, height) {
    this.ensureRow(r, height);
  }

  setString(col, row, value, style = 0) {
    const rowObj = this.ensureRow(row);
    if (col > this.maxCol) this.maxCol = col;
    rowObj.cells.set(col, { type: 's', v: this.sst.add(value), s: style });
  }

  setNumber(col, row, value, style = 0) {
    const rowObj = this.ensureRow(row);
    if (col > this.maxCol) this.maxCol = col;
    const num = Number.isFinite(Number(value)) ? Number(value) : 0;
    rowObj.cells.set(col, { type: 'n', v: num, s: style });
  }

  setFormula(col, row, formula, cachedValue, style = 0) {
    const rowObj = this.ensureRow(row);
    if (col > this.maxCol) this.maxCol = col;
    const num = Number.isFinite(Number(cachedValue)) ? Number(cachedValue) : 0;
    rowObj.cells.set(col, { type: 'f', f: formula, v: num, s: style });
  }

  setBlank(col, row, style = 0) {
    const rowObj = this.ensureRow(row);
    if (col > this.maxCol) this.maxCol = col;
    rowObj.cells.set(col, { type: 'b', s: style });
  }

  merge(c1, r1, c2, r2, fillStyle = null) {
    this.merges.push(`${cellRef(c1, r1)}:${cellRef(c2, r2)}`);
    if (fillStyle !== null) {
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          if (r === r1 && c === c1) continue;
          const rowObj = this.ensureRow(r);
          if (!rowObj.cells.has(c)) {
            this.setBlank(c, r, fillStyle);
          }
        }
      }
    }
  }

  toXml() {
    const dim = `A1:${cellRef(this.maxCol, this.maxRow)}`;

    const paneXml = this.freezeRow > 0
      ? `<pane ySplit="${this.freezeRow}" topLeftCell="A${this.freezeRow + 1}" activePane="bottomLeft" state="frozen"/>`
      : '';
    const sheetViewsXml = `<sheetViews><sheetView workbookViewId="0" showGridLines="1">${paneXml}</sheetView></sheetViews>`;

    const colsXml = this.colWidths.length > 0
      ? `<cols>${this.colWidths.map((w, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      : '';

    const sortedRowNums = [...this.rows.keys()].sort((a, b) => a - b);
    const rowsXml = sortedRowNums.map((rNum) => {
      const rObj = this.rows.get(rNum);
      const sortedCols = [...rObj.cells.keys()].sort((a, b) => a - b);
      const cellsXml = sortedCols.map((cNum) => {
        const cell = rObj.cells.get(cNum);
        const ref = cellRef(cNum, rNum);
        const sAttr = cell.s ? ` s="${cell.s}"` : '';
        if (cell.type === 's') {
          return `<c r="${ref}"${sAttr} t="s"><v>${cell.v}</v></c>`;
        }
        if (cell.type === 'n') {
          return `<c r="${ref}"${sAttr}><v>${cell.v}</v></c>`;
        }
        if (cell.type === 'f') {
          return `<c r="${ref}"${sAttr}><f>${xmlEscape(cell.f)}</f><v>${cell.v}</v></c>`;
        }
        return `<c r="${ref}"${sAttr}/>`;
      }).join('');
      const htAttr = rObj.height ? ` ht="${rObj.height}" customHeight="1"` : '';
      return `<row r="${rNum}"${htAttr}>${cellsXml}</row>`;
    }).join('');

    const autoFilterXml = this.autoFilterRange
      ? `<autoFilter ref="${this.autoFilterRange}"/>`
      : '';
    const mergeXml = this.merges.length > 0
      ? `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
      : '';
    const drawingXml = this.drawingRelId
      ? `<drawing r:id="${this.drawingRelId}"/>`
      : '';

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<dimension ref="${dim}"/>` +
      sheetViewsXml +
      `<sheetFormatPr defaultRowHeight="20"/>` +
      colsXml +
      `<sheetData>${rowsXml}</sheetData>` +
      autoFilterXml +
      mergeXml +
      `<pageMargins left="0.5" right="0.5" top="0.7" bottom="0.7" header="0.3" footer="0.3"/>` +
      drawingXml +
      `</worksheet>`;
  }
}

// ============================================================================
// 3. HOJA DE ESTILOS CORPORATIVOS MELIDAN (xl/styles.xml)
// ============================================================================
function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="&quot;S/ &quot;#,##0.00"/>
    <numFmt numFmtId="165" formatCode="#,##0"/>
    <numFmt numFmtId="166" formatCode="0.0%"/>
  </numFmts>
  <fonts count="8">
    <font><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><i/><sz val="10"/><color rgb="FF475569"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFC2410C"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF065F46"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="9">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFF5722"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF009B77"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF7ED"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFECFDF5"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="4">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FF1E293B"/></top>
      <bottom style="medium"><color rgb="FF1E293B"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FF94A3B8"/></left>
      <right style="thin"><color rgb="FF94A3B8"/></right>
      <top style="thin"><color rgb="FF94A3B8"/></top>
      <bottom style="thin"><color rgb="FF94A3B8"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="27">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="7" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="7" fillId="4" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="6" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="164" fontId="5" fillId="6" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="4" fillId="6" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="4" fillId="6" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="164" fontId="5" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="6" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;
}

const S = {
  TITLE: 1,
  SUBTITLE: 2,
  SEC_ORANGE: 3,
  SEC_TEAL: 4,
  TH_LEFT: 5,
  TH_CENTER: 6,
  TH_RIGHT: 7,
  TXT: 8,
  TXT_Z: 9,
  CTR: 10,
  CTR_Z: 11,
  CUR: 12,
  CUR_Z: 13,
  INT: 14,
  INT_Z: 15,
  PCT: 16,
  PCT_Z: 17,
  TOT_LBL: 18,
  TOT_CUR: 19,
  TOT_INT: 20,
  TOT_PCT: 21,
  KPI_LBL: 22,
  KPI_CUR: 23,
  KPI_INT: 24,
  WRAP: 25,
  WRAP_Z: 26
};

// ============================================================================
// 4. GRÁFICOS NATIVOS DE EXCEL (BARRAS Y PASTEL) + ANCLAJES DRAWINGML
// ============================================================================
function buildChartTitleXml(titleText) {
  return `<c:title>
    <c:tx>
      <c:rich>
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr><a:defRPr sz="1300" b="1"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill></a:defRPr></a:pPr>
          <a:r>
            <a:rPr lang="es-PE" sz="1300" b="1"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill></a:rPr>
            <a:t>${xmlEscape(titleText)}</a:t>
          </a:r>
        </a:p>
      </c:rich>
    </c:tx>
    <c:overlay val="0"/>
  </c:title>`;
}

function buildBarChartXml({ title, seriesName, catFormula, valFormula, categories, values }) {
  const strPts = categories
    .map((label, i) => `<c:pt idx="${i}"><c:v>${xmlEscape(label)}</c:v></c:pt>`)
    .join('');
  const numPts = values
    .map((val, i) => `<c:pt idx="${i}"><c:v>${Number(val || 0)}</c:v></c:pt>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:lang val="es-PE"/>
  <c:roundedCorners val="1"/>
  <c:chart>
    ${buildChartTitleXml(title)}
    <c:autoTitleDeleted val="0"/>
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="bar"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:tx><c:v>${xmlEscape(seriesName)}</c:v></c:tx>
          <c:spPr>
            <a:solidFill><a:srgbClr val="FF5722"/></a:solidFill>
            <a:ln w="9525"><a:solidFill><a:srgbClr val="C2410C"/></a:solidFill></a:ln>
          </c:spPr>
          <c:invertIfNegative val="0"/>
          <c:dLbls>
            <c:showLegendKey val="0"/>
            <c:showVal val="1"/>
            <c:showCatName val="0"/>
            <c:showSerName val="0"/>
            <c:showPercent val="0"/>
            <c:showBubbleSize val="0"/>
          </c:dLbls>
          <c:cat>
            <c:strRef>
              <c:f>${xmlEscape(catFormula)}</c:f>
              <c:strCache>
                <c:ptCount val="${categories.length}"/>
                ${strPts}
              </c:strCache>
            </c:strRef>
          </c:cat>
          <c:val>
            <c:numRef>
              <c:f>${xmlEscape(valFormula)}</c:f>
              <c:numCache>
                <c:formatCode>#,##0</c:formatCode>
                <c:ptCount val="${values.length}"/>
                ${numPts}
              </c:numCache>
            </c:numRef>
          </c:val>
        </c:ser>
        <c:gapWidth val="75"/>
        <c:axId val="1001"/>
        <c:axId val="1002"/>
      </c:barChart>
      <c:catAx>
        <c:axId val="1001"/>
        <c:scaling><c:orientation val="maxMin"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:majorTickMark val="none"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill></a:ln></c:spPr>
        <c:crossAx val="1002"/>
        <c:crosses val="max"/>
        <c:auto val="1"/>
        <c:lblAlgn val="ctr"/>
        <c:lblOffset val="100"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="1002"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:majorGridlines>
          <c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln></c:spPr>
        </c:majorGridlines>
        <c:numFmt formatCode="#,##0" sourceLinked="0"/>
        <c:majorTickMark val="none"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill></a:ln></c:spPr>
        <c:crossAx val="1001"/>
        <c:crosses val="autoZero"/>
        <c:crossBetween val="between"/>
      </c:valAx>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
  </c:chart>
  <c:spPr>
    <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
    <a:ln w="12700"><a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill></a:ln>
  </c:spPr>
</c:chartSpace>`;
}

function buildPieChartXml({ title, seriesName, catFormula, valFormula, categories, values }) {
  const palette = ['FF5722', '009B77', '2563EB', 'F59E0B', '7C3AED', 'E11D48', '0EA5E9', '10B981', '64748B'];
  const dPts = categories.map((_, i) => `
    <c:dPt>
      <c:idx val="${i}"/>
      <c:bubble3D val="0"/>
      <c:spPr>
        <a:solidFill><a:srgbClr val="${palette[i % palette.length]}"/></a:solidFill>
        <a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln>
      </c:spPr>
    </c:dPt>`).join('');

  const strPts = categories
    .map((label, i) => `<c:pt idx="${i}"><c:v>${xmlEscape(label)}</c:v></c:pt>`)
    .join('');
  const numPts = values
    .map((val, i) => `<c:pt idx="${i}"><c:v>${round2(val)}</c:v></c:pt>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:lang val="es-PE"/>
  <c:roundedCorners val="1"/>
  <c:chart>
    ${buildChartTitleXml(title)}
    <c:autoTitleDeleted val="0"/>
    <c:plotArea>
      <c:layout/>
      <c:pieChart>
        <c:varyColors val="1"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:tx><c:v>${xmlEscape(seriesName)}</c:v></c:tx>
          ${dPts}
          <c:dLbls>
            <c:showLegendKey val="0"/>
            <c:showVal val="0"/>
            <c:showCatName val="0"/>
            <c:showSerName val="0"/>
            <c:showPercent val="1"/>
            <c:showBubbleSize val="0"/>
            <c:showLeaderLines val="1"/>
          </c:dLbls>
          <c:cat>
            <c:strRef>
              <c:f>${xmlEscape(catFormula)}</c:f>
              <c:strCache>
                <c:ptCount val="${categories.length}"/>
                ${strPts}
              </c:strCache>
            </c:strRef>
          </c:cat>
          <c:val>
            <c:numRef>
              <c:f>${xmlEscape(valFormula)}</c:f>
              <c:numCache>
                <c:formatCode>"S/ "#,##0.00</c:formatCode>
                <c:ptCount val="${values.length}"/>
                ${numPts}
              </c:numCache>
            </c:numRef>
          </c:val>
        </c:ser>
        <c:firstSliceAng val="0"/>
      </c:pieChart>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="r"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
  </c:chart>
  <c:spPr>
    <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
    <a:ln w="12700"><a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill></a:ln>
  </c:spPr>
</c:chartSpace>`;
}

function buildDrawingXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>16</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>20</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="2" name="Grafico Barras Platos Vendidos"/>
        <xdr:cNvGraphicFramePr/>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart r:id="rId1"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>21</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>16</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>39</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="3" name="Grafico Pastel Ventas por Categoria"/>
        <xdr:cNvGraphicFramePr/>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart r:id="rId2"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`;
}

// ============================================================================
// 5. AGREGACIÓN DE DATOS Y GENERACIÓN DEL LIBRO EXCEL (.XLSX)
// ============================================================================
function aggregateSalesData(sales = [], itemLines = []) {
  const totalReceipts = sales.length;
  const totalSales = round2(sales.reduce((acc, s) => acc + Number(s.monto_total || 0), 0));
  const totalSubtotal = round2(totalSales / 1.18);
  const totalIgv = round2(totalSales - totalSubtotal);
  const avgTicket = totalReceipts > 0 ? round2(totalSales / totalReceipts) : 0;

  // Agrupación por canal de pago
  const payMap = new Map();
  for (const s of sales) {
    const ch = String(s.canal_pago || 'Efectivo').trim() || 'Efectivo';
    if (!payMap.has(ch)) payMap.set(ch, { canal: ch, comprobantes: 0, total: 0 });
    const entry = payMap.get(ch);
    entry.comprobantes += 1;
    entry.total = round2(entry.total + Number(s.monto_total || 0));
  }
  const paymentSummary = [...payMap.values()].sort((a, b) => b.total - a.total);
  if (paymentSummary.length === 0) {
    paymentSummary.push({ canal: 'Sin ventas', comprobantes: 0, total: 0 });
  }

  // Agrupación por plato vendido y por categoría
  const dishMap = new Map();
  const catMap = new Map();
  let totalUnits = 0;
  let totalItemsRevenue = 0;

  for (const ln of itemLines) {
    const qty = Number(ln.cantidad || 0);
    const unitPrice = Number(ln.precio_unitario || 0);
    const lineSub = round2(ln.subtotal !== undefined ? Number(ln.subtotal) : qty * unitPrice);
    const dishName = String(ln.nombre_plato || 'Producto').trim();
    const catName = String(ln.categoria_nombre || 'Otros').trim() || 'Otros';
    const station = String(ln.estacion || 'Cocina').trim() || 'Cocina';
    const orderId = ln.id_pedido || ln.numero_comprobante || 0;

    totalUnits += qty;
    totalItemsRevenue = round2(totalItemsRevenue + lineSub);

    const dishKey = `${dishName}__${catName}`;
    if (!dishMap.has(dishKey)) {
      dishMap.set(dishKey, {
        nombre_plato: dishName,
        categoria_nombre: catName,
        estacion: station,
        unidades: 0,
        ingresos: 0,
        pedidosSet: new Set()
      });
    }
    const dEntry = dishMap.get(dishKey);
    dEntry.unidades += qty;
    dEntry.ingresos = round2(dEntry.ingresos + lineSub);
    if (orderId) dEntry.pedidosSet.add(orderId);

    if (!catMap.has(catName)) {
      catMap.set(catName, {
        categoria: catName,
        platosSet: new Set(),
        unidades: 0,
        ingresos: 0
      });
    }
    const cEntry = catMap.get(catName);
    cEntry.platosSet.add(dishName);
    cEntry.unidades += qty;
    cEntry.ingresos = round2(cEntry.ingresos + lineSub);
  }

  const dishesSummary = [...dishMap.values()]
    .map((d) => ({
      nombre_plato: d.nombre_plato,
      categoria_nombre: d.categoria_nombre,
      estacion: d.estacion,
      pedidos: d.pedidosSet.size,
      unidades: d.unidades,
      precio_promedio: d.unidades > 0 ? round2(d.ingresos / d.unidades) : 0,
      ingresos: d.ingresos,
      share: totalItemsRevenue > 0 ? d.ingresos / totalItemsRevenue : 0
    }))
    .sort((a, b) => b.unidades - a.unidades || b.ingresos - a.ingresos);

  const categorySummary = [...catMap.values()]
    .map((c) => ({
      categoria: c.categoria,
      platos_distintos: c.platosSet.size,
      unidades: c.unidades,
      ingresos: c.ingresos,
      share: totalItemsRevenue > 0 ? c.ingresos / totalItemsRevenue : 0
    }))
    .sort((a, b) => b.ingresos - a.ingresos || b.unidades - a.unidades);

  return {
    totalReceipts,
    totalSales,
    totalSubtotal,
    totalIgv,
    avgTicket,
    totalUnits,
    totalItemsRevenue,
    distinctDishes: dishesSummary.length,
    paymentSummary,
    dishesSummary,
    categorySummary
  };
}

function generateSalesExcel({ restaurante = {}, sales = [], itemLines = [], generatedAt = '' }) {
  const sst = new SharedStrings();
  const agg = aggregateSalesData(sales, itemLines);

  const restName = String(restaurante.nombre || 'Melidan Restaurante S.A.C.').toUpperCase();
  const restRuc = String(restaurante.ruc || '20601234567');
  const genLabel = generatedAt || new Date().toLocaleString('es-PE', { hour12: true });

  // ==========================================================================
  // HOJA 1: Resumen Ejecutivo (+ Gráfico de Barras + Gráfico de Pastel)
  // ==========================================================================
  const s1 = new SheetBuilder('Resumen Ejecutivo', sst, {
    colWidths: [30, 18, 16, 19, 16, 16, 4],
    drawingRelId: 'rId1'
  });

  s1.setRowHeight(1, 30);
  s1.setString(1, 1, `${restName} — REPORTE EJECUTIVO DETALLADO DE VENTAS`, S.TITLE);
  s1.merge(1, 1, 6, 1, S.TITLE);

  s1.setRowHeight(2, 20);
  s1.setString(1, 2, `R.U.C.: ${restRuc}  |  Generado: ${genLabel}  |  Base de Datos: PostgreSQL 18 (melidan_db)`, S.SUBTITLE);
  s1.merge(1, 2, 6, 2, S.SUBTITLE);

  // Sección KPI (Izquierda A4:B12) y Medios de Pago (Derecha D4:F...)
  s1.setRowHeight(4, 22);
  s1.setString(1, 4, 'RESUMEN GENERAL DE VENTAS (KPIs)', S.SEC_ORANGE);
  s1.merge(1, 4, 2, 4, S.SEC_ORANGE);

  s1.setString(4, 4, 'VENTAS POR MEDIO DE PAGO', S.SEC_TEAL);
  s1.merge(4, 4, 6, 4, S.SEC_TEAL);

  s1.setRowHeight(5, 22);
  s1.setString(1, 5, 'Indicador Clave', S.TH_LEFT);
  s1.setString(2, 5, 'Resultado', S.TH_RIGHT);

  s1.setString(4, 5, 'Medio / Canal de Pago', S.TH_LEFT);
  s1.setString(5, 5, 'Comprobantes', S.TH_RIGHT);
  s1.setString(6, 5, 'Total (S/)', S.TH_RIGHT);

  const kpiRows = [
    ['Total de Ventas (S/)', agg.totalSales, S.KPI_CUR],
    ['Op. Gravada / Subtotal (S/)', agg.totalSubtotal, S.KPI_CUR],
    ['I.G.V. (18%) (S/)', agg.totalIgv, S.KPI_CUR],
    ['Comprobantes Emitidos', agg.totalReceipts, S.KPI_INT],
    ['Ticket Promedio (S/)', agg.avgTicket, S.KPI_CUR],
    ['Total Platos Vendidos (Uds.)', agg.totalUnits, S.KPI_INT],
    ['Platos Distintos Vendidos', agg.distinctDishes, S.KPI_INT]
  ];
  kpiRows.forEach(([label, val, valStyle], idx) => {
    const r = 6 + idx;
    s1.setRowHeight(r, 20);
    s1.setString(1, r, label, S.KPI_LBL);
    s1.setNumber(2, r, val, valStyle);
  });

  const payFirstRow = 6;
  agg.paymentSummary.forEach((p, idx) => {
    const r = payFirstRow + idx;
    const z = idx % 2 === 1;
    s1.setString(4, r, p.canal, z ? S.TXT_Z : S.TXT);
    s1.setNumber(5, r, p.comprobantes, z ? S.INT_Z : S.INT);
    s1.setNumber(6, r, p.total, z ? S.CUR_Z : S.CUR);
  });
  const payLastRow = payFirstRow + agg.paymentSummary.length - 1;
  const payTotRow = payLastRow + 1;
  s1.setString(4, payTotRow, 'TOTAL PAGOS', S.TOT_LBL);
  s1.setFormula(5, payTotRow, `SUM(E${payFirstRow}:E${payLastRow})`, agg.totalReceipts, S.TOT_INT);
  s1.setFormula(6, payTotRow, `SUM(F${payFirstRow}:F${payLastRow})`, agg.totalSales, S.TOT_CUR);

  // Tabla: Ventas por Categoría (alimenta al Gráfico de Pastel)
  const catStartRow = Math.max(14, payTotRow + 2);
  s1.setRowHeight(catStartRow, 22);
  s1.setString(1, catStartRow, 'DISTRIBUCIÓN DE VENTAS POR CATEGORÍA (DATOS DEL GRÁFICO DE PASTEL)', S.SEC_TEAL);
  s1.merge(1, catStartRow, 6, catStartRow, S.SEC_TEAL);

  const catHeaderRow = catStartRow + 1;
  s1.setRowHeight(catHeaderRow, 22);
  s1.setString(1, catHeaderRow, 'Categoría', S.TH_LEFT);
  s1.setString(2, catHeaderRow, 'Platos Distintos', S.TH_RIGHT);
  s1.setString(3, catHeaderRow, 'Unidades Vendidas', S.TH_RIGHT);
  s1.setString(4, catHeaderRow, 'Total Ventas (S/)', S.TH_RIGHT);
  s1.setString(5, catHeaderRow, '% Participación', S.TH_RIGHT);
  s1.setString(6, catHeaderRow, 'Ticket / Ud. (S/)', S.TH_RIGHT);

  const catRows = agg.categorySummary.length > 0
    ? agg.categorySummary
    : [{ categoria: 'Sin ventas registradas', platos_distintos: 0, unidades: 0, ingresos: 0, share: 0 }];

  const catFirstRow = catHeaderRow + 1;
  const catLastRow = catFirstRow + catRows.length - 1;
  const catTotRow = catLastRow + 1;

  catRows.forEach((c, idx) => {
    const r = catFirstRow + idx;
    const z = idx % 2 === 1;
    const avgUnit = c.unidades > 0 ? round2(c.ingresos / c.unidades) : 0;
    s1.setString(1, r, c.categoria, z ? S.TXT_Z : S.TXT);
    s1.setNumber(2, r, c.platos_distintos, z ? S.INT_Z : S.INT);
    s1.setNumber(3, r, c.unidades, z ? S.INT_Z : S.INT);
    s1.setNumber(4, r, c.ingresos, z ? S.CUR_Z : S.CUR);
    s1.setFormula(5, r, `IF($D$${catTotRow}>0,D${r}/$D$${catTotRow},0)`, c.share, z ? S.PCT_Z : S.PCT);
    s1.setNumber(6, r, avgUnit, z ? S.CUR_Z : S.CUR);
  });

  s1.setString(1, catTotRow, 'TOTAL CATEGORÍAS', S.TOT_LBL);
  s1.setFormula(2, catTotRow, `SUM(B${catFirstRow}:B${catLastRow})`, agg.distinctDishes, S.TOT_INT);
  s1.setFormula(3, catTotRow, `SUM(C${catFirstRow}:C${catLastRow})`, agg.totalUnits, S.TOT_INT);
  s1.setFormula(4, catTotRow, `SUM(D${catFirstRow}:D${catLastRow})`, agg.totalItemsRevenue, S.TOT_CUR);
  s1.setFormula(5, catTotRow, `SUM(E${catFirstRow}:E${catLastRow})`, agg.totalItemsRevenue > 0 ? 1 : 0, S.TOT_PCT);
  s1.setNumber(6, catTotRow, agg.totalUnits > 0 ? round2(agg.totalItemsRevenue / agg.totalUnits) : 0, S.TOT_CUR);

  // Tabla: Top 10 Platos Más Vendidos (alimenta al Gráfico de Barras)
  const topStartRow = catTotRow + 2;
  s1.setRowHeight(topStartRow, 22);
  s1.setString(1, topStartRow, 'TOP 10 PLATOS MÁS VENDIDOS (DATOS DEL GRÁFICO DE BARRAS)', S.SEC_ORANGE);
  s1.merge(1, topStartRow, 6, topStartRow, S.SEC_ORANGE);

  const topHeaderRow = topStartRow + 1;
  s1.setRowHeight(topHeaderRow, 22);
  s1.setString(1, topHeaderRow, 'Ranking', S.TH_CENTER);
  s1.setString(2, topHeaderRow, 'Plato / Producto', S.TH_LEFT);
  s1.setString(3, topHeaderRow, 'Categoría', S.TH_LEFT);
  s1.setString(4, topHeaderRow, 'Unidades Vendidas', S.TH_RIGHT);
  s1.setString(5, topHeaderRow, 'Ingreso Total (S/)', S.TH_RIGHT);
  s1.setString(6, topHeaderRow, '% Ingresos', S.TH_RIGHT);

  const topDishes = agg.dishesSummary.length > 0
    ? agg.dishesSummary.slice(0, 10)
    : [{ nombre_plato: 'Sin platos vendidos', categoria_nombre: '-', unidades: 0, ingresos: 0, share: 0 }];

  const topFirstRow = topHeaderRow + 1;
  const topLastRow = topFirstRow + topDishes.length - 1;
  const topTotRow = topLastRow + 1;

  topDishes.forEach((d, idx) => {
    const r = topFirstRow + idx;
    const z = idx % 2 === 1;
    s1.setString(1, r, `#${idx + 1}`, z ? S.CTR_Z : S.CTR);
    s1.setString(2, r, d.nombre_plato, z ? S.TXT_Z : S.TXT);
    s1.setString(3, r, d.categoria_nombre, z ? S.TXT_Z : S.TXT);
    s1.setNumber(4, r, d.unidades, z ? S.INT_Z : S.INT);
    s1.setNumber(5, r, d.ingresos, z ? S.CUR_Z : S.CUR);
    s1.setNumber(6, r, d.share, z ? S.PCT_Z : S.PCT);
  });

  const topUnitsSum = topDishes.reduce((a, d) => a + d.unidades, 0);
  const topRevSum = round2(topDishes.reduce((a, d) => a + d.ingresos, 0));
  const topShareSum = topDishes.reduce((a, d) => a + d.share, 0);

  s1.setString(1, topTotRow, 'SUBTOTAL TOP 10', S.TOT_LBL);
  s1.merge(1, topTotRow, 3, topTotRow, S.TOT_LBL);
  s1.setFormula(4, topTotRow, `SUM(D${topFirstRow}:D${topLastRow})`, topUnitsSum, S.TOT_INT);
  s1.setFormula(5, topTotRow, `SUM(E${topFirstRow}:E${topLastRow})`, topRevSum, S.TOT_CUR);
  s1.setFormula(6, topTotRow, `SUM(F${topFirstRow}:F${topLastRow})`, topShareSum, S.TOT_PCT);

  // ==========================================================================
  // HOJA 2: Platos Vendidos (Ranking Completo de Todos los Platos)
  // ==========================================================================
  const allDishes = agg.dishesSummary.length > 0
    ? agg.dishesSummary
    : [{ nombre_plato: 'Sin platos vendidos', categoria_nombre: '-', estacion: '-', pedidos: 0, unidades: 0, precio_promedio: 0, ingresos: 0, share: 0 }];
  const s2LastDataRow = 4 + allDishes.length;

  const s2 = new SheetBuilder('Platos Vendidos', sst, {
    colWidths: [10, 34, 20, 22, 16, 18, 20, 18, 15],
    freezeRow: 4,
    autoFilterRange: `A4:I${s2LastDataRow}`
  });

  s2.setRowHeight(1, 28);
  s2.setString(1, 1, `DETALLE COMPLETO DE PLATOS VENDIDOS — ${restName}`, S.TITLE);
  s2.merge(1, 1, 9, 1, S.TITLE);

  s2.setRowHeight(2, 20);
  s2.setString(1, 2, `Platos distintos: ${agg.distinctDishes}  |  Total unidades vendidas: ${agg.totalUnits}  |  Ingreso total por platos: S/ ${agg.totalItemsRevenue.toFixed(2)}`, S.SUBTITLE);
  s2.merge(1, 2, 9, 2, S.SUBTITLE);

  s2.setRowHeight(4, 26);
  [
    [1, 'Ranking', S.TH_CENTER],
    [2, 'Plato / Producto', S.TH_LEFT],
    [3, 'Categoría', S.TH_LEFT],
    [4, 'Estación Cocina', S.TH_LEFT],
    [5, 'N° Pedidos', S.TH_RIGHT],
    [6, 'Unidades Vendidas', S.TH_RIGHT],
    [7, 'Precio Prom. (S/)', S.TH_RIGHT],
    [8, 'Ingreso Total (S/)', S.TH_RIGHT],
    [9, '% de Ingresos', S.TH_RIGHT]
  ].forEach(([c, lbl, st]) => s2.setString(c, 4, lbl, st));

  const s2TotRow = s2LastDataRow + 1;
  allDishes.forEach((d, idx) => {
    const r = 5 + idx;
    const z = idx % 2 === 1;
    s2.setNumber(1, r, idx + 1, z ? S.CTR_Z : S.CTR);
    s2.setString(2, r, d.nombre_plato, z ? S.TXT_Z : S.TXT);
    s2.setString(3, r, d.categoria_nombre, z ? S.TXT_Z : S.TXT);
    s2.setString(4, r, d.estacion, z ? S.TXT_Z : S.TXT);
    s2.setNumber(5, r, d.pedidos, z ? S.INT_Z : S.INT);
    s2.setNumber(6, r, d.unidades, z ? S.INT_Z : S.INT);
    s2.setNumber(7, r, d.precio_promedio, z ? S.CUR_Z : S.CUR);
    s2.setNumber(8, r, d.ingresos, z ? S.CUR_Z : S.CUR);
    s2.setFormula(9, r, `IF($H$${s2TotRow}>0,H${r}/$H$${s2TotRow},0)`, d.share, z ? S.PCT_Z : S.PCT);
  });

  s2.setRowHeight(s2TotRow, 22);
  s2.setString(1, s2TotRow, 'TOTAL GENERAL DE PLATOS VENDIDOS', S.TOT_LBL);
  s2.merge(1, s2TotRow, 4, s2TotRow, S.TOT_LBL);
  s2.setFormula(5, s2TotRow, `SUM(E5:E${s2LastDataRow})`, allDishes.reduce((a, d) => a + d.pedidos, 0), S.TOT_INT);
  s2.setFormula(6, s2TotRow, `SUM(F5:F${s2LastDataRow})`, agg.totalUnits, S.TOT_INT);
  s2.setNumber(7, s2TotRow, agg.totalUnits > 0 ? round2(agg.totalItemsRevenue / agg.totalUnits) : 0, S.TOT_CUR);
  s2.setFormula(8, s2TotRow, `SUM(H5:H${s2LastDataRow})`, agg.totalItemsRevenue, S.TOT_CUR);
  s2.setFormula(9, s2TotRow, `SUM(I5:I${s2LastDataRow})`, agg.totalItemsRevenue > 0 ? 1 : 0, S.TOT_PCT);

  // ==========================================================================
  // HOJA 3: Detalle de Ventas (Libro de Comprobantes)
  // ==========================================================================
  const itemsByOrder = new Map();
  for (const ln of itemLines) {
    const key = Number(ln.id_pedido || 0);
    if (!itemsByOrder.has(key)) itemsByOrder.set(key, []);
    itemsByOrder.get(key).push(ln);
  }

  const salesRows = sales.length > 0 ? sales : [];
  const s3LastDataRow = 4 + Math.max(1, salesRows.length);
  const s3 = new SheetBuilder('Detalle de Ventas', sst, {
    colWidths: [18, 11, 21, 10, 12, 26, 15, 22, 15, 16, 12, 46, 16, 14, 16],
    freezeRow: 4,
    autoFilterRange: `A4:O${s3LastDataRow}`
  });

  s3.setRowHeight(1, 28);
  s3.setString(1, 1, `REGISTRO DETALLADO DE VENTAS Y COMPROBANTES — ${restName}`, S.TITLE);
  s3.merge(1, 1, 15, 1, S.TITLE);

  s3.setRowHeight(2, 20);
  s3.setString(1, 2, `Total Comprobantes: ${agg.totalReceipts}  |  Total Ventas: S/ ${agg.totalSales.toFixed(2)}  |  Subtotal: S/ ${agg.totalSubtotal.toFixed(2)}  |  IGV 18%: S/ ${agg.totalIgv.toFixed(2)}`, S.SUBTITLE);
  s3.merge(1, 2, 15, 2, S.SUBTITLE);

  s3.setRowHeight(4, 26);
  [
    [1, 'N° Comprobante', S.TH_CENTER],
    [2, 'Tipo', S.TH_CENTER],
    [3, 'Fecha y Hora', S.TH_CENTER],
    [4, 'Mesa', S.TH_CENTER],
    [5, 'Comanda', S.TH_CENTER],
    [6, 'Cliente / Razón Social', S.TH_LEFT],
    [7, 'DNI / RUC', S.TH_CENTER],
    [8, 'Cajero / Atendido Por', S.TH_LEFT],
    [9, 'Canal de Pago', S.TH_CENTER],
    [10, 'Referencia', S.TH_CENTER],
    [11, 'Cant. Platos', S.TH_RIGHT],
    [12, 'Platos Vendidos (Detalle)', S.TH_LEFT],
    [13, 'Subtotal (S/)', S.TH_RIGHT],
    [14, 'IGV 18% (S/)', S.TH_RIGHT],
    [15, 'Total Venta (S/)', S.TH_RIGHT]
  ].forEach(([c, lbl, st]) => s3.setString(c, 4, lbl, st));

  let s3UnitsSum = 0;
  let s3SubSum = 0;
  let s3IgvSum = 0;
  let s3TotSum = 0;

  if (salesRows.length === 0) {
    s3.setString(1, 5, 'Sin ventas registradas', S.TXT);
    s3.merge(1, 5, 10, 5, S.TXT);
    s3.setNumber(11, 5, 0, S.INT);
    s3.setString(12, 5, '-', S.TXT);
    s3.setNumber(13, 5, 0, S.CUR);
    s3.setNumber(14, 5, 0, S.CUR);
    s3.setNumber(15, 5, 0, S.CUR);
  } else {
    salesRows.forEach((sale, idx) => {
      const r = 5 + idx;
      const z = idx % 2 === 1;
      const orderItems = itemsByOrder.get(Number(sale.id_pedido)) || [];
      const qtySum = orderItems.reduce((a, it) => a + Number(it.cantidad || 0), 0);
      const detailText = orderItems.map((it) => `${it.cantidad}x ${it.nombre_plato}`).join(', ') || 'Sin detalle';
      const total = round2(sale.monto_total);
      const sub = round2(total / 1.18);
      const igv = round2(total - sub);

      s3UnitsSum += qtySum;
      s3SubSum = round2(s3SubSum + sub);
      s3IgvSum = round2(s3IgvSum + igv);
      s3TotSum = round2(s3TotSum + total);

      s3.setString(1, r, sale.numero_comprobante || 'SIN-COMP', z ? S.CTR_Z : S.CTR);
      s3.setString(2, r, String(sale.tipo_comprobante || 'boleta').toUpperCase(), z ? S.CTR_Z : S.CTR);
      s3.setString(3, r, sale.fecha_formato || '', z ? S.CTR_Z : S.CTR);
      s3.setString(4, r, `Mesa #${String(sale.numero_mesa || 1).padStart(2, '0')}`, z ? S.CTR_Z : S.CTR);
      s3.setString(5, r, `#${sale.numero_comanda || ''}`, z ? S.CTR_Z : S.CTR);
      s3.setString(6, r, sale.nombre_cliente || 'Cliente General', z ? S.TXT_Z : S.TXT);
      s3.setString(7, r, sale.documento_cliente || '-', z ? S.CTR_Z : S.CTR);
      s3.setString(8, r, sale.cajero_nombre || sale.atendido_por || 'Caja Principal', z ? S.TXT_Z : S.TXT);
      s3.setString(9, r, sale.canal_pago || 'Efectivo', z ? S.CTR_Z : S.CTR);
      s3.setString(10, r, sale.referencia_pago || '-', z ? S.CTR_Z : S.CTR);
      s3.setNumber(11, r, qtySum, z ? S.INT_Z : S.INT);
      s3.setString(12, r, detailText, z ? S.WRAP_Z : S.WRAP);
      s3.setNumber(13, r, sub, z ? S.CUR_Z : S.CUR);
      s3.setNumber(14, r, igv, z ? S.CUR_Z : S.CUR);
      s3.setNumber(15, r, total, z ? S.CUR_Z : S.CUR);
    });
  }

  const s3TotRow = s3LastDataRow + 1;
  s3.setRowHeight(s3TotRow, 22);
  s3.setString(1, s3TotRow, 'TOTAL GENERAL DE VENTAS', S.TOT_LBL);
  s3.merge(1, s3TotRow, 10, s3TotRow, S.TOT_LBL);
  s3.setFormula(11, s3TotRow, `SUM(K5:K${s3LastDataRow})`, s3UnitsSum, S.TOT_INT);
  s3.setString(12, s3TotRow, `${salesRows.length} comprobante(s) emitido(s)`, S.TOT_LBL);
  s3.setFormula(13, s3TotRow, `SUM(M5:M${s3LastDataRow})`, s3SubSum, S.TOT_CUR);
  s3.setFormula(14, s3TotRow, `SUM(N5:N${s3LastDataRow})`, s3IgvSum, S.TOT_CUR);
  s3.setFormula(15, s3TotRow, `SUM(O5:O${s3LastDataRow})`, s3TotSum, S.TOT_CUR);

  // ==========================================================================
  // HOJA 4: Detalle por Ítem (Auditoría de cada plato facturado)
  // ==========================================================================
  const s4LastDataRow = 4 + Math.max(1, itemLines.length);
  const s4 = new SheetBuilder('Detalle por Ítem', sst, {
    colWidths: [21, 18, 10, 24, 14, 32, 20, 12, 16, 16, 28],
    freezeRow: 4,
    autoFilterRange: `A4:K${s4LastDataRow}`
  });

  s4.setRowHeight(1, 28);
  s4.setString(1, 1, `DESGLOSE LÍNEA POR LÍNEA DE PLATOS VENDIDOS — ${restName}`, S.TITLE);
  s4.merge(1, 1, 11, 1, S.TITLE);

  s4.setRowHeight(2, 20);
  s4.setString(1, 2, `Total de líneas facturadas: ${itemLines.length}  |  Total unidades: ${agg.totalUnits}  |  Generado: ${genLabel}`, S.SUBTITLE);
  s4.merge(1, 2, 11, 2, S.SUBTITLE);

  s4.setRowHeight(4, 26);
  [
    [1, 'Fecha y Hora', S.TH_CENTER],
    [2, 'N° Comprobante', S.TH_CENTER],
    [3, 'Mesa', S.TH_CENTER],
    [4, 'Cliente', S.TH_LEFT],
    [5, 'Canal Pago', S.TH_CENTER],
    [6, 'Plato / Producto', S.TH_LEFT],
    [7, 'Categoría', S.TH_LEFT],
    [8, 'Cantidad', S.TH_RIGHT],
    [9, 'Precio Unit. (S/)', S.TH_RIGHT],
    [10, 'Subtotal (S/)', S.TH_RIGHT],
    [11, 'Observaciones', S.TH_LEFT]
  ].forEach(([c, lbl, st]) => s4.setString(c, 4, lbl, st));

  if (itemLines.length === 0) {
    s4.setString(1, 5, 'Sin líneas facturadas', S.TXT);
    s4.merge(1, 5, 7, 5, S.TXT);
    s4.setNumber(8, 5, 0, S.INT);
    s4.setNumber(9, 5, 0, S.CUR);
    s4.setNumber(10, 5, 0, S.CUR);
    s4.setString(11, 5, '-', S.TXT);
  } else {
    itemLines.forEach((ln, idx) => {
      const r = 5 + idx;
      const z = idx % 2 === 1;
      const qty = Number(ln.cantidad || 0);
      const pu = round2(ln.precio_unitario);
      const sub = round2(ln.subtotal !== undefined ? ln.subtotal : qty * pu);

      s4.setString(1, r, ln.fecha_formato || '', z ? S.CTR_Z : S.CTR);
      s4.setString(2, r, ln.numero_comprobante || 'SIN-COMP', z ? S.CTR_Z : S.CTR);
      s4.setString(3, r, `Mesa #${String(ln.numero_mesa || 1).padStart(2, '0')}`, z ? S.CTR_Z : S.CTR);
      s4.setString(4, r, ln.nombre_cliente || 'Cliente General', z ? S.TXT_Z : S.TXT);
      s4.setString(5, r, ln.canal_pago || 'Efectivo', z ? S.CTR_Z : S.CTR);
      s4.setString(6, r, ln.nombre_plato || 'Producto', z ? S.TXT_Z : S.TXT);
      s4.setString(7, r, ln.categoria_nombre || 'Otros', z ? S.TXT_Z : S.TXT);
      s4.setNumber(8, r, qty, z ? S.INT_Z : S.INT);
      s4.setNumber(9, r, pu, z ? S.CUR_Z : S.CUR);
      s4.setFormula(10, r, `H${r}*I${r}`, sub, z ? S.CUR_Z : S.CUR);
      s4.setString(11, r, ln.observaciones || '-', z ? S.TXT_Z : S.TXT);
    });
  }

  const s4TotRow = s4LastDataRow + 1;
  s4.setRowHeight(s4TotRow, 22);
  s4.setString(1, s4TotRow, 'TOTAL LÍNEAS FACTURADAS', S.TOT_LBL);
  s4.merge(1, s4TotRow, 7, s4TotRow, S.TOT_LBL);
  s4.setFormula(8, s4TotRow, `SUM(H5:H${s4LastDataRow})`, agg.totalUnits, S.TOT_INT);
  s4.setBlank(9, s4TotRow, S.TOT_LBL);
  s4.setFormula(10, s4TotRow, `SUM(J5:J${s4LastDataRow})`, agg.totalItemsRevenue, S.TOT_CUR);
  s4.setBlank(11, s4TotRow, S.TOT_LBL);

  // ==========================================================================
  // GENERACIÓN DE LOS 2 GRÁFICOS NATIVOS (BARRAS + PASTEL)
  // ==========================================================================
  const chart1Xml = buildBarChartXml({
    title: 'Top Platos Más Vendidos (Unidades)',
    seriesName: 'Unidades Vendidas',
    catFormula: `'Resumen Ejecutivo'!$B$${topFirstRow}:$B$${topLastRow}`,
    valFormula: `'Resumen Ejecutivo'!$D$${topFirstRow}:$D$${topLastRow}`,
    categories: topDishes.map((d) => d.nombre_plato),
    values: topDishes.map((d) => d.unidades)
  });

  const chart2Xml = buildPieChartXml({
    title: 'Distribución de Ventas por Categoría (S/)',
    seriesName: 'Ventas (S/)',
    catFormula: `'Resumen Ejecutivo'!$A$${catFirstRow}:$A$${catLastRow}`,
    valFormula: `'Resumen Ejecutivo'!$D$${catFirstRow}:$D$${catLastRow}`,
    categories: catRows.map((c) => c.categoria),
    values: catRows.map((c) => c.ingresos)
  });

  const drawingXml = buildDrawingXml();
  const stylesXml = buildStylesXml();
  const sheet1Xml = s1.toXml();
  const sheet2Xml = s2.toXml();
  const sheet3Xml = s3.toXml();
  const sheet4Xml = s4.toXml();
  const sharedStringsXml = sst.toXml();

  // ==========================================================================
  // MANIFIESTOS Y RELACIONES OOXML
  // ==========================================================================
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
  <Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
  <Override PartName="/xl/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews>
  <sheets>
    <sheet name="Resumen Ejecutivo" sheetId="1" r:id="rId1"/>
    <sheet name="Platos Vendidos" sheetId="2" r:id="rId2"/>
    <sheet name="Detalle de Ventas" sheetId="3" r:id="rId3"/>
    <sheet name="Detalle por Ítem" sheetId="4" r:id="rId4"/>
  </sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

  const sheet1RelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;

  const drawing1RelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart2.xml"/>
</Relationships>`;

  const isoNow = new Date().toISOString();
  const corePropsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:dcterms="http://purl.org/dc/terms/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Reporte Detallado de Ventas - Melidan Restaurante</dc:title>
  <dc:creator>Sistema Melidan POS</dc:creator>
  <cp:lastModifiedBy>Administración Melidan</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${isoNow}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${isoNow}</dcterms:modified>
</cp:coreProperties>`;

  const appPropsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
            xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Melidan Restaurante POS</Application>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>4</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="4" baseType="lpstr">
      <vt:lpstr>Resumen Ejecutivo</vt:lpstr>
      <vt:lpstr>Platos Vendidos</vt:lpstr>
      <vt:lpstr>Detalle de Ventas</vt:lpstr>
      <vt:lpstr>Detalle por Ítem</vt:lpstr>
    </vt:vector>
  </TitlesOfParts>
</Properties>`;

  return buildZipBuffer([
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: rootRelsXml },
    { name: 'docProps/core.xml', data: corePropsXml },
    { name: 'docProps/app.xml', data: appPropsXml },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml },
    { name: 'xl/styles.xml', data: stylesXml },
    { name: 'xl/sharedStrings.xml', data: sharedStringsXml },
    { name: 'xl/worksheets/sheet1.xml', data: sheet1Xml },
    { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: sheet1RelsXml },
    { name: 'xl/worksheets/sheet2.xml', data: sheet2Xml },
    { name: 'xl/worksheets/sheet3.xml', data: sheet3Xml },
    { name: 'xl/worksheets/sheet4.xml', data: sheet4Xml },
    { name: 'xl/drawings/drawing1.xml', data: drawingXml },
    { name: 'xl/drawings/_rels/drawing1.xml.rels', data: drawing1RelsXml },
    { name: 'xl/charts/chart1.xml', data: chart1Xml },
    { name: 'xl/charts/chart2.xml', data: chart2Xml }
  ]);
}

module.exports = {
  generateSalesExcel,
  aggregateSalesData
};
