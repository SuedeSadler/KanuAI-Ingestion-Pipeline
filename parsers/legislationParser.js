import pdf from "pdf-parse";
import crypto from "crypto";

// Matches NZ legislation section headings, e.g. "108 Nominated successors" or "12. Interpretation"
const SECTION_HEADING_REGEX = /^(\d{1,3}[A-Z]?)[.\s]+([A-Z][^\n]{3,100})$/gm;

export async function parseLegislationPdf(buffer, { sourceName, sourceUrl }) {
  const { text } = await pdf(buffer);

  const cleanedText = stripBoilerplate(text, sourceName);
  const sections = splitIntoSections(cleanedText);

  return sections.map((section, index) => ({
    title: `${sourceName} — s.${section.number} ${section.heading}`,
    sourceUrl,
    sectionHeading: `s.${section.number} ${section.heading}`,
    text: section.body,
    contentHash: hashContent(section.body),
    chunkIndex: index,
  }));
}

export function hashFile(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
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