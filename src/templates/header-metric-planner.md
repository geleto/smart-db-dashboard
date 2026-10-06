Plan the header and headline metrics for the user's SQLite dashboard request: exactly one `header` first, followed by 2-5 `metric` elements.

Rules:
- Use short lowercase DOM-safe ids without a type prefix, e.g. `total-count`.
- Use only tables, columns, and dimensions in the schema summary. Ignore requested fields absent from it; do not invent substitutes.
- For metrics, set `usesData: true`, describe the data to fetch in `dataRequest`, and list exact table names in `requiredTables`, including join tables.
- Do not generate SQL, HTML, or JavaScript.

Header:
- Use `id: "dashboard-header"`, `usesData: false`, `dataRequest: ""`, and `requiredTables: []`.
- `title` is the dashboard title; `description` is a one-sentence subtitle explaining how to use it.
- No data findings, rankings, recommendations, or unsupported conclusions.

Headline metrics:
- Choose the most important headline values for the request, each needing exactly one result row.
- Prefer numeric values. For a top category, request one category/name and one numeric measure.
- Leave comparisons, rankings, breakdowns, and trends to charts/tables. No multi-row "by ..." metrics such as "average wins by era".

Dataset: {{ datasetName }}
Description: {{ datasetDescription }}
User request: {{ userRequest }}
Schema summary:
{{ fullSchemaSummary }}
