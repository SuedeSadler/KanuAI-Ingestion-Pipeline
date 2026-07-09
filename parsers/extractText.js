import path from "path";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import * as cheerio from "cheerio";

// Extracts plain text (with markdown-style ## headings preserved where
// possible) from any supported file type, so the curated content parser
// can chunk it the same way regardless of source format.
export async function extractText(buffer, filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".pdf": {
      const { text } = await pdf(buffer);
      return text;
    }

    case ".docx": {
      // convertToMarkdown preserves Word's Heading 1/2/3 styles as
      // "#"/"##"/"###" lines, which the heading-splitter can then use --
      // this is what makes chunking meaningful rather than one giant blob.
      const result = await mammoth.convertToMarkdown({ buffer });
      return result.value;
    }

    case ".doc":
      throw new Error(
        `"${filePath}" is an old-format .doc file, which isn't reliably ` +
        `parseable without extra tooling. Please re-save it as .docx or ` +
        `export it as a PDF from Word, then try again.`
      );

    case ".html":
    case ".htm": {
      const $ = cheerio.load(buffer.toString("utf8"));
      const lines = [];
      $("h1, h2, h3, p, li").each((_, el) => {
        const tag = el.tagName.toLowerCase();
        const text = $(el).text().trim();
        if (!text) return;
        if (tag === "h1" || tag === "h2") lines.push(`## ${text}`);
        else if (tag === "h3") lines.push(`### ${text}`);
        else lines.push(text);
      });
      return lines.join("\n\n");
    }

    case ".md":
    case ".txt":
    case ".markdown":
      return buffer.toString("utf8");

    default:
      throw new Error(
        `Unsupported file type "${ext}" for "${filePath}". Supported: ` +
        `.pdf, .docx, .md, .txt, .html`
      );
  }
}
