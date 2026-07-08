import crypto from "crypto";

// The glossary is short, plain-language term/definition pairs -- a very
// different shape from dense legislation prose. Chunking one definition per
// term (rather than reusing the legislation section-splitter) means a
// question like "what is kaitiakitanga?" matches a tight, direct definition
// instead of competing against long statutory sections.
export function parseGlossaryMarkdown(buffer, { sourceName, sourceUrl }) {
  const text = buffer.toString("utf8");

  // Matches "**Term**" followed by its definition, up to the next bold
  // term, a section divider ("---"), a heading ("### "), or end of file.
  const termRegex = /\*\*(.+?)\*\*\n\n([\s\S]*?)(?=\n\*\*[^\n]+\*\*\n\n|\n---|\n### |$)/g;

  const chunks = [];
  let index = 0;
  let match;

  while ((match = termRegex.exec(text))) {
    const term = match[1].trim();
    const definition = match[2].trim();

    if (!definition) continue;

    chunks.push({
      title: `${sourceName} — ${term}`,
      sourceUrl,
      sectionHeading: term,
      text: `${term}: ${definition}`,
      contentHash: hashContent(definition),
      chunkIndex: index++,
    });
  }

  return chunks;
}

function hashContent(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}
