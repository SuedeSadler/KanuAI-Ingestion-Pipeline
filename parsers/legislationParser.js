import pdf from "pdf-parse";
import crypto from "crypto";

// Matches NZ legislation section headings, e.g. "108 Nominated successors" or "12. Interpretation"
const SECTION_HEADING_REGEX = /^(\d{1,3}[A-Z]?)[.\s]+([A-Z][^\n]{3,100})$/gm;

// Conservative char budget per chunk (~4 chars/token for English legal
// text, so 6000 chars is roughly 1500 tokens -- comfortably under
// text-embedding-3-small's 8192-token input limit, with room to spare for
// unusually dense sections).
const MAX_CHARS_PER_CHUNK = 6000;

export async function parseLegislationPdf(buffer, { sourceName, sourceUrl }) {
  const { text } = await pdf(buffer);

  const cleanedText = stripBoilerplate(text, sourceName);
  const sections = splitIntoSections(cleanedText);

  const chunks = [];
  let index = 0;

  for (const section of sections) {
    const pieces = splitLongBody(section.body, MAX_CHARS_PER_CHUNK);

    pieces.forEach((piece, pieceIndex) => {
      const headingSuffix = pieces.length > 1 ? ` (part ${pieceIndex + 1} of ${pieces.length})` : "";
      const sectionHeading = `s.${section.number} ${section.heading}${headingSuffix}`;

      chunks.push({
        title: `${sourceName} — ${sectionHeading}`,
        sourceUrl,
        sectionHeading,
        text: piece,
        contentHash: hashContent(piece),
        chunkIndex: index++,
      });
    });
  }

  return chunks;
}

export function hashFile(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// Splits an oversized section body into smaller pieces at paragraph
// boundaries, greedily packing each piece up to maxChars. Falls back to a
// hard slice for the rare paragraph that's itself longer than the limit.
function splitLongBody(body, maxChars) {
  if (body.length <= maxChars) return [body];

  const paragraphs = body.split(/\n\s*\n/);
  const pieces = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > maxChars) {
      if (current) {
        pieces.push(current.trim());
        current = "";
      }
      if (para.length > maxChars) {
        for (let i = 0; i < para.length; i += maxChars) {
          pieces.push(para.slice(i, i + maxChars).trim());
        }
      } else {
        current = para;
      }
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }

  if (current) pieces.push(current.trim());

  return pieces.filter((p) => p.length > 0);
}

// legislation.govt.nz PDFs print a running header/footer on every page
// (e.g. "Reprinted as at 28 October 2021", the Act name, and "Part 1 s 34").
// pdf-parse often fuses these directly into the surrounding text with no
// line break, which makes the section-heading regex misfire on the date
// and swallow the rest as a false heading -- chopping real sections into
// garbage fragments at every page boundary. Strip these before splitting.
function stripBoilerplate(rawText, sourceName) {
  let cleaned = rawText;

  // "Reprinted as at" date stamps, e.g. "28 October 2021"
  cleaned = cleaned.replace(
    /\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/g,
    " "
  );
  cleaned = cleaned.replace(/Reprinted as at/gi, " ");

  // The Act's own name repeated as a running header
  const escapedName = sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  cleaned = cleaned.replace(new RegExp(escapedName, "g"), " ");

  // Fused "Part N s M" running-header fragments
  cleaned = cleaned.replace(/Part\s*\d+[A-Z]?\s*s\s*\d+[A-Z]?/g, " ");

  // Standalone page-number-only lines
  cleaned = cleaned.replace(/^\s*\d{1,4}\s*$/gm, "");

  // Collapse whitespace left behind by the removals above
  cleaned = cleaned.replace(/[ \t]{2,}/g, " ");

  return cleaned;
}

function splitIntoSections(rawText) {
  const matches = [...rawText.matchAll(SECTION_HEADING_REGEX)];
  const sections = [];

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];

    const start = current.index + current[0].length;
    const end = next ? next.index : rawText.length;

    const body = rawText.slice(start, end).trim();

    // Skip near-empty matches (likely false positives from the regex, e.g. page numbers)
    if (body.length < 20) continue;

    sections.push({
      number: current[1],
      heading: current[2].trim(),
      body,
    });
  }

  return sections;
}

function hashContent(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}