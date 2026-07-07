# KanuAI Ingestion Pipeline

Parses downloaded legislation (PDFs), chunks by section, embeds via OpenAI,
and stores in Supabase Postgres (pgvector) for RAG retrieval.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (Project Settings -> API in Supabase), and
   `OPENAI_API_KEY`
3. Tables (`sources`, `documents`, `chunks`, `query_logs`) should already
   exist in Supabase -- `db/schema.sql` is kept for reference only
4. Put your downloaded Act PDFs in a `downloads/` folder, matching the
   filenames referenced in `scripts/ingest.js`
5. `npm run ingest`

## Deploying to Railway

1. Push this project to a GitHub repo
2. In Railway: New Project -> Deploy from GitHub repo
3. Add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` in
   Railway's Variables tab
4. Set the start command to `npm run ingest` if you want it as a one-off job,
   or wire it to Railway's Cron plugin if you want scheduled re-ingestion
   (e.g. monthly, since core Acts change infrequently)

Note: the service role key bypasses Row Level Security, which is what lets
this script write freely to all four tables. Never expose it client-side --
it's for this server-side ingestion job only.

## Adding new sources

Add an entry to `FILES_TO_INGEST` in `scripts/ingest.js` with the local file
path, source name, canonical URL, and content type. Re-running `npm run
ingest` skips sections whose content hash hasn't changed, so it's safe to
re-run after adding new files.

## Next steps

- Add a scraper module (using `cheerio`, already a dependency) for sources
  without clean downloads, e.g. Community Law Manual pages or Māori Land
  Court practice notes
- Build the retrieval script that queries `chunks` by cosine similarity
  against a user question's embedding