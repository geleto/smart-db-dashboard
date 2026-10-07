# Cheap, Fast, Concurrent: AI Agents on a Budget

Turn plain-English questions about any SQLite database into dashboards with metrics, charts, tables, and insights.
Renders a dashboard in under 15 seconds at a cost of less than half a cent.
Timings assume warm caches; run the dashboard several times first.

Read [the article](article.md) for the design and implementation details.

## How it works

1. Prepare the SQLite database and read its schema.
2. Start three planners concurrently, each streaming its planned cards: headers and metrics, charts and tables, and insights and text.
3. Process cards concurrently as they arrive: query their data, repair failures, and build their content.
4. Arrange the cards and save the HTML page.

## Setup

Requires Node.js 22.18 or later and npm on Windows or Linux. Open a terminal
in the project directory; the commands below are the same on both platforms.

```sh
npm install
```

Create a `.env` file in the project root with your API keys:

```dotenv
OPENAI_API_KEY=your_openai_api_key
# Optional: required when using Anthropic.
ANTHROPIC_API_KEY=your_anthropic_api_key
```

`src/setup.ts` defaults to GPT-6 Luna for both model roles:

- Basic: `none` reasoning for SQL drafts and card rendering.
- Advanced: `low` reasoning for planning, SQL repair, and written insights.

Adjust `basicReasoningEffort` and `advancedReasoningEffort` in `src/setup.ts`
to compare reasoning levels. The lowest reasoning setting is `low`; `none`
disables the reasoning pass. GPT-6 Luna does not support `minimal`.

To use Claude Haiku 4.5 for planning, SQL repair, and written insights, set
`advancedModelChoice` to `haiku` in `src/setup.ts` and add your Anthropic key above.
The OpenAI key is still required for SQL drafts and card rendering.

## Run

```sh
npm start
```

Pass a scenario number to override `activeScenario` for this run. Numbers start
at 1 and follow the order in `src/input.json`; for example, 5 runs Lahman team eras.

```sh
npm start -- 5
npm start -- --list
```

`--list` shows the available scenario numbers without generating a dashboard.

The dashboard is saved to `src/dashboard.html` and opens in your default browser.
On Linux, automatic opening uses `xdg-open`. If it is unavailable or you are
running without a desktop, open the generated HTML file in a browser manually.

KPIs use one shared layout: titles and descriptions come from planning, while
SQL supplies the value, optional secondary label, and any currency, precision,
or unit formatting. They require no separate HTML/JavaScript generation call.

## Example dashboards

Open these saved dashboards using the browser preview links below to explore
sample output without running the generator or making model calls. Dashboards are
hosted directly on GitHub Pages from the `main` branch. Each HTML file includes
its data; an internet connection is needed to load Bootstrap and Chart.js from
their CDNs.

- [Baseball team performance across eras](https://geleto.github.io/smart-db-dashboard/examples/baseball-performance.html) — `npm start 5`
- [Music catalog performance](https://geleto.github.io/smart-db-dashboard/examples/catalog-performance.html) — `npm start 12`
- [Film catalog demand](https://geleto.github.io/smart-db-dashboard/examples/film-demand.html) — `npm start 2`
- [Rental and payment activity](https://geleto.github.io/smart-db-dashboard/examples/rental-activity.html) — `npm start 1`
- [Taxonomic coverage](https://geleto.github.io/smart-db-dashboard/examples/taxonomic-coverage.html) — `npm start 3`

## Configure

Add your own scenarios under `scenarios` in `src/input.json`. Copy an existing
entry, give it a unique key, and set `userRequest` to your question. Each scenario
also needs `name`, `datasetName`, `datasetDescription`, and `databaseUrl`.
You can add different questions about the same database by reusing its dataset settings.

Database downloads support SQLite files, SQL scripts, and ZIP archives, and are
cached in `src/database/`.

To change the default for `npm start`, set `activeScenario` to a scenario's key.

## Logging and checks

The original logging is retained: scenario and schema details, downloads,
executed SQL, dashboard plans, model progress, timing, tokens, estimated cost,
and aggregate call statistics. Calls are grouped by model and reasoning level
so their timing and costs can be compared. The
Total row uses the same statistics as each model row; their times are summed
call durations. The final line reports dashboard generation time and estimated
total cost. `database.prepare()` ensures the local file is ready, reusing an
existing copy. Timing starts immediately before `database.open()` opens that
file in SQLite and ends when the dashboard HTML is saved. Schema profiling and
dashboard generation are included; file preparation and browser launch are excluded.
Run the dashboard several times to warm the caches before comparing timings.
Model prices in `src/setup.ts` are manual estimates using standard rates;
Luna rates apply up to 272K input tokens.

OpenAI commentary is excluded from the text used for JSON, SQL, and HTML;
its tokens are still included in usage and cost estimates.

```sh
npm run typecheck
npm test
```

## Cleanup

```sh
npm run clean
```

`clean` removes only this project's cached databases and generated dashboard.
Run it before changing the database URL for an existing dataset name.
