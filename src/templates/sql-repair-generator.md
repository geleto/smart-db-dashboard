Repair the query to satisfy the data request. Return only one valid SQLite SELECT, without explanation, comments, or backticks.

Repair:
- Preserve the intent of the data request; do not invent tables, columns, filters, or values absent from the schema summary.
- If the previous query errored, fix the reported problem directly. If it returned zero rows, broaden or correct joins, filters, date logic, grouping, or ordering. If it used a table shown with 0 rows, switch to a relevant non-empty table.
- Do not fix a missing-column or alias error by only renaming aliases, or by substituting an unrelated column/constant that still claims to measure the missing field — the query shape may be the real problem.
- If a complex shape (correlated subqueries, medians, percentiles, ranks, quartiles) keeps failing, replace the optional statistic with direct aggregate evidence (counts, sums, averages, min, max) rather than failing the whole element.

Rules:
- Use only tables and columns from the schema summary, with their exact names. SQLite syntax only.
- Do not use `PERCENTILE_CONT`, `PERCENTILE_DISC`, or `WITHIN GROUP`. For value tiers or quartiles use `NTILE(4) OVER (ORDER BY metric)` or `ROW_NUMBER()` plus counts.
- Do not use window functions in `WHERE`, `GROUP BY`, or `HAVING`; compute them in a CTE/subquery, then filter in an outer `SELECT`.
- With `GROUP BY`, every selected column must be grouped or aggregated. Use simple aliases (letters, numbers, underscores only).
- With `UNION`/`UNION ALL`, order only by output columns, or wrap the union in a subquery; do not put `ORDER BY`/`LIMIT` inside a branch unless it is wrapped.
- Prefer small result sets; use `LIMIT` where appropriate.

{% if elementType == "metric" %}
{% include "metric-query.md" %}
{% elif elementType == "chart" %}
Chart: one row per displayed group via `GROUP BY`, aggregating every metric; for named categories `ORDER BY` the main metric and `LIMIT 12`.
{% elif elementType == "table" %}
Table: `LIMIT 20` unless clearly fewer are needed.
{% elif elementType == "insight" %}
Insight: compact aggregate or ranked evidence, not broad raw rows.
{% endif %}
{% if elementType == "chart" or elementType == "table" %}
Keep the natural order: chronological for trends, descending metric for rankings.
{% endif %}

Dataset description:
{{ datasetDescription }}

Schema summary:
{{ schemaSummary }}

Element type: {{ elementType }}
Data request:
{{ dataRequest }}

Previous SQL:
{{ previousSql }}

Execution feedback:
{{ failureReason }}

Repair attempt: {{ repairAttempt }}
