# Kindred

**Find who your audience already loves, and where to meet them.**

Kindred is an AI agent for brand and partnership teams. Give it a brand, a market city and a goal. It uses **Qloo Taste AI** to read the cultural affinities of that brand's audience across music, podcasts, TV, film, brands and places, maps where that audience concentrates in the city, and writes a partnership brief in which every partner and venue is checked against Qloo results from that run. Direct competitors are kept out using Qloo's own brand tags, and the brief says which ones were skipped and why.

Live demo: https://kindred-taste.vercel.app (no login). Built for the Qloo Agentic Hackathon. MIT licence.

![Kindred brief for Veja in Paris: partners with Qloo affinities, provenance labels, audience skew and the comparison with an LLM alone](docs/screenshot.png)

## The problem

Partnerships, sponsorships and pop-ups are usually picked by gut feeling, by whoever is famous, or by slow survey panels. Ask a general-purpose LLM and you get plausible names it has seen often, with no evidence that this brand's audience actually cares about them. Kindred answers three questions with aggregate taste data instead: who this audience over-indexes on, how strongly, and where in the city it concentrates. It takes about a minute.

## With Qloo vs LLM only

Every brief can be compared with what the same model says without Qloo. For the same brand, market and goal, the model answers in one call with no tools and no data. Then both answers are scored by Qloo for the same audience and market (`/v2/insights` with `filter.results.entities`), so both columns use one scale. Misses are reported as such, never imputed.

Results from the recorded real runs (October 2026, model `gemini-flash-lite-latest`):

| Brand · market (goal) | Kindred picks: avg Qloo affinity | LLM-only picks: avg Qloo affinity (scored) | LLM-only picks with no Qloo support | Kindred picks the LLM alone missed |
|---|---|---|---|---|
| Patagonia · Barcelona (brand partnership or co-branded collab) | 95% | 85% (1 of 4) | 3 of 4 | 3 of 3 |
| Oatly · London (pop-up activation) | 97% | 85% (1 of 4) | 3 of 4 | 4 of 4 |
| Liquid Death · Austin (music or event sponsorship) | 94% | 86% (1 of 4) | 3 of 4 | 3 of 3 |
| Blue Bottle Coffee · Tokyo (pop-up activation) | 96% | 88% (1 of 4) | 3 of 4 | 3 of 3 |
| Robinhood · New York (podcast or media sponsorship) | 94% | 69% (1 of 4) | 3 of 4 | 3 of 3 |
| Veja · Paris (creator or talent partnership) | 92% | n/a (0 of 4) | 4 of 4 | 3 of 3 |
| Greenpeace · Mexico City (music or event sponsorship, 35 and younger) | 94% | 88% (2 of 4) | 2 of 4 | 3 of 3 |

Across the seven runs, all 22 of Kindred's partners matched Qloo results (average affinity 95%) and none of them was named by the model alone. Of the model's 28 picks, 21 had no Qloo affinity for that audience and city or were not found by Qloo search; the 7 that Qloo could score averaged 84%. Five runs were re-recorded on 6 October 2026 with the competitor filter; none of the seven briefs contains a direct competitor.

Reading the table: Kindred's partners come from the audience's top Qloo affinities, so they score higher by construction; the point is that a model on its own does not know those affinities. Its picks are often local, plausible and unsupported: Qloo returns no affinity for them with this audience in that city, or its search does not find them. Kindred's picks are also ones the model alone did not name. The comparison runs live too (button under any live brief), within the same rate limits.

## How it works

```
brand, market, goal ─► server resolves the brand in Qloo (/search)
                    ─► LLM agent with tool calling (Gemini, OpenAI-compatible API)
                          get_affinities        /v2/insights  filter.type=urn:entity:{artist|podcast|tv_show|brand|place|...}
                          get_heatmap           /v2/insights  filter.type=urn:heatmap
                          get_audience_profile  /v2/insights  filter.type=urn:demographics
                          (brand results: direct competitors withheld by Qloo brand tags)
                    ─► submit_brief (structured JSON)
                    ─► server check: every partner and venue matched to a Qloo result of this run;
                       a rival proposed as a partner is sent back to the model once, removed if it stays
                    ─► brief · LLM-only comparison · taste graph · activation map · trace
```

Why these Qloo calls fit the problem:

- **Entity resolution** (`/search`) pins the brand to a Qloo entity id. The id, not the name, is the signal for everything else.
- **Cross-domain affinities** (`/v2/insights`, `signal.interests.entities=<brand id>`, one call per domain, localized with `signal.location.query`) answer "who does this audience over-index on" in music, podcasts, TV, brands and more. This is the part an LLM cannot know.
- **Places** (`filter.type=urn:entity:place`, `filter.location.query`) give concrete venues in the market city.
- **Heatmap** (`filter.type=urn:heatmap`) shows where in the city the audience concentrates; hotspots get neighbourhood names from OpenStreetMap.
- **Demographics** (`filter.type=urn:demographics`) gives the audience's age and gender skew.
- **Candidate scoring** (`filter.results.entities`) asks Qloo for the affinity of specific entities, which is how the LLM-only picks are measured on the same scale.
- **Brand tags** (`competitor_brand`, `similar_brand`, `industry`, `product_category` on brand entities; `category` on places) decide what a direct competitor is. Affinity is not complementarity: co-affinity is strongest inside a category, so for Patagonia in Barcelona the top brands were The North Face (98%), Arc'teryx (96%) and Fjällräven (96%), all rivals. A candidate is skipped when Qloo lists it as the brand's competitor or the brand as its competitor; when both share a Qloo industry and product category (Illy for Blue Bottle Coffee: Food & Beverage, Coffee); when Qloo tags it as a similar brand and the products overlap (Voodoo Ranger for Liquid Death: Hard Tea and Iced Tea); or, for a place, when its category is the brand's own business (a coffee shop for a café chain). Complementary brands stay: Oatly keeps Moving Mountains (plant-based meat), Patagonia keeps GoPro.

The agent decides which domains fit the goal and fires the calls in parallel; a throttle keeps at most 3 Qloo requests in flight and retries 429s with bounded backoff. The brief can only be submitted after real affinity data has been gathered.

## Provenance and limits in the product

- Every block of the brief is labelled **Qloo data** (partner affinities, venues, heatmap, taste graph, audience skew) or **AI interpretation** (headline, concepts, plan, themes, watch-outs).
- The server matches each partner and venue the model wrote to a Qloo result from the same run. Displayed affinities are always Qloo's; if the model misquoted a number, both are shown. Unmatched names are flagged as unverified.
- **Skipped as direct competitors** lists the rivals withheld from the model, with their affinity and the Qloo-tag reason; the taste graph marks them. If the model still proposes a rival, the server rejects the draft once with the reason ("proposed by the model, removed by the server check" if it persists). The prompt carries the same rule as a backup for rivals that Qloo's tags miss.
- **How this brief was built** (collapsible) shows the redacted request-to-result trace: inputs, each model turn, every Qloo request with entity ids, result names and counts, the server check and the LLM-only scoring. It also shows how credentials and data are handled and what the brief does not establish. The trace can be downloaded as JSON.

### Request-to-result example (redacted)

Patagonia, Barcelona, "Brand partnership or co-branded collab", recorded run of 6 October 2026. The API key is sent only from the server in a request header and never appears in traces, recordings or logs.

```
1. GET /search?query=Patagonia&types=urn:entity:brand&take=5
   -> Patagonia (DB4CE34E-3A63-4947-946F-9D52502C5762), Cerveza Patagonia (0AADEF2D-...)
   Entity choice: the first result, the outdoor brand; the beer brand is ignored.
2. Model turn 1 chooses 7 tools in parallel: get_affinities x5 (podcast, artist, tv_show, brand, place), get_heatmap, get_audience_profile
3. GET /v2/insights?filter.type=urn:entity:podcast&signal.interests.entities=DB4CE34E-...&take=8&signal.location.query=Barcelona
   -> The Rich Roll Podcast (C752CB19-..., affinity 0.975), The Tim Ferriss Show (0.966), ...
   GET /v2/insights?filter.type=urn:entity:tv_show&... -> Down to Earth with Zac Efron (0.949), Anthony Bourdain: Parts Unknown (0.943), ...
   GET /v2/insights?filter.type=urn:entity:brand&...   -> The North Face (0.976), Arc'teryx (0.960), Fjällräven (0.959), GoPro (0.958), ...
      competitor filter (Qloo brand tags): The North Face and Arc'teryx are listed as Patagonia competitors;
      Fjällräven, Icebreaker and Huckberry list Patagonia as theirs. All five are withheld from the model.
   GET /v2/insights?filter.type=urn:entity:place&...&filter.location.query=Barcelona -> Hotel Catalonia Magdalenes (0.829), ...
   GET /v2/insights?filter.type=urn:heatmap&filter.location.query=Barcelona&... -> 1,301 cells; hotspots l'Eixample, Gràcia
   GET /v2/insights?filter.type=urn:demographics&... -> age and gender skew
4. Model turn 2 submits the brief: partners GoPro, Backpacker Magazine, Down to Earth with Zac Efron;
   venues Murmuri Residence Concepció, Yurbban Passage Hotel & Spa
5. Server check: 3/3 partners and 2/2 venues matched to Qloo results; no competitor proposed.
6. LLM only (same model, no tools): Nomada Studio, Casa Bonay, Ricardo Cavolo, El Extraordinario.
   GET /v2/insights?filter.type=urn:entity:brand&...&signal.location.query=Barcelona&filter.results.entities=AF49B6D7-... -> Nomada Studio 0.853
   GET /v2/insights?filter.type=urn:entity:artist&...&filter.results.entities=EB54CADB-... -> no affinity returned for Barcelona
   Casa Bonay and El Extraordinario: not found in Qloo.
```

## Demo resilience

- **Recorded real runs** of seven brands in seven cities (outdoor apparel in Barcelona, plant-based food in London, beverages in Austin, specialty coffee in Tokyo, fintech in New York, sneakers in Paris, a nonprofit in Mexico City with an under-35 audience). They replay the exact event stream, including the LLM-only comparison, with no API calls. Each is 20-40 KB. Direct links: `/?example=patagonia-barcelona`, `/?example=blue-bottle-tokyo`, and so on (slugs in `public/examples/index.json`).
- **Share links without storage.** "Copy share link" puts the whole brief, compressed, in the URL fragment (`/#b=...`, about 7 KB). Browsers never send the fragment to a server, nothing is stored, and the link reopens the brief even when quotas run out. Opened links are sanitized (known shapes only, no remote images) and labelled as snapshots.
- **Friendly limits.** When Qloo, the model or the demo limit says "not now", the UI explains it and offers the recorded runs and a retry.

## Setup from a clean environment

Requirements: Node.js 20 or newer and git. There are no npm dependencies.

```bash
git clone https://github.com/eiieval/kindred.git
cd kindred
npm test                 # offline checks, no keys needed (synthetic data)
MOCK=1 npm run dev       # full UI with synthetic data at http://localhost:3000
```

With real data:

```bash
cp .env.example .env     # set QLOO_API_KEY (event-issued) and GEMINI_API_KEY; QLOO_BASE_URL defaults to https://hackathon.api.qloo.com
npm run selftest         # checks Qloo and model access; prints shapes, never secrets
npm run dev              # http://localhost:3000
npm run examples         # re-records public/examples (options: -- --only=slug,slug  -- --baseline-only)
```

Any OpenAI-compatible endpoint works instead of Gemini: set `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`. Styles are compiled with `npm run build:css` (Tailwind CLI via npx, build time only).

Deploy: Vercel, with `QLOO_API_KEY` and `GEMINI_API_KEY` as environment variables (see `vercel.json`).

## Known limitations (what a brief does not establish)

- Qloo affinities are aggregate: how much the audience of a brand over-indexes on an entity versus the average Qloo audience. They are not statements about any individual, not causal, and not a forecast that a partnership will work.
- Only the top results per domain are retrieved. An entity missing from a brief is not evidence of low affinity. "No affinity returned" in the comparison means Qloo gave no score for that entity with this audience and market, nothing more.
- Audience skews are relative indices, not a census, and must not drive decisions about people.
- Concepts, headlines, plans and themes are written by the model. They can be wrong or unsuitable: check rights, availability and brand fit before acting.
- The competitor filter is only as complete as Qloo's brand tags. A rival that Qloo does not tag as a competitor, a similar brand or the same category can slip through (the prompt rule is the backup), and a stockist that shares a category can be skipped. Venues are not filtered: they are where the audience goes, which for a coffee brand may well be other cafés. Brand entities can also be ambiguous in Qloo: the "Veja" entity used in the Paris example carries the Brazilian news magazine's tags, so its audience skews Brazilian.
- Entity matching between names and Qloo entities is deliberately conservative; a correct partner written with an unusual spelling can show as unverified.
- Neighbourhood names come from OpenStreetMap reverse geocoding of heatmap cells and can be approximate.
- Recorded examples and share links reflect Qloo data on the day they were made. A share link can be edited by whoever shares it; re-run the brief to confirm.
- The live demo shares one event-issued Qloo key and a free model tier, so it is rate limited (per IP and globally).

## Data handling and security

- Kindred sends Qloo only a brand name, a city and an optional age band. It collects no personal data, has no accounts and stores no briefs on a server.
- Keys live only in server-side environment variables. Upstream error bodies go to server logs with secrets redacted; users see generic messages.
- Strict Content-Security-Policy with no third-party scripts or fonts: Tailwind is compiled at build time, Leaflet and the Inter font are self-hosted with recorded hashes (`public/vendor`).
- The agent endpoint enforces input allow-lists, a same-origin check, a per-IP rate limit and a concurrency cap. User fields are treated as data in prompts, and all model output is HTML-escaped before rendering.
- `npm test` covers these guarantees offline, plus the provenance checks, the comparison logic, share links and the size and content of every recording.

## Credits

Taste data by [Qloo](https://www.qloo.com). Maps and neighbourhood names © OpenStreetMap contributors. Inter typeface by The Inter Project Authors (SIL Open Font License 1.1). Brand names in the examples are used for illustration only; no affiliation is implied.

## License

MIT
