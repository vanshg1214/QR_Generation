import QRCode from "qrcode";
import { buildLetterPdf } from "./pdf.js";

// Builds one person's "Dear {name} ji" letter PDF: stamps that person's QR
// code into every calibrated box that's assigned to one of their links.
// codesForPerson: [{ campaignLinkId, code }]
// boxes: [{ campaignLinkId, x, y, width, height }] (campaign-wide, from letter_qr_boxes)
export async function buildPersonLetter({
  personName,
  codesForPerson,
  boxes,
  graphicData,
  graphicMime,
  signatureName,
  signatureTitle,
  publicBaseUrl,
}) {
  const codeByLinkId = new Map(codesForPerson.map((c) => [c.campaignLinkId, c.code]));

  const qrStamps = [];
  for (const box of boxes) {
    const code = codeByLinkId.get(box.campaignLinkId);
    if (!code) continue; // box's link doesn't exist for this person -- skip rather than fail the letter
    const qrPngBytes = await QRCode.toBuffer(`${publicBaseUrl}/r/${code}`, { width: 512, margin: 1 });
    qrStamps.push({ x: box.x, y: box.y, width: box.width, height: box.height, qrPngBytes });
  }

  return buildLetterPdf(personName, graphicData, graphicMime, {
    signatureName,
    signatureTitle,
    qrStamps,
  });
}
