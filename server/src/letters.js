import QRCode from "qrcode";
import { createLetterBook, addLetterPage, extractLetterPage, saveLetterBook } from "./pdf.js";

export { createLetterBook, extractLetterPage, saveLetterBook };

// Adds one person's letter page (with their own QR stamped into every
// calibrated box that's assigned to one of their links) to a shared book
// created via createLetterBook. Call extractLetterPage/saveLetterBook once
// all people have been added.
// codesForPerson: [{ campaignLinkId, code }]
// boxes: [{ campaignLinkId, x, y, width, height }] (campaign-wide, from letter_qr_boxes)
export async function addPersonLetter({
  book,
  personName,
  codesForPerson,
  boxes,
  signatureName,
  signatureTitle,
  includeGreeting,
  greetingPos,
  publicBaseUrl,
}) {
  const codeByLinkId = new Map(codesForPerson.map((c) => [c.campaignLinkId, c.code]));

  const qrStamps = [];
  for (const box of boxes) {
    const code = codeByLinkId.get(box.campaignLinkId);
    if (!code) continue;
    const qrPngBytes = await QRCode.toBuffer(`${publicBaseUrl}/r/${code}`, { width: 512, margin: 1 });
    qrStamps.push({ x: box.x, y: box.y, width: box.width, height: box.height, qrPngBytes });
  }

  await addLetterPage(book, personName, { signatureName, signatureTitle, qrStamps, includeGreeting, greetingPos });
}
