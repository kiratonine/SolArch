// Synthetic data for the browser-only design preview. Never shipped in a desktop build.
import {
  type DocxBlock,
  type PaymentState,
  type PaymentView,
  type ProtectedFile,
  type VerifiedArchive,
  type ViewerSnapshot,
  type ViewerState,
  type WatermarkDescriptor,
} from "../ipc";

export const ARCHIVE: VerifiedArchive = {
  title: "Field notes: coastal erosion survey 2026",
  creatorWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  priceAmount: "12.50",
  priceCurrency: "USDC",
  archiveId: "arc_01J9ZK4M7Q2V",
  maxDevices: 1,
  allowExport: false,
  watermarkEnabled: true,
  fingerprint: "57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb",
};

export const FILES: ProtectedFile[] = [
  { fileId: "f_pdf", path: "report/survey.pdf", displayName: "survey.pdf", mimeType: "application/pdf", sizeBytes: 2_481_331 },
  { fileId: "f_png", path: "maps/shoreline.png", displayName: "shoreline.png", mimeType: "image/png", sizeBytes: 884_120 },
  {
    fileId: "f_docx",
    path: "report/methodology.docx",
    displayName: "methodology.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 48_902,
  },
  {
    fileId: "f_xlsx",
    path: "data/measurements.xlsx",
    displayName: "measurements.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: 131_774,
  },
];

export const WATERMARK: WatermarkDescriptor = {
  buyerWalletShort: "9WzD…AWWM",
  licenseIdShort: "lic_7Q2V",
  archiveIdShort: "arc_01J9",
};

export function payment(state: PaymentState): PaymentView {
  return {
    state,
    paymentIntentId: "pi_preview_01",
    amount: ARCHIVE.priceAmount,
    currency: "USDC",
    solanaPayUrl: `solana:${ARCHIVE.creatorWallet}?amount=${ARCHIVE.priceAmount}&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}

export function snapshot(state: ViewerState): ViewerSnapshot {
  const paying = ["payment_ready", "payment_pending", "awaiting_finality", "activating"].includes(state);
  const unlocked = state === "unlocked";
  return {
    state,
    archive: state === "idle" ? null : ARCHIVE,
    payment: paying ? payment(state as PaymentState) : null,
    files: unlocked ? FILES : [],
    watermark: unlocked ? WATERMARK : null,
  };
}

/** Error states reach the UI as a rejected command, the same way the desktop backend reports them. */
export const ERRORS: Partial<Record<ViewerState, { code: string; message_key: string }>> = {
  backend_unavailable: { code: "BACKEND_UNAVAILABLE", message_key: "errors.backendUnavailable" },
  refresh_required: { code: "REFRESH_REQUIRED", message_key: "errors.refreshRequired" },
  payment_expired: { code: "PAYMENT_EXPIRED", message_key: "errors.paymentExpired" },
  payment_failed: { code: "PAYMENT_FAILED", message_key: "errors.paymentFailed" },
  device_limit_reached: { code: "DEVICE_LIMIT_REACHED", message_key: "errors.deviceLimitReached" },
  license_revoked: { code: "LICENSE_REVOKED", message_key: "errors.licenseRevoked" },
  archive_blocked: { code: "ARCHIVE_BLOCKED", message_key: "errors.archiveBlocked" },
  error: { code: "INVALID_ARCHIVE", message_key: "errors.untrustedArchive" },
};

export const DOCX_BLOCKS: DocxBlock[] = [
  { kind: "paragraph", style: "heading", runs: [{ text: "Methodology", bold: true, italic: false, underline: false }] },
  {
    kind: "paragraph",
    style: "normal",
    runs: [
      { text: "Transects were walked at low tide on ", bold: false, italic: false, underline: false },
      { text: "twelve", bold: true, italic: false, underline: false },
      { text: " fixed stations between March and August.", bold: false, italic: false, underline: false },
    ],
  },
  { kind: "paragraph", style: "list", runs: [{ text: "RTK GNSS survey, 2 cm vertical tolerance", bold: false, italic: false, underline: false }] },
  { kind: "paragraph", style: "list", runs: [{ text: "Drone photogrammetry at 60 m altitude", bold: false, italic: false, underline: false }] },
  {
    kind: "table",
    rows: [
      ["Station", "Retreat, m", "Confidence"],
      ["S-01", "1.42", "high"],
      ["S-02", "0.87", "medium"],
    ],
  },
];

export const XLSX_SHEETS = [
  { name: "Stations", rowCount: 120, columnCount: 8 },
  { name: "Summary", rowCount: 12, columnCount: 4 },
];

export function xlsxCell(sheet: number, row: number, column: number): string {
  if (row === 0) return sheet === 0 ? ["Station", "Date", "Lat", "Lon", "Retreat", "Tide", "Crew", "Note"][column] ?? "" : ["Metric", "Q1", "Q2", "Q3"][column] ?? "";
  if (column === 0) return `S-${String(row).padStart(2, "0")}`;
  return ((row * 7 + column * 13) % 97 / 10).toFixed(2);
}

/** Builds a valid two-page PDF so the real pdf.js pipeline renders it. */
export function buildPdf(): Uint8Array {
  const page = (title: string, line: string) =>
    `BT /F1 26 Tf 72 720 Td (${title}) Tj ET BT /F1 12 Tf 72 690 Td (${line}) Tj ET`;
  const contents = [
    page("Coastal erosion survey", "Preview document rendered by the design mock."),
    page("Station results", "Twelve stations, March to August 2026."),
  ];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
    ...contents.map((stream) => `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/** Draws a placeholder map as PNG bytes. */
export async function buildPng(width: number, height: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) return new Uint8Array();
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#9FB7C4");
  gradient.addColorStop(1, "#D9C7A5");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#3E5360";
  context.lineWidth = 6;
  context.beginPath();
  for (let x = 0; x <= width; x += 20) {
    const y = height * 0.55 + Math.sin(x / 70) * 40 + Math.cos(x / 23) * 12;
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}
