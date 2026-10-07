Render one dashboard element. Return JSON with `html` (one root fragment, no row/column wrapper) and `script` (raw JavaScript statements, or `""` if none).

Rules:
- Never output `<body>`, `<script>` tags, imports, comments, or `window.dashboardData`.
- No Markdown or code fences inside `html` or `script`.
- Use DOM ids derived from the element id (e.g. `-table-body`, `-canvas`). The outer template already uses the element id; do not reuse it inside the fragment.
{% if element.type != "header" and element.type != "text" %}
- `script` is raw JS with real line breaks (no literal `\n`/`\r\n`/`\t`), run after DOMContentLoaded in an isolated function. Do not call `document.addEventListener`, `window.onload`, or wrap it in an IIFE.
- Call these provided helpers directly (do not redefine them or write fallbacks): `getData(key)`, `firstRow(key)`, `formatCurrency(value)`, `formatNumber(value, maximumFractionDigits)`, `formatPercent(value)`, `escapeHtml(value)`.
- `getData` and `firstRow` take the element id, never a table name.
- Access row fields using the exact property names in `previewJson`; use only fields present there, with no camelCase/PascalCase variants.
{% endif %}

{% if element.type != "header" %}
The page supplies the card wrapper, title{% if element.type != "text" %}, and description{% endif %}; return only its body content. Do not repeat them.
{% endif %}

{% if element.type == "header" %}
Header: a richer page header, not a card. One root `<header>` or `<div>`, title as the main heading, description as supporting copy, `script: ""`. No data findings or recommendations.
{% elif element.type == "chart" %}
Chart:
- Include a fixed-height canvas wrapper `<div style="position: relative; height: 300px; width: 100%;"><canvas ...></canvas></div>` (use 360px–480px for horizontal bars with many labels).
- Create a Chart.js 4 chart with `responsive: true` and `maintainAspectRatio: false`, using scale ids `x`, `y`, `x2`, `y2` (never `xAxes`/`yAxes`).
- Choose chart type from the data request, preview, and `rowCount` (the full result size).
- Use `type: "line"` for time series or ordered numeric series with >8 values, including string/range labels. Prefer lines for continuous trends with fewer points.
- Prefer `type: "pie"` for 2-7 shares totaling 100%. Use bars to compare rates and lines over time.
- Otherwise, bars: unordered categories or small discrete numeric comparisons/histograms (<=8 values).
- Lines: plot all rows in chronological/numeric x order; no slicing or ranking. Use `scales.x.ticks: { autoSkip: true, maxTicksLimit: 8, maxRotation: 0 }`.
- Line datasets: `fill: false`, `tension: 0`, `borderWidth: 2`, `pointHoverRadius: 4`; `pointRadius: 0` for >20 points, otherwise 2.
- For bars with >4 unordered categories, use `indexAxis: "y"`, unrotated y labels, `.slice(0, 12)`, and no legend for one dataset.
- One visible label per row; never de-duplicate with `filter`/`indexOf`/`Set`/`find` — if labels repeat, aggregate them in JS first or render a table instead.
- Two unlike numeric datasets (e.g. counts vs averages): put the second on a secondary axis (`y2` vertical, `x2` horizontal) via its `yAxisID`/`xAxisID`, with that scale's `grid.drawOnChartArea: false`. More than two unlike measures: plot the two clearest or render a table.
- If `rowCount < 2`, render a compact metric/table-style card instead of a chart.
{% elif element.type == "table" %}
Table: include `<tbody>` and a script that fills rows from `getData("<id>")`.
{% elif element.type == "text" %}
Text: static explanatory content based on the description; `script: ""`.
{% else %}
Other: simple body content; script only if data-backed.
{% endif %}

Element JSON:
```json
{{ {
	id: element.id,
	type: element.type,
	title: element.title,
	description: element.description,
	usesData: element.usesData,
	dataRequest: element.dataRequest,
	requiredTables: element.requiredTables,
	rowCount: element.rowCount,
	previewJson: element.previewJson
} | dump(2) }}
```
