import "dotenv/config";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { parseLegislationPdf, hashFile } from "../parsers/legislationParser.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Add one entry per downloaded Act you want to ingest
const FILES_TO_INGEST = [
  {
    filePath: "./downloads/te-ture-whenua-maori-act-1993.pdf",
    sourceName: "Te Ture Whenua Māori Act 1993",
    sourceUrl: "https://www.legislation.govt.nz/act/public/1993/0004/latest/whole.html",
    contentType: "statute",
  },
  {
    filePath: "./downloads/wills-act-2007.pdf",
    sourceName: "Wills Act 2007",
    sourceUrl: "https://www.legislation.govt.nz/act/public/2007/0036/latest/whole.html",
    contentType: "statute",
  },
  {
    filePath: "./downloads/protection-of-personal-and-property-rights-act-1988.pdf",
    sourceName: "Protection of Personal and Property Rights Act 1988",
    sourceUrl: "https://www.legislation.govt.nz/act/public/1988/0004/latest/whole.html",
    contentType: "statute",
  },
  {
    filePath: "./downloads/protection-of-personal-and-property-rights-regulations-1988.pdf",
    sourceName: "Protection of Personal and Property Rights Regulations 1988",
    sourceUrl: "https://www.legislation.govt.nz/secondary-legislation/pco-drafted/1988/229/en/latest/",
    contentType: "statute",
  },
  {
    filePath: "./downloads/administration-act-1969.pdf",
    sourceName: "Administration Act 1969",
    sourceUrl: "https://www.legislation.govt.nz/act/public/1969/52/en/latest/",
    contentType: "statute",
  },
  {
    filePath: "./downloads/maori-land-court-rules-2011.pdf",
    sourceName: "Māori Land Court Rules 2011",
    sourceUrl: "https://legislation.govt.nz/regulation/public/2011/0374/latest/whole.html",
    contentType: "court_guidance",
  },
];

async function main() {
  for (const file of FILES_TO_INGEST) {
    console.log(`\nIngesting: ${file.sourceName}`);
    await ingestFile(file);
  }
}

async function ingestFile({ filePath, sourceName, sourceUrl, contentType }) {
  const sourceId = await upsertSource(sourceName, sourceUrl, contentType);

  const buffer = fs.readFileSync(filePath);
  const fileHash = hashFile(buffer);

  const unchanged = await sourceFileUnchanged(sourceId, fileHash);
  if (unchanged) {
    console.log(`  Skipping entire file — unchanged since last ingestion`);
    return;
  }

  const sections = await parseLegislationPdf(buffer, { sourceName, sourceUrl });

  console.log(`  Parsed ${sections.length} sections`);

  for (const section of sections) {
    const alreadyIngested = await documentUnchanged(sourceUrl, section.chunkIndex, section.contentHash);
    if (alreadyIngested) {
      console.log(`  Skipping unchanged: ${section.sectionHeading}`);
      continue;
    }

    const documentId = await upsertDocument(sourceId, section);
    const embedding = await embed(section.text);
    await insertChunk(documentId, section, embedding);

    console.log(`  Embedded: ${section.sectionHeading}`);
  }

  await touchSourceLastFetched(sourceId, fileHash);
}

async function sourceFileUnchanged(sourceId, fileHash) {
  const { data, error } = await supabase
    .from("sources")
    .select("file_hash")
    .eq("id", sourceId)
    .limit(1);

  if (error) throw error;
  if (!data || data.length === 0) return false;

  return data[0].file_hash === fileHash;
}

async function upsertSource(name, baseUrl, contentType) {
  const { data: existing, error: selectError } = await supabase
    .from("sources")
    .select("id")
    .eq("name", name)
    .limit(1);

  if (selectError) throw selectError;
  if (existing && existing.length > 0) return existing[0].id;

  const { data, error } = await supabase
    .from("sources")
    .insert({ name, base_url: baseUrl, content_type: contentType, fetch_method: "manual_download" })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function documentUnchanged(sourceUrl, chunkIndex, contentHash) {
  // Join documents -> chunks isn't directly expressible via the JS client,
  // so this checks in two steps: find the document, then check for a chunk
  // at this index with a matching hash.
  // Uses limit(1) rather than maybeSingle() so this stays safe even if
  // duplicate rows exist from an earlier interrupted run.
  const { data: docs, error: docError } = await supabase
    .from("documents")
    .select("id, content_hash")
    .eq("source_url", sourceUrl)
    .eq("content_hash", contentHash)
    .limit(1);

  if (docError) throw docError;
  if (!docs || docs.length === 0) return false;

  const { data: chunks, error: chunkError } = await supabase
    .from("chunks")
    .select("id")
    .eq("document_id", docs[0].id)
    .eq("chunk_index", chunkIndex)
    .limit(1);

  if (chunkError) throw chunkError;
  return !!(chunks && chunks.length > 0);
}

async function upsertDocument(sourceId, section) {
  const { data, error } = await supabase
    .from("documents")
    .insert({
      source_id: sourceId,
      title: section.title,
      source_url: section.sourceUrl,
      content_hash: section.contentHash,
      raw_text: section.text,
      fetch_date: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function embed(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

async function insertChunk(documentId, section, embedding) {
  const { error } = await supabase.from("chunks").insert({
    document_id: documentId,
    chunk_index: section.chunkIndex,
    section_heading: section.sectionHeading,
    chunk_text: section.text,
    embedding, // supabase-js serializes the array correctly for the vector column
    token_count: estimateTokens(section.text),
  });

  if (error) throw error;
}

async function touchSourceLastFetched(sourceId, fileHash) {
  const { error } = await supabase
    .from("sources")
    .update({ last_fetched_at: new Date().toISOString(), file_hash: fileHash })
    .eq("id", sourceId);

  if (error) throw error;
}

function estimateTokens(text) {
  // rough estimate -- good enough for logging/monitoring, not billing-accurate
  return Math.ceil(text.length / 4);
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});