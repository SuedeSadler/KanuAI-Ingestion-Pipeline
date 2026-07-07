import fs from "fs";
import pdf from "pdf-parse";
import crypto from "crypto";

// Matches NZ legislation section headings, e.g. "108 Nominated successors" or "12. Interpretation"
const SECTION_HEADING_REGEX = /^(\d{1,3}[A-Z]?)[.\s]+([A-Z][^\n]{3,100})$/gm;

export async function parseLegislationPdf(filePath, { sourceName, sourceUrl }) {
  const buffer = fs.readFileSync(filePath);
  const { text } = await pdf(buffer);

  const sections = splitIntoSections(text);

  return sections.map((section, index) => ({
    title: `${sourceName} — s.${section.number} ${section.heading}`,
    sourceUrl,
    sectionHeading: `s.${section.number} ${section.heading}`,
    text: section.body,
    contentHash: hashContent(section.body),
    chunkIndex: index,
  }));
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
