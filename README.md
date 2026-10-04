# Kindred

**Find who your audience already loves, and where to meet them.**

Kindred is an AI agent for brand and partnership teams. Give it a brand, a market and a goal. It uses **Qloo Taste AI** to read the cultural affinities of that brand's audience across music, podcasts, TV, film, books, games, brands and places, maps where that audience concentrates in the city, and writes a partnership brief where every recommendation is backed by a Qloo affinity score.

Built for the Qloo Agentic Hackathon.

## Why it matters

Partnerships and activations are usually chosen by gut feeling or by slow, expensive survey panels. Qloo already knows, privacy-first, what an audience over-indexes on across domains. Kindred turns that signal into a decision in about a minute: who to partner with, why, and where to show up.

## How it works

```
brief ─► LLM agent (tool calling) ─► Qloo tools
            │  find_entity          /search
            │  get_affinities       /v2/insights  filter.type=urn:entity:{domain}
            │  get_heatmap          /v2/insights  filter.type=urn:heatmap
            │  get_audience_profile /v2/insights  filter.type=urn:demographics
            ▼
      submit_brief (structured JSON) ─► brief · taste graph · activation map
```

- **The agent plans its own research.** It resolves the brand, fans out parallel affinity queries per domain localized to the market, then reads the heatmap and venue affinities.
- **Grounded by design.** The brief can only be submitted after real Qloo data is gathered, and partners must come from tool results.
- **Live trace.** Every step streams to the UI over Server-Sent Events, so users watch the agent work.
- **Named hotspots.** Heatmap cells are labelled with neighbourhood names via OpenStreetMap reverse geocoding.
- **Zero dependencies.** Plain Node 20+ and Vercel Functions. The LLM is any OpenAI-compatible endpoint, Gemini by default.

## Security

- API keys live only in server-side environment variables. The browser never receives them.
- Strict Content-Security-Policy with no third-party scripts: Tailwind is compiled at build time and Leaflet is self-hosted, its files checked against the official 1.9.4 hashes.
- Upstream error bodies go to server logs with secrets redacted; users only see generic messages.
- The agent endpoint enforces input allow-lists, a same-origin check, a per-IP rate limit and a concurrency cap.
- User fields are treated as data in the prompt, and all model output is HTML-escaped before rendering.
- `npm test` covers these guarantees offline.

## Run locally

```bash
cp .env.example .env     # add QLOO_API_KEY and GEMINI_API_KEY
npm run selftest         # checks Qloo and LLM access
npm run dev              # http://localhost:3000
npm test                 # offline end-to-end test with synthetic data
```

## Deploy

Deploy to Vercel and set `QLOO_API_KEY` and `GEMINI_API_KEY` as environment variables.

## License

MIT
