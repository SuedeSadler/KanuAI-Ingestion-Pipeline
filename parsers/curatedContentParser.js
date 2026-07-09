import crypto from "crypto";

// For Stacey's curated wananga-based educational pages: longer-form
// content organized by heading (## or ###), unlike the flat term/definition
// pairs in the glossary. Takes already-extracted plain text (see
// extractText.js, which handles PDF/DOCX/MD/HTML -> text) and splits it on
// markdown headings into topic-sized chunks, then applies the same
// long-section safeguard as the legislation parser so nothing exceeds the
// embedding model's token limit.

const MAX_CHARS_PER_CHUNK = 6000;

export function parseCuratedContent(text, { sourceName, sourceUrl }) {
  const sections = splitByHeading(text);
  const chunks = [];
  let index = 0;

  for (const section of sections) {
    const pieces = splitLongBody(section.body, MAX_CHARS_PER_CHUNK);

    pieces.forEach((piece, pieceIndex) => {
      const headingSuffix = pieces.length > 1 ? ` (part ${pieceIndex + 1} of ${pieces.length})` : "";
      const sectionHeading = `${section.heading}${headingSuffix}`;

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

function splitByHeading(text) {
  // Matches "## Heading" or "### Heading" lines as section boundaries
  const headingRegex = /^#{2,3}\s+(.+)$/gm;
  const matches = [...text.matchAll(headingRegex)];

  if (matches.length === 0) {
    // No headings found -- treat the whole file as one section
    return [{ heading: "Untitled section", body: text.trim() }];
  }

  const sections = [];
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    const start = current.index + current[0].length;
    const end = next ? next.index : text.length;
    const body = text.slice(start, end).trim();

    if (body.length < 10) continue; // skip empty/near-empty sections

    sections.push({ heading: current[1].trim(), body });
  }

  return sections;
}

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

function hashContent(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}
