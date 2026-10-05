Render one dashboard element. Return JSON with `html` (one root fragment, no row/column wrapper) and `script` (raw JavaScript statements, or `""` if none).

Rules:
- Never output `<body>`, `<script>` tags, imports, comments, or `window.dashboardData`.
- No Markdown or code fences inside `html` or `script`.
- Use DOM ids derived from the element id (e.g. `-value`, `-table-body`, `-canvas`). The outer template already uses the element id; do not reuse it inside the fragment.
{% if elementType != "header" and elementType != "text" %}
- `script` is raw JS with real line breaks (no literal `\n`/`\r\n`/`\t`), run after DOMContentLoaded in an isolated function. Do not call `document.addEventListener`, `window.onload`, or wrap it in an IIFE.
- Call these provided helpers directly (do not redefine them or write fallbacks): `getData(key)`, `firstRow(key)`, `formatCurrency(value)`, `formatNumber(value, maximumFractionDigits)`, `formatPercent(value)`, `escapeHtml(value)`.
- `getData` and `firstRow` take the element id, never a table name.
- Access row fields using the exact property names in `previewJson`; use only fields present there, with no camelCase/PascalCase variants.
{% endif %}

{% if elementType != "header" %}
The page supplies the card wrapper, title{% if elementType != "text" %}, and description{% endif %}; return only its body content. Do not repeat them.
{% endif %}

{% if elementType == "header" %}
Header: a richer page header, not a card. One root `<header>` or `<div>`, title as the main heading, description as supporting copy, `script: ""`. No data findings or recommendations.
{% elif elementType == "metric" %}
Metric:
- Render the value as the largest/boldest text. No icons or inline font-size.
- Script reads the first row from `getData("<id>")` into a placeholder whose id ends `-value`. Numeric values use class `metric-value-number` (the template sizes them).
- If a metric has both a name and a number, put the number in `-value` (with `metric-value-number`) and the name in a small muted `-label`; do not join them with a dash.
{% elif elementType == "chart" %}
Chart:
- Include a fixed-height canvas wrapper `<div style="position: relative; height: 300px; width: 100%;"><canvas ...></canvas></div>` (use 360px–480px for horizontal bars with many labels).
- Create a Chart.js 4 chart with `responsive: true` and `maintainAspectRatio: false`, using scale ids `x`, `y`, `x2`, `y2` (never `xAxes`/`yAxes`).
- More than 4 named categories (e.g. countries, genres, artists): horizontal bar (`indexAxis: "y"`), category labels on `scales.y` without rotation, legend hidden when there is one dataset, showing at most the first 12 ordered rows via `.slice(0, 12)`.
- One visible label per row; never de-duplicate with `filter`/`indexOf`/`Set`/`find` — if labels repeat, aggregate them in JS first or render a table instead.
- Two unlike numeric datasets (e.g. counts vs averages): put the second on a secondary axis (`y2` vertical, `x2` horizontal) via its `yAxisID`/`xAxisID`, with that scale's `grid.drawOnChartArea: false`. More than two unlike measures: plot the two clearest or render a table.
- If `previewJson` has fewer than 2 rows, render a compact metric/table-style card instead of a chart.
{% elif elementType == "table" %}
Table: include `<tbody>` and a script that fills rows from `getData("<id>")`.
{% elif elementType == "text" %}
Text: static explanatory content based on the description; `script: ""`.
{% else %}
Other: simple body content; script only if data-backed.
{% endif %}

Element JSON:
```json
{{ elementJson }}
```
