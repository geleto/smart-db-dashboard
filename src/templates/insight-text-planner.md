Plan 1-2 `insight` elements and optionally 1 `text` guide for the user's SQLite dashboard request. Keep room for the core visualizations.

Rules:
- Use short lowercase DOM-safe ids without a type prefix, e.g. `key-findings`.
- Use only tables, columns, and dimensions in the schema summary. Ignore requested fields absent from it; do not invent substitutes.
- Do not generate SQL, HTML, or JavaScript.

Insights:
- For conclusions, recommendations, or executive summaries, set `usesData: true` and list exact table names in `requiredTables`, including join tables.
- `dataRequest` describes narrow, directly interpretable evidence obtainable with one SQLite SELECT, usually one ranked or grouped result. Avoid multi-topic queries and `UNION`.
- Conclusions will be generated later from query results; do not put them in the description.

Static guide text:
- Use `text` only for orientation, definitions, methodology, caveats, or reading instructions. Set `usesData: false`, `dataRequest: ""`, and `requiredTables: []`.
- No data findings, recommendations, rankings, trends, or conclusions; no placeholders such as "insights pending" or "analysis unavailable".

Dataset: {{ datasetName }}
Description: {{ datasetDescription }}
User request: {{ userRequest }}
Schema summary:
{{ fullSchemaSummary }}
