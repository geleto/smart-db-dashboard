# Cheap, Fast, Concurrent: AI Agents on a Budget

> **Preliminary draft:** This article is a work in progress.

We built [Smart DB Dashboard](https://github.com/geleto/smart-db-dashboard), an AI agent that turns a SQLite database and a question in plain English into an interactive dashboard with metrics, charts, tables, and insights. It plans the content, queries the data, and generates the page in **under 15 seconds** for **less than half a US cent ($0.005)** in estimated model cost. This article explains the methods behind that speed and efficiency.

The reported timing assumes warm caches. Run the dashboard several times first.

Here are four example dashboards, with their datasets and the requests used to generate them:

| Dashboard | Dataset | User request |
| --- | --- | --- |
| [Baseball team performance across eras](https://geleto.github.io/smart-db-dashboard/examples/basebal-perfomance.html) | **Lahman**: historical baseball statistics from 1871 to 2022, including teams, players, batting, pitching, and postseason records. | "Explore how baseball team performance changed across eras, including wins, scoring, pitching, and standout seasons." |
| [Music catalog performance](https://geleto.github.io/smart-db-dashboard/examples/catalog-perfomance.html) | **Chinook**: a sample music store database with artists, albums, tracks, genres, customers, and sales invoices. | "Analyze our catalog performance by genre, artist, album, and track so we can prioritize content and promotion decisions." |
| [Film catalog demand](https://geleto.github.io/smart-db-dashboard/examples/film-demand.html) | **Sakila**: a sample DVD rental store database with films, actors, categories, inventory, customers, rentals, and payments. | "Analyze film catalog demand by category, rating, rental duration, replacement cost, actors, and store inventory to identify notable viewing patterns." |
| [Taxonomic coverage](https://geleto.github.io/smart-db-dashboard/examples/taxonomic-coverage.html) | **ITIS**: a taxonomy database with scientific and common names, ranks, hierarchy records, and synonyms across animals, plants, fungi, and microbes. | "Explore taxonomic coverage across kingdoms, ranks, major groups, and hierarchy depth to understand what kinds of organisms are represented." |

## How it works

1. Prepare the SQLite database and read its schema.
2. Start three planners concurrently, each streaming its planned cards: headers and metrics, charts and tables, and insights and text.
3. Process cards concurrently as they arrive: query their data, repair failures, and build their content.
4. Arrange the cards and save the HTML page.

## How we make it fast and efficient

These are the main methods:

- [**Match the model to the task**](#match-the-model-to-the-task)
- [**Divide the work into focused tasks**](#divide-the-work-into-focused-tasks)
- [**Use regular code instead of AI for routine work**](#use-regular-code-instead-of-ai-for-routine-work)
- [**Define and check the output**](#define-and-check-the-output)
- [**Minimize context for each task**](#minimize-context-for-each-task)
- [**Keep generated output short**](#keep-generated-output-short)
- [**Run independent work concurrently**](#run-independent-work-concurrently)
- [**Stream results and process them as they arrive**](#stream-results-and-process-them-as-they-arrive)
- [**Fix failed tasks with retries**](#fix-failed-tasks-with-retries)
- [**Remove unnecessary model calls**](#remove-unnecessary-model-calls)
- [**Cache reusable work: static first, dynamic last**](#cache-reusable-work-static-first-dynamic-last)

The code examples use [Casai](https://github.com/geleto/casai) to define tasks and [Cascada](https://github.com/geleto/cascada/blob/master/docs/cascada/script.md) to run them. The same ideas work with other libraries.

The examples follow the Lahman baseball dashboard.

We introduce the model settings and Casai components first, then show that workflow. The snippets reuse the project's setup: `loader` reads files, `input` holds the dataset details and user request, and `database` accesses SQLite. Prompt links lead to the full instructions.

### Match the model to the task

Choose a model and reasoning level that fit the job. Drafting a simple query needs less thought than planning a dashboard or fixing a broken query. Test the settings on real requests and compare time, cost, and results, including retries.

Casai's `Config` lets tasks share settings. We use [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) with reasoning set to `none` for SQL drafts and rendering, and `low` for planning, repairs, and insights.

```typescript
const fastConfig = create.Config({
  model: openai.responses('gpt-6-luna'),
  providerOptions: { openai: { reasoningEffort: 'none' } },
});
// Inherit the model; enable reasoning for harder tasks.
const reasoningConfig = create.Config({
  providerOptions: { openai: { reasoningEffort: 'low' } },
}, fastConfig);
```

The second configuration keeps the same model and changes the reasoning setting. Pass a configuration as the second argument when creating a component to give it those settings.

### Divide the work into focused tasks

Give each task one clear job: decide what to show, write a query, or build a chart. Each task gets a simpler prompt and can be checked on its own. If one fails, retry it without starting over. Extra model calls take time and cost money, so split the work only when it helps.

Our dashboard breaks the work into these tasks:

- **Plan the content:** choose metrics, charts, tables, and insights.
- **Write queries:** generate SQL for each item that needs data.
- **Run queries:** fetch the data from SQLite.
- **Repair queries:** fix SQL that fails or returns no data.
- **Write insights:** explain what the results show.
- **Render cards:** format metrics and build charts and tables.
- **Assemble the page:** combine the cards into the dashboard.

Casai provides `Config` for shared settings and these **components** for defining and connecting those tasks:

- `Config`: share model and other settings across components.
- `Template`: render text or HTML from data, without a model call.
- `Script`: run a Cascada workflow that connects the tasks.
- `TextGenerator`: generate text, such as SQL or insight HTML.
- `TextStreamer`: stream text as the model generates it.
- `ObjectGenerator`: generate structured results checked against a schema.
- `ObjectStreamer`: stream structured items, such as planned dashboard cards.

**Modifiers** customize a component. For example, `TextGenerator.withTemplate` renders a Cascada template to generate the prompt. Common modifiers include:

- `withTemplate`: generate the prompt from a template written in code.
- `loadsTemplate`: load and render a template from a file.
- `withScript`: generate the prompt by running a Cascada script written in code.
- `loadsScript`: load a Cascada script from a file.

Our insight writer turns query results into short HTML. It uses the shared `reasoningConfig` and a shortened [prompt](src/templates/text-insight-generator.md). The prompt is a Cascada template: `{{ previewJson }}` outputs the result preview supplied when the component is called.

```typescript
// Render the template into a prompt before calling the model.
const insightWriter = create.TextGenerator.withTemplate({
  prompt: `
Write 3–5 short takeaways supported only by these query results.
Return HTML using p, ul, li, and strong; no wrapper or scripts.
Results: {{ previewJson }}
`,
}, reasoningConfig);
```

`withTemplate` renders the template to generate the prompt. The generator returns HTML in `text`.

### Use regular code instead of AI for routine work

Use regular code instead of AI for calculations, sorting, number formatting, and page layout. Code can repeat these jobs quickly and consistently. Let the model decide what to show, let the database calculate the values, and let templates put them on the page.

Our [`database.getSchemaMetadata()`](src/Database.ts) reads table names, column types, relationships, and row counts from SQLite. It also finds value ranges and a few sample values to help the model understand the data. Casai's `Template` turns that metadata into a compact [schema summary](src/templates/schema-summary.txt), without a model call:

```typescript
const schemaSummaryTemplate = create.Template.loadsTemplate({
  loader, template: 'schema-summary.txt',
});
// Read once; later tasks select from this metadata.
const metadata = database.getSchemaMetadata();
const fullSchemaSummary = await schemaSummaryTemplate(metadata);
const schemaMetadataForTables = createSchemaMetadataForTables(metadata);
```

`createSchemaMetadataForTables(metadata)` creates a helper that selects from the metadata already read from SQLite. Calling `schemaMetadataForTables(['Teams'])` keeps that table's columns, relationships, row count, and value ranges or samples. Names are matched without regard to case. If none match, it returns the full schema. No further database queries are needed.

Functions supplied through `context` can be called from a template. Our [`formatMetric`](src/metric.ts) applies the metric's currency, decimal limit, and suffix to its raw value. For example, a value of `1250` with currency `USD` can be displayed as `$1,250.00`. The `| escape` filter turns special characters into safe HTML text. The [dashboard template](src/templates/dashboard-template.html) uses the same approach for the whole page:

```typescript
const metricTemplate = create.Template({
  context: { formatMetric }, // Expose the formatter to the template.
  template: '<div class="metric-value">{{ formatMetric(metric) | escape }}</div>',
});
const metricHtml = await metricTemplate({ metric: rows[0] });

const dashboardTemplate = create.Template.loadsTemplate({
  loader, template: 'dashboard-template.html', context: { formatMetric },
});
```

`dashboardTemplate` loops through the finished cards, adds their shared layout, titles, and descriptions, and inserts their content. These repeated parts are written once in a template, saving the model from generating them for every card.

### Define and check the output

Tell the model what to return, then check it before using it. If the next step expects JSON with `html` and `script`, require those fields and check that they contain text. This catches missing fields and wrong data types. Check the calculation too: a query can run successfully and still answer the wrong question.

Zod lets us define these checks in code. Casai's `ObjectGenerator` uses them and returns the answer in `object`. The [renderer prompt](src/templates/element-renderer.md) tells it how to build a card from a result preview:

```typescript
const renderedSchema = z.object({
  html: z.string(),
  script: z.string(),
});
const elementRenderer = create.ObjectGenerator.loadsTemplate({
  loader, prompt: 'element-renderer.md', schema: renderedSchema,
}, fastConfig);
// Validate the generated fields against renderedSchema.
const { object: renderedCard } = await elementRenderer({ element });
```

`renderedCard` contains the card's HTML body and JavaScript in checked fields. We also check plans. Our [`database.executeSql`](src/Database.ts) runs the query and returns rows as objects. For metrics, it checks that there is exactly one row with a `value` field and valid formatting options. Query or validation errors go to the repair step.

### Minimize context for each task

Give each task only the information it needs. SQL generation needs the relevant tables and columns. A chart renderer needs a few rows to see the data's format. An insight needs enough data to support its conclusions. Smaller, focused prompts use fewer tokens, cost less, and are easier for simpler models to handle. Keep important details, such as how the tables connect.

Each planner lists the tables a card needs in `requiredTables`, including tables needed for joins. The helper selects their metadata for the [SQL generator](src/templates/sql-generator.md):

```typescript
const { text: sql } = await sqlFromRequestGenerator({
  ...element,
  schemaSummary: await schemaSummaryTemplate(
    // Include only this card's tables, including those needed for joins.
    schemaMetadataForTables(element.requiredTables)
  ),
});
```

Our planners see a short summary of the database structure. SQL prompts usually include only the needed tables. Our [`generatePreviewJson`](src/index.ts) takes the first few query rows, converts them to JSON, and adds a note saying how many rows were omitted. Rendering gets up to five rows to see the field names and value types; insights get up to 25 rows to support their conclusions. The full query results are passed to the page separately.

### Keep generated output short

Ask for what the next step needs. For SQL, that is the query. For a chart, it is the chart's HTML and JavaScript. Leave out explanations, repeated data, and page markup that a template already provides. Shorter answers use fewer tokens and take less time to generate.

The [page template](src/templates/dashboard-template.html) stores full query results under the card's ID when its JavaScript needs them. Generated JavaScript calls `getData(id)` to retrieve those rows and uses shared helpers to format numbers, currencies, and percentages. The model only needs to write the card's markup and logic. These instructions from the [renderer prompt](src/templates/element-renderer.md) keep its output short:

```text
Return JSON with html (one body fragment) and script (raw JavaScript).
The page supplies the wrapper, title, description, and Chart.js 4.
Use getData("<id>") and the page's formatting helpers.
Do not repeat data, redefine helpers, or add script tags.
```

The SQL prompt asks for one SELECT. The [insight prompt](src/templates/text-insight-generator.md) asks for three to five brief takeaways supported by the result excerpt, using a small set of HTML tags. Neither needs a separate explanation or a full page.

### Run independent work concurrently

If two tasks don't need each other's results, run them at the same time. Three calls that each take four seconds take about twelve seconds in a row, or about four seconds together. Keep dependent steps in order: a chart needs its query results first. You still pay for all three calls. Model services may limit how many requests can run at once.

Our three planners work independently, choosing [the header and metrics](src/templates/header-metric-planner.md), [charts and tables](src/templates/visual-planner.md), and [insights and guide text](src/templates/insight-text-planner.md).

A Casai `Script` exposes these components as functions through its `context`. In [Cascada](https://github.com/geleto/cascada/blob/master/docs/cascada/script.md#cascadas-execution-model), `var` names a result. These calls start together because none uses another's result:

```cascada
// Cascada starts these independent calls together.
var headerPlan = headerMetricPlanner({ fullSchemaSummary: fullSchemaSummary })
var visualPlan = visualPlanner({ fullSchemaSummary: fullSchemaSummary })
var insightPlan = insightTextPlanner({ fullSchemaSummary: fullSchemaSummary })
```

Cascada automatically waits when a step needs an earlier result. Separate cards can run together, while each card's rendering waits for its query results.

### Stream results and process them as they arrive

Stream complete work items and start processing each as it arrives. A planner can emit the first card while still planning the rest, allowing planning, querying, and rendering to overlap.

Our planners use Casai's `ObjectStreamer` with `output: 'array'`. Its `schema` describes each card, and its `elementStream` supplies complete cards as they are generated. Here, [`schemas.visualElement`](src/types.ts) requires a chart or table plan with a title, a description of the data to fetch, and the required table names:

```typescript
const visualPlanner = create.ObjectStreamer.loadsTemplate({
  loader, prompt: 'visual-planner.md', context: input,
  output: 'array', // Stream individual cards through elementStream.
  schema: schemas.visualElement,
}, reasoningConfig);
```

The other two planners use the same setup with their own prompts and schemas. The `visualPlan` result from the previous example gives us its stream through `elementStream`.

The `for` loop below reads each card as it arrives, and its iterations can run concurrently. Our [`processElement`](src/orchestrator.cas) selects the card's schema, generates and runs its query when data is needed, repairs failures, and builds its content. It returns the plan with the finished content attached.

Here, `data` creates an ordered collection: `push` adds a result, and `snapshot()` waits for all results before returning them.

```cascada
var chartsTables = visualPlan.elementStream
data processedElements = []
for element in chartsTables
  // Process cards concurrently as they arrive.
  processedElements.push(processElement(element))
endfor
return processedElements.snapshot() // Wait for all cards; keep plan order.
```

Cards stay in plan order even when they finish in a different order. The next sections show repairs and handling for other card types.

### Fix failed tasks with retries

Limited retries let you start with a simpler model and use a stronger model for repairs. Give the stronger model the failed output and feedback about what went wrong. Retry only the failed task, so you spend extra effort only on failures. Set a retry limit to control time and cost. If the task still fails, show the error and keep the parts that worked.

Our SQL drafts use `fastConfig`, with reasoning set to `none`. For repairs, `reasoningConfig` uses the same model with reasoning set to `low`. Its [repair prompt](src/templates/sql-repair-generator.md) includes the failed query and the database's error message, or a note that no rows were returned:

```typescript
// Use more reasoning for repair attempts.
const sqlRepairGenerator = create.TextGenerator.loadsTemplate({
  loader, prompt: 'sql-repair-generator.md', context: input,
}, reasoningConfig);
```

Cascada makes a failed call's error available as a value. `rows is error` checks for failure, and `rows#description` reads the error message. The inline `a if condition else b` expression chooses which feedback to send. This `while` loop allows two repairs. The second attempt gets the full schema in case the original plan missed a needed table:

```cascada
var repairAttempts = 0
// Retry errors or empty results, up to twice.
while repairAttempts < 2 and (rows is error or rows.length == 0)
  repairAttempts = repairAttempts + 1
  if repairAttempts == 2
    // The original plan may have missed a needed table.
    element.schemaSummary = fullSchemaSummary
  endif
  sql = sqlRepairGenerator({
    element: element, previousSql: sql,
    failureReason: rows#description if rows is error else "The query returned zero rows.",
    repairAttempt: repairAttempts
  }).text
  rows = database.executeSql(sql, element.type)
endwhile
```

If both repairs fail, return the card with an error message so the page can display it:

```cascada
if rows is error or rows.length == 0
  element.queryError = rows#description if rows is error else "The query returned zero rows."
  return element // Let the page display this card's error.
endif
```

The page template checks `queryError` and displays a "Data unavailable" card with that message. Other cards keep running.

### Remove unnecessary model calls

Skip a model call when you already have what you need. A metric value can go straight into a template. A model writing an insight can return HTML directly, saving a second call to format it. Static text needs no database query. Fewer calls mean less waiting and fewer tokens to pay for.

The script chooses the calls each element needs. The [insight prompt](src/templates/text-insight-generator.md) asks for HTML directly, so we need only a text generator:

```typescript
const textInsightGenerator = create.TextGenerator.loadsTemplate({
  loader, prompt: 'text-insight-generator.md', context: input,
}, reasoningConfig);
```

The `if`, `elif`, and `else` branches choose the calls for each card type:

```cascada
if element.type == "metric"
  element.metric = rows[0] // Let the page template format the metric.
elif element.type == "insight"
  element.previewJson = generatePreviewJson(rows, 25)
  element.contentHtml = textInsightGenerator(element).text // Generate HTML in one call.
else
  // Generate markup and any JavaScript for other card types.
  var rendered = elementRenderer({ element: element }).object
  element.html = rendered.html
  element.script = rendered.script.trim()
endif
```

Metrics go into the shared page template; insights are already HTML. In the full script, the query and repair steps run only when `element.usesData` is true, so headers and guide text skip them.

### Cache reusable work: static first, dynamic last

Put unchanging instructions, reference material, and tool definitions first. Put changing questions, data, and timestamps last. Prompt caching can then reuse the static part even when later content changes, reducing input processing time and cost.

Our [SQL prompt](src/templates/sql-generator.md) follows this order: reusable rules first, then the dataset description, schema, and data request.

We add a cache key to the shared configuration:

```typescript
const cachedFastConfig = create.Config({
  providerOptions: {
    openai: {
      reasoningEffort: 'none',
      promptCacheKey: 'smart-db-dashboard', // Keep this key stable across runs.
    },
  },
}, fastConfig);
```

Pass this configuration to the SQL and rendering components. Enable any required cache controls and check cache usage in the logs. Caching settings vary by provider.

We also reuse the downloaded SQLite file. Within a run, we read the database structure once and share it across tasks.
