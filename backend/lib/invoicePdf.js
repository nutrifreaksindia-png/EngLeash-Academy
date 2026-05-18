const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const BRAND_BLUE = '#1a237e';
const BRAND_RED = '#c41e3a';
const INK = '#0f172a';
const MUTED = '#475569';
const BORDER = '#cbd5e1';
const SOFT = '#f8fafc';

function formatCurrency(amountPaise, currency = 'INR') {
  const amount = Number(amountPaise || 0) / 100;
  if (String(currency || '').toUpperCase() === 'INR') {
    return `₹${Math.round(amount).toLocaleString('en-IN')}`;
  }
  return `${String(currency || '').toUpperCase()} ${Math.round(amount).toLocaleString('en-IN')}`;
}

function formatDate(value) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value || '');
  return dt.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function sectionTitle(doc, text, y) {
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(BRAND_BLUE)
    .text(text, 50, y);
  return doc.y + 8;
}

function drawInfoBox(doc, x, y, width, title, lines) {
  const cleanLines = (lines || []).map((line) => String(line || '').trim()).filter(Boolean);
  const estimatedHeight = Math.max(76, 34 + cleanLines.length * 15);
  doc
    .roundedRect(x, y, width, estimatedHeight, 10)
    .fillAndStroke(SOFT, BORDER);
  doc
    .fillColor(BRAND_BLUE)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(title, x + 14, y + 12, { width: width - 28 });
  doc
    .fillColor(INK)
    .font('Helvetica')
    .fontSize(10);
  let cursorY = y + 30;
  for (const line of cleanLines) {
    doc.text(line, x + 14, cursorY, { width: width - 28 });
    cursorY = doc.y + 3;
  }
  return estimatedHeight;
}

function drawMetaGrid(doc, x, y, width, pairs) {
  const rowHeight = 20;
  const boxHeight = Math.max(76, 18 + pairs.length * rowHeight);
  doc
    .roundedRect(x, y, width, boxHeight, 10)
    .fillAndStroke('#ffffff', BORDER);
  let cursorY = y + 14;
  for (const pair of pairs) {
    doc
      .fillColor(MUTED)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(pair.label, x + 14, cursorY, { width: width * 0.38 });
    doc
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(10)
      .text(pair.value || '—', x + width * 0.42, cursorY, { width: width * 0.5, align: 'right' });
    cursorY += rowHeight;
  }
  return boxHeight;
}

function drawTable(doc, startY, invoice) {
  const x = 50;
  const width = doc.page.width - 100;
  const cols = {
    item: 110,
    description: 220,
    qty: 48,
    rate: 86,
    amount: 86,
  };
  const headerHeight = 24;
  doc
    .roundedRect(x, startY, width, headerHeight, 8)
    .fillAndStroke(BRAND_BLUE, BRAND_BLUE);
  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(10);
  let cursorX = x + 10;
  doc.text('Item', cursorX, startY + 7, { width: cols.item - 12 });
  cursorX += cols.item;
  doc.text('Description', cursorX, startY + 7, { width: cols.description - 12 });
  cursorX += cols.description;
  doc.text('Qty', cursorX, startY + 7, { width: cols.qty - 12, align: 'right' });
  cursorX += cols.qty;
  doc.text('Rate', cursorX, startY + 7, { width: cols.rate - 12, align: 'right' });
  cursorX += cols.rate;
  doc.text('Amount', cursorX, startY + 7, { width: cols.amount - 12, align: 'right' });

  let y = startY + headerHeight + 2;
  for (const item of invoice.lineItems) {
    const descriptionHeight = doc.heightOfString(item.description || '—', {
      width: cols.description - 12,
      align: 'left',
    });
    const itemHeight = Math.max(24, descriptionHeight + 10);
    doc
      .roundedRect(x, y, width, itemHeight, 0)
      .fillAndStroke('#ffffff', BORDER);
    doc.fillColor(INK).font('Helvetica').fontSize(10);
    let cellX = x + 10;
    doc.text(item.itemName || 'Item', cellX, y + 6, { width: cols.item - 12 });
    cellX += cols.item;
    doc.text(item.description || '—', cellX, y + 6, { width: cols.description - 12 });
    cellX += cols.description;
    doc.text(String(item.quantity || 1), cellX, y + 6, { width: cols.qty - 12, align: 'right' });
    cellX += cols.qty;
    doc.text(formatCurrency(item.unitRatePaise, invoice.currency), cellX, y + 6, {
      width: cols.rate - 12,
      align: 'right',
    });
    cellX += cols.rate;
    doc.text(formatCurrency(item.amountPaise, invoice.currency), cellX, y + 6, {
      width: cols.amount - 12,
      align: 'right',
    });
    y += itemHeight + 2;
  }
  return y;
}

function drawTotals(doc, y, invoice) {
  const width = 220;
  const x = doc.page.width - 50 - width;
  doc
    .roundedRect(x, y, width, 76, 10)
    .fillAndStroke(SOFT, BORDER);
  const rows = [
    ['Subtotal', formatCurrency(invoice.subtotalPaise, invoice.currency)],
    ['Total', formatCurrency(invoice.totalPaise, invoice.currency)],
  ];
  let rowY = y + 16;
  for (const [label, value] of rows) {
    doc
      .fillColor(label === 'Total' ? BRAND_BLUE : MUTED)
      .font(label === 'Total' ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(label === 'Total' ? 12 : 10)
      .text(label, x + 14, rowY, { width: 80 });
    doc
      .fillColor(label === 'Total' ? BRAND_BLUE : INK)
      .font(label === 'Total' ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(label === 'Total' ? 12 : 10)
      .text(value, x + 96, rowY, { width: width - 110, align: 'right' });
    rowY += 24;
  }
}

function streamInvoicePdf(res, bundle) {
  const { payment, invoice } = bundle;
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const filename = `${invoice.invoiceNumber || `invoice-${payment.id}`}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  const logoPath = path.join(__dirname, '..', '..', 'brand', 'logo_long.jpg');
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 50, 42, { fit: [210, 62], align: 'left', valign: 'center' });
    } catch {
      /* ignore image rendering issues and continue with text header */
    }
  }

  doc
    .font('Helvetica-Bold')
    .fontSize(24)
    .fillColor(BRAND_BLUE)
    .text('Invoice', 360, 48, { width: 185, align: 'right' });

  doc
    .moveTo(50, 116)
    .lineTo(doc.page.width - 50, 116)
    .strokeColor(BORDER)
    .lineWidth(1)
    .stroke();

  const leftBoxHeight = drawInfoBox(doc, 50, 132, 238, 'Issued By', [
    invoice.academyName,
    ...invoice.academyAddressLines,
    invoice.academyEmail,
    invoice.academyPhone,
  ]);
  const rightBoxHeight = drawMetaGrid(doc, 307, 132, 238, [
    { label: 'Invoice No.', value: invoice.invoiceNumber },
    { label: 'Invoice Date', value: formatDate(invoice.invoiceDateIso) },
    { label: 'Payment Type', value: payment.orderKind || payment.paymentKind },
    { label: 'Status', value: String(payment.status || 'paid').toUpperCase() },
  ]);
  let y = 132 + Math.max(leftBoxHeight, rightBoxHeight) + 18;

  y = sectionTitle(doc, 'Bill To', y);
  const billHeight = drawInfoBox(doc, 50, y, 238, '', [
    invoice.customerName,
    invoice.customerEmail,
    invoice.customerMobile,
    ...invoice.customerAddressLines,
  ]);
  const paymentHeight = drawInfoBox(doc, 307, y, 238, 'Payment Details', [
    payment.courseTitle || payment.comboTitle || payment.title,
    payment.packageLabel,
    `Razorpay Order ID: ${payment.gatewayOrderId}`,
    `Razorpay Payment ID: ${payment.gatewayPaymentId}`,
    `Paid At: ${formatDate(payment.paidAtIso)}`,
  ]);
  y += Math.max(billHeight, paymentHeight) + 20;

  y = sectionTitle(doc, 'Charges', y);
  y = drawTable(doc, y, invoice) + 16;

  drawTotals(doc, y, invoice);
  y += 92;

  if (invoice.notesText) {
    y = sectionTitle(doc, 'Notes', y);
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(MUTED)
      .text(invoice.notesText, 50, y, { width: doc.page.width - 100, lineGap: 3 });
    y = doc.y + 18;
  }

  doc
    .moveTo(50, y)
    .lineTo(doc.page.width - 50, y)
    .strokeColor(BORDER)
    .lineWidth(1)
    .stroke();

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(MUTED)
    .text('Thank you for learning with EngLeash Academy.', 50, y + 12, {
      width: doc.page.width - 100,
      align: 'center',
    });

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#64748b')
    .text('This is a system-generated invoice.', 50, y + 28, {
      width: doc.page.width - 100,
      align: 'center',
    });

  doc.end();
}

module.exports = { streamInvoicePdf };
