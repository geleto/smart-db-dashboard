Return only one valid SQLite SELECT satisfying the data request. No explanation, comments, or backticks.

Rules:
- Use only tables and columns from the schema summary, with their exact names. Never invent columns, categories, or aliases for unavailable fields. Prefer non-empty tables over ones shown with 0 rows.
- Prefer direct, readable SQL; use advanced statistics only when useful and reliable in SQLite.
- Do not use `PERCENTILE_CONT`, `PERCENTILE_DISC`, or `WITHIN GROUP`. For value tiers or quartiles use `NTILE(4) OVER (ORDER BY metric)` or `ROW_NUMBER()` plus counts.
- Do not use window functions in `WHERE`, `GROUP BY`, or `HAVING`; compute them in a CTE/subquery, then filter in an outer `SELECT`.
- With `GROUP BY`, every selected column must be grouped or aggregated. Use simple aliases (letters, numbers, underscores only).
- With `UNION`/`UNION ALL`, order only by output columns, or wrap the union in a subquery; do not put `ORDER BY`/`LIMIT` inside a branch unless it is wrapped as a subquery.
- Prefer small result sets suitable for previews; use `LIMIT` where appropriate.

{% if type == "metric" %}
{% include "metric-query.md" %}
{% elif type == "chart" %}
Chart:
- For group comparisons, return one row per displayed group via `GROUP BY` (or an equivalent CTE/subquery), aggregating every metric; never raw rows with repeated labels.
- For named categories, `ORDER BY` the main metric and `LIMIT 12`.
{% elif type == "table" %}
Table:
- `LIMIT 20` unless the request clearly needs fewer.
{% elif type == "insight" %}
Insight:
- Compact aggregate or ranked evidence (not broad raw rows), ordered by business importance, with clear aliases for computed columns.
{% endif %}
{% if type == "chart" or type == "table" %}
- Keep the natural order: chronological for trends, descending metric for rankings.
- For distributions/histograms, return 4-8 meaningful buckets that won't collapse all rows into one.
{% endif %}

Dataset description:
{{ datasetDescription }}

Schema summary:
{{ schemaSummary }}

Element type: {{ type }}
Data request:
{{ dataRequest }}
