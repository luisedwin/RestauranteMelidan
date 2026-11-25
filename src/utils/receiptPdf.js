/**
 * src/utils/receiptPdf.js - Generador Profesional de Boletas y Facturas en PDF 1.4
 * Sin dependencias externas: produce un PDF binario válido con desglose SUNAT,
 * datos completos del restaurante, platillos, hora, método de pago (Yape/Plin/Efectivo/Tarjeta)
 * y cupón de promoción para la siguiente compra.
 */

const crypto = require('crypto');

function sanitizeWinAnsi(str) {
  return String(str ?? '')
    .normalize('NFC')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/•/g, '*')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

function escapePdfText(str) {
  return sanitizeWinAnsi(str)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapText(text, maxChars) {
  const clean = sanitizeWinAnsi(text).replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const words = clean.split(' ');
  const lines = [];
  let current = '';
  for (const w of words) {
    if (!current) {
      current = w;
    } else if (`${current} ${w}`.length <= maxChars) {
      current = `${current} ${w}`;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function numberToSpanishWords(amount) {
  const num = Number(amount || 0);
  const totalCents = Math.round(Math.abs(num) * 100);
  const intPart = Math.floor(totalCents / 100);
  const cents = totalCents % 100;
  const centsStr = String(cents).padStart(2, '0');

  const units = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
  const teens = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
  const tens = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const hundreds = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  function convertLessThanThousand(n) {
    if (n === 0) return '';
    if (n === 100) return 'CIEN';
    const c = Math.floor(n / 100);
    const rem = n % 100;
    let out = c > 0 ? `${hundreds[c]} ` : '';
    if (rem === 0) return out.trim();
    if (rem < 10) return `${out}${units[rem]}`.trim();
    if (rem < 20) return `${out}${teens[rem - 10]}`.trim();
    const t = Math.floor(rem / 10);
    const u = rem % 10;
    if (t === 2 && u > 0) return `${out}VEINTI${units[u]}`.trim();
    return `${out}${tens[t]}${u > 0 ? ` Y ${units[u]}` : ''}`.trim();
  }

  let words = '';
  if (intPart === 0) {
    words = 'CERO';
  } else {
    const thousands = Math.floor(intPart / 1000);
    const rest = intPart % 1000;
    if (thousands > 0) {
      words += thousands === 1 ? 'MIL ' : `${convertLessThanThousand(thousands)} MIL `;
    }
    if (rest > 0) {
      words += convertLessThanThousand(rest);
    }
  }

  return `SON: ${words.trim()} CON ${centsStr}/100 SOLES`;
}

function computeVerificationHash(receipt) {
  const seed = `${receipt.numero_comprobante}|${receipt.monto_total}|${receipt.fecha_formato}|${receipt.restaurante?.ruc || '20601234567'}`;
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24).toUpperCase();
}

function generateReceiptPdf(receipt) {
  const pageWidth = 340; // ~120mm formato profesional comprobante
  const marginX = 22;
  const contentWidth = pageWidth - marginX * 2;
  const ops = [];

  const rest = receipt.restaurante || {};
  const restName = rest.nombre || 'Melidan Restaurante S.A.C.';
  const restSlogan = rest.slogan || 'Tradicion y sabor a fuego lento';
  const restRuc = rest.ruc || '20601234567';
  const restDir = rest.direccion || 'Av. La Marina 2450, San Miguel, Lima';
  const restTel = rest.telefono || '+51 987 654 321';

  const isFactura = String(receipt.tipo_comprobante || 'boleta').toLowerCase() === 'factura';
  const docTitle = isFactura ? 'FACTURA ELECTRONICA' : 'BOLETA DE VENTA ELECTRONICA';
  const voucherNum = receipt.numero_comprobante || 'B001-00001026';
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  const total = Number(Number(receipt.monto_total || receipt.desglose?.total || 0).toFixed(2));
  const subtotal = Number(receipt.desglose?.subtotal ?? (total / 1.18).toFixed(2));
  const igv = Number(receipt.desglose?.igv ?? (total - subtotal).toFixed(2));
  const amountWords = receipt.monto_en_letras || numberToSpanishWords(total);
  const promoCode = receipt.codigo_promo || `MELIDAN15-${String(receipt.id_comprobante || '1001').padStart(4, '0')}`;
  const promoDesc = receipt.descripcion_promo || '15% de descuento en tu proxima compra o 1 Bebida Artesanal GRATIS (consumo minimo S/ 40.00).';
  const validUntil = receipt.valido_hasta || 'Valido por 30 dias desde la emision';
  const payChannel = receipt.canal_pago || 'Efectivo';
  const hashCode = receipt.hash_verificacion || computeVerificationHash(receipt);

  // Precalcular altura dinámica (hasta 2600 pt para boletas consolidadas con múltiples pedidos)
  let estimatedLines = 30;
  for (const it of items) {
    estimatedLines += Math.max(1, wrapText(it.nombre_plato || it.name || 'Producto', 25).length);
    if (it.observaciones) estimatedLines += 1;
  }
  if (receipt.comentarios) estimatedLines += Math.max(2, wrapText(receipt.comentarios, 50).length);
  const pageHeight = Math.max(600, Math.min(2600, 315 + estimatedLines * 14));

  let y = pageHeight - 28;

  const setFill = (r, g, b) => ops.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
  const setStroke = (r, g, b) => ops.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`);

  const drawRect = (x, rectY, w, h, fillRgb, strokeRgb = null, dashed = false) => {
    ops.push('q');
    if (dashed) ops.push('[4 3] 0 d');
    if (fillRgb) setFill(fillRgb[0], fillRgb[1], fillRgb[2]);
    if (strokeRgb) {
      setStroke(strokeRgb[0], strokeRgb[1], strokeRgb[2]);
      ops.push('0.9 w');
    }
    ops.push(`${x.toFixed(2)} ${rectY.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fillRgb && strokeRgb ? 'B' : (fillRgb ? 'f' : 'S')}`);
    ops.push('Q');
  };

  const drawLine = (x1, y1, x2, y2, dashed = false, rgb = [0.78, 0.82, 0.88]) => {
    ops.push('q');
    if (dashed) ops.push('[3 3] 0 d');
    setStroke(rgb[0], rgb[1], rgb[2]);
    ops.push('0.75 w');
    ops.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    ops.push('Q');
  };

  const drawText = (text, x, textY, font = 'F1', size = 9, rgb = [0.06, 0.09, 0.16]) => {
    ops.push('q');
    setFill(rgb[0], rgb[1], rgb[2]);
    ops.push(`BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${textY.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`);
    ops.push('Q');
  };

  const approxWidth = (text, size, isMono = false) => {
    const clean = sanitizeWinAnsi(text);
    const factor = isMono ? 0.6 : 0.51;
    return clean.length * size * factor;
  };

  const drawCentered = (text, centerY, font = 'F1', size = 9, rgb = [0.06, 0.09, 0.16]) => {
    const w = approxWidth(text, size, font === 'F3');
    const x = Math.max(marginX, (pageWidth - w) / 2);
    drawText(text, x, centerY, font, size, rgb);
  };

  const drawRight = (text, rightX, textY, font = 'F1', size = 9, rgb = [0.06, 0.09, 0.16]) => {
    const w = approxWidth(text, size, font === 'F3');
    drawText(text, Math.max(marginX, rightX - w), textY, font, size, rgb);
  };

  // 1. Banda decorativa superior Melidan (Naranja corporativo)
  drawRect(0, pageHeight - 10, pageWidth, 10, [1.0, 0.341, 0.133]);

  // 2. Cabecera del Restaurante
  drawCentered(restName.toUpperCase(), y, 'F2', 14, [0.06, 0.09, 0.16]);
  y -= 14;
  drawCentered(restSlogan, y, 'F1', 8.5, [0.35, 0.42, 0.52]);
  y -= 13;
  drawCentered(`R.U.C.: ${restRuc}`, y, 'F2', 9.5, [0.06, 0.09, 0.16]);
  y -= 12;
  drawCentered(restDir, y, 'F1', 8.5, [0.28, 0.34, 0.42]);
  y -= 11;
  drawCentered(`Tel: ${restTel} | www.melidan.pe`, y, 'F1', 8.2, [0.28, 0.34, 0.42]);
  y -= 14;

  // 3. Caja de Tipo de Comprobante y Serie-Número
  drawRect(marginX, y - 34, contentWidth, 36, [0.97, 0.98, 0.99], [0.12, 0.16, 0.24]);
  drawCentered(docTitle, y - 12, 'F2', 10.5, [0.06, 0.09, 0.16]);
  drawCentered(voucherNum, y - 27, 'F3', 12, [0.95, 0.32, 0.12]);
  y -= 48;

  // 4. Metadatos del Comprobante
  const metaRows = [
    ['Fecha y Hora:', receipt.fecha_formato || new Date().toLocaleString('es-PE')],
    ['Mesa / Comanda:', `Mesa #${String(receipt.numero_mesa || 1).padStart(2, '0')}  |  Comanda #${receipt.numero_comanda || '-'}`],
    ['Cliente:', receipt.nombre_cliente || 'Cliente General'],
    [isFactura ? 'RUC Cliente:' : 'DNI / Doc.:', receipt.documento_cliente || '-'],
    ['Cajero / Caja:', receipt.cajero_nombre || receipt.atendido_por || 'Caja Principal'],
    ['Medio de Pago:', `${payChannel}${receipt.referencia_pago ? ` (Ref: ${receipt.referencia_pago})` : ''}`]
  ];

  for (const [label, val] of metaRows) {
    drawText(label, marginX, y, 'F2', 8.5, [0.28, 0.34, 0.42]);
    drawText(String(val).slice(0, 40), marginX + 86, y, 'F1', 8.5, [0.06, 0.09, 0.16]);
    y -= 12;
  }

  y -= 4;
  drawLine(marginX, y, pageWidth - marginX, y, false, [0.12, 0.16, 0.24]);
  y -= 13;

  // 5. Cabecera de Tabla de Platillos
  drawText('CANT', marginX, y, 'F2', 8.2, [0.28, 0.34, 0.42]);
  drawText('DESCRIPCION', marginX + 34, y, 'F2', 8.2, [0.28, 0.34, 0.42]);
  drawRight('P.UNIT', pageWidth - marginX - 58, y, 'F2', 8.2, [0.28, 0.34, 0.42]);
  drawRight('IMPORTE', pageWidth - marginX, y, 'F2', 8.2, [0.28, 0.34, 0.42]);
  y -= 6;
  drawLine(marginX, y, pageWidth - marginX, y, true);
  y -= 13;

  // 6. Detalle de Platillos
  for (const item of items) {
    const qty = Number(item.cantidad ?? item.qty ?? 1);
    const unit = Number(item.precio_unitario ?? item.price ?? 0);
    const lineSub = Number(item.subtotal ?? (qty * unit));
    const nameLines = wrapText(item.nombre_plato || item.name || 'Producto', 25);

    drawText(`${qty}x`, marginX, y, 'F2', 8.6);
    drawText(nameLines[0] || 'Producto', marginX + 34, y, 'F1', 8.6);
    drawRight(`S/ ${unit.toFixed(2)}`, pageWidth - marginX - 58, y, 'F1', 8.4, [0.3, 0.36, 0.44]);
    drawRight(`S/ ${lineSub.toFixed(2)}`, pageWidth - marginX, y, 'F2', 8.6);
    y -= 12;

    for (let i = 1; i < nameLines.length; i++) {
      drawText(nameLines[i], marginX + 34, y, 'F1', 8.4);
      y -= 11;
    }

    if (item.observaciones) {
      drawText(`* Nota: ${String(item.observaciones).slice(0, 42)}`, marginX + 34, y, 'F1', 7.6, [0.76, 0.25, 0.05]);
      y -= 11;
    }
  }

  if (receipt.comentarios) {
    y -= 2;
    for (const cLine of wrapText(`Comentario pedido: ${receipt.comentarios}`, 50)) {
      drawText(cLine, marginX, y, 'F1', 7.8, [0.76, 0.25, 0.05]);
      y -= 10;
    }
  }

  y -= 2;
  drawLine(marginX, y, pageWidth - marginX, y, true);
  y -= 14;

  // 7. Totales Tributarios (Op. Gravada, IGV 18%, Total)
  drawText('OP. GRAVADA (SUBTOTAL):', marginX + 60, y, 'F1', 8.5, [0.28, 0.34, 0.42]);
  drawRight(`S/ ${subtotal.toFixed(2)}`, pageWidth - marginX, y, 'F1', 8.8);
  y -= 13;

  drawText('I.G.V. (18%):', marginX + 60, y, 'F1', 8.5, [0.28, 0.34, 0.42]);
  drawRight(`S/ ${igv.toFixed(2)}`, pageWidth - marginX, y, 'F1', 8.8);
  y -= 16;

  drawRect(marginX, y - 6, contentWidth, 22, [1.0, 0.96, 0.93], [1.0, 0.341, 0.133]);
  drawText('IMPORTE TOTAL A PAGAR:', marginX + 8, y + 1, 'F2', 10, [0.06, 0.09, 0.16]);
  drawRight(`S/ ${total.toFixed(2)}`, pageWidth - marginX - 8, y + 1, 'F2', 11.5, [0.92, 0.28, 0.08]);
  y -= 20;

  for (const wLine of wrapText(amountWords, 52)) {
    drawCentered(wLine, y, 'F2', 7.6, [0.25, 0.31, 0.39]);
    y -= 10;
  }

  y -= 10;

  // 8. Cupón de Promoción para la Siguiente Compra
  const promoLines = wrapText(promoDesc, 44);
  const promoBoxHeight = 64 + promoLines.length * 10;
  drawRect(marginX, y - promoBoxHeight, contentWidth, promoBoxHeight, [0.93, 0.99, 0.96], [0.0, 0.608, 0.467], true);

  let py = y - 15;
  drawCentered('PROMOCION PARA TU SIGUIENTE COMPRA', py, 'F2', 9.2, [0.0, 0.48, 0.37]);
  py -= 13;
  for (const pl of promoLines) {
    drawCentered(pl, py, 'F1', 8.1, [0.06, 0.18, 0.16]);
    py -= 10;
  }
  py -= 4;
  drawCentered(`CODIGO: ${promoCode}`, py, 'F3', 10.5, [0.92, 0.28, 0.08]);
  py -= 12;
  drawCentered(`Presenta esta boleta en caja | ${validUntil}`, py, 'F1', 7.3, [0.25, 0.36, 0.34]);

  y = y - promoBoxHeight - 16;

  // 9. Pie SUNAT y Hash de Verificación
  drawCentered('Representacion impresa del Comprobante Electronico', y, 'F1', 7.5, [0.38, 0.44, 0.52]);
  y -= 10;
  drawCentered(`Hash SUNAT: ${hashCode}`, y, 'F3', 7.3, [0.38, 0.44, 0.52]);
  y -= 11;
  drawCentered('Gracias por tu preferencia en Melidan Restaurante!', y, 'F2', 8.2, [0.06, 0.09, 0.16]);

  // Ensamblar documento PDF 1.4 estándar
  const streamContent = ops.join('\n') + '\n';
  const streamBuf = Buffer.from(streamContent, 'latin1');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>\nendobj\n`,
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>\nendobj\n',
    `7 0 obj\n<< /Length ${streamBuf.length} >>\nstream\n${streamContent}endstream\nendobj\n`
  ];

  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const parts = [Buffer.from(header, 'binary')];
  const offsets = [0];
  let currentOffset = parts[0].length;

  for (const obj of objects) {
    offsets.push(currentOffset);
    const buf = Buffer.from(obj, 'latin1');
    parts.push(buf);
    currentOffset += buf.length;
  }

  const xrefStart = currentOffset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(Buffer.from(xref + trailer, 'latin1'));

  return Buffer.concat(parts);
}

module.exports = {
  generateReceiptPdf,
  numberToSpanishWords,
  computeVerificationHash
};
