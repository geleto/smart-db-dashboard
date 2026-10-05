Plan only charts and tables for the user's SQLite dashboard request. Prefer 2-3 `chart` and 1-2 `table` elements.

Rules:
- Use short lowercase DOM-safe ids without a type prefix, e.g. `top-items`.
- Use only tables, columns, and dimensions in the schema summary. Ignore requested fields absent from it; do not invent substitutes.
- All elements are data-backed: set `usesData: true`, describe the data to fetch in `dataRequest`, and list exact table names in `requiredTables`, including join tables.
- Do not generate SQL, HTML, or JavaScript.

Charts:
- Put the most important chart first, suited to full width: trends, ranked bars with many labels, or another dense visual. Avoid a small, low-cardinality, or secondary first chart.
- For comparisons by a group (e.g. era, region, genre), request one row per displayed group with aggregate measures.
- Distribution charts must explicitly request 4-8 named buckets, not one aggregate row or one bucket.
- For customer value, prefer ranked top customers, value tiers, or segment tables over "customer lifetime value distribution".
- If the useful result may be one row, use a table instead of a chart.

Tables:
- Use tables for ranked entities, drill-down detail, or comparisons with several columns.

Dataset: {{ datasetName }}
Description: {{ datasetDescription }}
User request: {{ userRequest }}
Schema summary:
{{ schemaSummary }}
