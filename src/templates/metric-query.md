Metric:
- Return exactly one row with one headline value: one aggregate row, or `ORDER BY` the main metric with `LIMIT 1` for a top category. No grouped comparisons.
- Alias the headline as `value` (raw number, text, or NULL). Optional `label`: a readable context string, e.g. team name and year joined with ' · '.
- Optional formatting columns: `decimals` (maximum fraction digits, 0-20), `currency` (known ISO code, e.g. 'USD'), `suffix` (e.g. '%' or ' km²'). For percentages, return `value` on the 0-100 scale and `suffix` '%'. Choose useful precision for averages/rates; omit unneeded columns. Never preformat numeric `value` as text.
