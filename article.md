# Cheap, Fast, Concurrent: AI Agents on a Budget

> **Preliminary draft:** This article is a work in progress.

We built [Smart DB Dashboard](https://github.com/geleto/smart-db-dashboard), an AI agent that turns a SQLite database and a question in plain English into an interactive dashboard with metrics, charts, tables, and insights. It plans the content, queries the data, and generates the page in **under 15 seconds** for **less than half a US cent ($0.005)** in estimated model cost. This article explains the methods behind that speed and efficiency.

The reported timing and cost assume warm caches. Run the dashboard several times first.

Here are four example dashboards, with their datasets and the requests used to generate them:

| Dashboard | Dataset | User request |
| --- | --- | --- |
| [Baseball team performance across eras](https://geleto.github.io/smart-db-dashboard/examples/baseball-performance.html) | **Lahman**: historical baseball statistics from 1871 to 2022, including teams, players, batting, pitching, and postseason records. | "Explore how baseball team performance changed across eras, including wins, scoring, pitching, and standout seasons." |
| [Music catalog performance](https://geleto.github.io/smart-db-dashboard/examples/catalog-performance.html) | **Chinook**: a sample music store database with artists, albums, tracks, genres, customers, and sales invoices. | "Analyze our catalog performance by genre, artist, album, and track so we can prioritize content and promotion decisions." |
| [Film catalog demand](https://geleto.github.io/smart-db-dashboard/examples/film-demand.html) | **Sakila**: a sample DVD rental store database with films, actors, categories, inventory, customers, rentals, and payments. | "Analyze film catalog demand by category, rating, rental duration, replacement cost, actors, and store inventory to identify notable viewing patterns." |
| [Taxonomic coverage](https://geleto.github.io/smart-db-dashboard/examples/taxonomic-coverage.html) | **ITIS**: a taxonomy database with scientific and common names, ranks, hierarchy records, and synonyms across animals, plants, fungi, and microbes. | "Explore taxonomic coverage across kingdoms, ranks, major groups, and hierarchy depth to understand what kinds of organisms are represented." |

## How it works

1. Prepare the SQLite database and read its schema.
2. Start three planners concurrently, each streaming its planned cards: headers and metrics, charts and tables, and insights and text.
3. Process cards concurrently as they arrive: query their data, repair failures, and build their content.
4. Arrange the cards and save the HTML page.

## How we make it fast and efficient

We don't give a strong model tools, such as listing tables and running SQL, and let it work in a loop until the dashboard is done. That would work, but it would use many more tokens, at a higher price per token. Each turn sends the growing conversation back to the model, so the schema, queries, and results are paid for again and again, and each step waits for the one before it.

Instead, code sets the order of the steps, and the model makes only the decisions that need judgment: what to show, how to query it, how to chart it, and what the results mean. Each decision is a small, separate call to a fast, inexpensive model, with only the context that job needs. Independent calls run at the same time. Code does the rest: running queries, formatting values, and laying out the page.

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

The examples and numbers come from the Lahman baseball dashboard.

We introduce the model settings and Casai components first, then show that workflow. The snippets reuse the project's setup: `loader` reads files, `input` holds the dataset details and user request, and `database` accesses SQLite. Prompt links lead to the full instructions.

### Match the model to the task

We use one inexpensive model, [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) ($0.10 per million input tokens, $0.50 per million output tokens), at two reasoning levels: `none` for SQL drafts and rendering, and `low` for planning, repairs, and insights. Drafting a query needs less thought than planning a dashboard or fixing a broken query. Test settings like these on real requests and compare time, cost, and results, including retries.

Casai's `Config` lets tasks share settings:

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

Our dashboard splits the work into seven tasks, each with one clear job:

- **Plan the content:** choose metrics, charts, tables, and insights.
- **Write queries:** generate SQL for each item that needs data.
- **Run queries:** fetch the data from SQLite.
- **Repair queries:** fix SQL that fails or returns no data.
- **Write insights:** explain what the results show.
- **Render cards:** format metrics and build charts and tables.
- **Assemble the page:** combine the cards into the dashboard.

Running queries and assembling the page need no model. Each of the other tasks gets a short prompt, can be checked on its own, and can be retried without starting over. Every model call costs time and money, so split the work only where it helps.

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

Prompts are Cascada templates: the values passed when a component is called, such as a card's `dataRequest`, fill in their placeholders.

Each task in our dashboard is its own component. A `Script` connects them: its `context` makes the components available to our [orchestrator script](src/orchestrator.cas), along with plain functions that need no model. The script calls them like functions, and its `schema` checks the finished cards:

```typescript
const dashboardProcessor = create.Script.loadsScript({
  loader, script: 'orchestrator.cas',
  context: {
    headerMetricPlanner, visualPlanner, insightTextPlanner,
    sqlFromRequestGenerator, sqlRepairGenerator,
    textInsightGenerator, elementRenderer,
    // Regular code: no model calls.
    schemaSummaryTemplate, generatePreviewJson,
  },
  schema: schemas.processedDashboard, // Check the script's result.
});
// Pass this run's database and schema details.
const cards = await dashboardProcessor({
  database, fullSchemaSummary, schemaMetadataForTables,
});
```

The sections below define these components and show the parts of the script that use them.

### Use regular code instead of AI for routine work

In our dashboard, the model decides what to show, SQLite calculates the values, and templates put them on the page. Reading the schema, formatting numbers, and laying out the cards are done in code, which is fast, consistent, and uses no tokens.

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

Our card renderer must return JSON with two text fields, `html` and `script`. A metric query must return exactly one row with a `value` field. We check both before using them, which catches missing fields and wrong data types before they reach the page.

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

`renderedCard` contains the card's HTML body and JavaScript in checked fields. The planners' cards are checked the same way. For metrics, [`database.executeSql`](src/Database.ts) checks the single row and its formatting options. Query or validation errors go to the repair step.

### Minimize context for each task

Each task gets only what it needs. Rendering gets up to 5 result rows, enough to see the field names and value types; insights get up to 25, enough to support their conclusions. The full results go to the page without passing through the model. SQL prompts include only the tables the card uses: in our test runs, they were about 1,100–1,300 tokens, while the full schema alone is about 6,000. Smaller prompts cost less and are easier for simpler models to handle, as long as they keep the details that matter, such as how the tables connect.

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

The planners see the full schema summary, since they choose what to show. [`generatePreviewJson`](src/index.ts) takes the first rows of a result, converts them to JSON, and notes how many rows were omitted.

### Keep generated output short

Ask only for what the next step needs. The [SQL prompt](src/templates/sql-generator.md) asks for one SELECT with no explanation, so a draft is usually under 150 tokens. The renderer returns only a chart's markup and code, with no data, wrapper, or title, and that still comes to about 700–800 tokens. Output tokens cost five times as much as input tokens on GPT-6 Luna, and they set the pace: in our test runs, chart renders took 5–7 seconds, SQL drafts 1–4.

The [page template](src/templates/dashboard-template.html) stores full query results under the card's ID when its JavaScript needs them. Generated JavaScript calls `getData(id)` to retrieve those rows and uses shared helpers to format numbers, currencies, and percentages. The model only needs to write the card's markup and logic. These instructions from the [renderer prompt](src/templates/element-renderer.md) keep its output short:

```text
Return JSON with html (one body fragment) and script (raw JavaScript).
The page supplies the wrapper, title, description, and Chart.js 4.
Use getData("<id>") and the page's formatting helpers.
Do not repeat data, redefine helpers, or add script tags.
```

The [insight prompt](src/templates/text-insight-generator.md) likewise asks only for three to five brief takeaways supported by the result excerpt, using a small set of HTML tags.

### Run independent work concurrently

Run tasks at the same time when they don't need each other's results. In our test runs, a dashboard made about 20 model calls, with up to 14 running at once: about a minute of model time finished in about 12 seconds. Dependent steps still run in order: a chart needs its query results first. Running calls together saves time, not money, and model services may limit how many requests can run at once.

Our three planners work independently, choosing [the header and metrics](src/templates/header-metric-planner.md), [charts and tables](src/templates/visual-planner.md), and [insights and guide text](src/templates/insight-text-planner.md).

The `dashboardProcessor` script calls these planners through its `context`. In [Cascada](https://github.com/geleto/cascada/blob/master/docs/cascada/script.md#cascadas-execution-model), `var` names a result. These calls start together because none uses another's result:

```cascada
// Cascada starts these independent calls together.
var headerPlan = headerMetricPlanner({ fullSchemaSummary: fullSchemaSummary })
var visualPlan = visualPlanner({ fullSchemaSummary: fullSchemaSummary })
var insightPlan = insightTextPlanner({ fullSchemaSummary: fullSchemaSummary })
```

Cascada automatically waits when a step needs an earlier result. Separate cards can run together, while each card's rendering waits for its query results.

### Stream results and process them as they arrive

Our planners stream their cards, and each card starts processing as soon as it arrives, so planning, querying, and rendering overlap. In one test run, five SQL and rendering calls started before the first planner finished, and 12 of the 13 started before the last one did.

They use Casai's `ObjectStreamer` with `output: 'array'`. Its `schema` describes each card, and its `elementStream` supplies complete cards as they are generated. Here, [`schemas.visualElement`](src/types.ts) requires a chart or table plan with a title, a description of the data to fetch, and the required table names:

```typescript
const visualPlanner = create.ObjectStreamer.withTemplate({
  prompt: 'User request: {{ userRequest }}', context: input,
  output: 'array', // Stream individual cards through elementStream.
  schema: schemas.visualElement,
}, reasoningConfig);
```

The prompt is only the user's request. The planner's [instructions](src/templates/visual-planner.md) and the schema are sent before it, as the caching section explains. The other two planners use the same setup with their own instructions and schemas. The `visualPlan` result from the previous example gives us its stream through `elementStream`.

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

Our SQL drafts use `fastConfig`, with no reasoning. If a draft fails or returns no rows, a repair step retries it with `reasoningConfig`, at most twice. The extra reasoning is spent only on queries that need it; using a stronger model for repairs works the same way. The [repair prompt](src/templates/sql-repair-generator.md) includes the failed query and the database's error message, or a note that no rows were returned:

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

Each card type gets only the calls it needs. Metrics skip the render call: their query returns the value and formatting options, and the page template displays them. Insights skip it too, because the insight writer returns HTML directly. Headers and guide text skip the query. In one test run with 10 cards, giving every card a query and a render call would have taken 20 calls; ours took 15.

The [insight prompt](src/templates/text-insight-generator.md) asks for HTML directly, so we need only a text generator:

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

In the full script, the query and repair steps run only when `element.usesData` is true.

### Cache reusable work: static first, dynamic last

Put unchanging instructions, reference material, and tool definitions first. Put changing questions, data, and timestamps last. Prompt caching can then reuse the static part even when later content changes, reducing input cost and sometimes processing time.

Check your provider's rules. OpenAI's newer models, including GPT-6 Luna, [cache](https://developers.openai.com/api/docs/guides/prompt-caching) only prompts of at least 1,024 tokens. They look for a match only at the end of a message or at an explicit breakpoint, and keep a cached prompt for at least 30 minutes after its last use. Reading cached input costs a tenth of the normal input price, but writing it costs 1.25 times as much. Caching pays off only when the same text is sent again.

Our planner prompts are the reusable part. Each is about 6,500 tokens: the planner's instructions, the dataset description, and the full schema summary, followed by the user's request. Everything before the request is the same for every question about the same database, so we end that part with a breakpoint. The prompts for SQL, rendering, and insights are about 1,000–1,500 tokens and differ for every card. The instructions they share are under 1,024 tokens, too short to cache even with a breakpoint.

Calling a Casai component with a message array and a context puts those messages before its own prompt. This helper sends a planner's instructions and the schema that way, as a message that ends in a breakpoint. The script's `context` gets `cachePrefix(visualPlanner, 'visual-planner.md')` in place of `visualPlanner`, so the script calls it the same way:

```typescript
const cacheBreakpoint = { openai: { promptCacheBreakpoint: { mode: 'explicit' } } };

function cachePrefix(planner, template) {
  const instructions = create.Template.loadsTemplate({ loader, template, context: input });
  // The static part goes first, in its own message, ending in a breakpoint.
  return async (context) => planner([{
    role: 'user',
    content: [{ type: 'text', text: await instructions(context), providerOptions: cacheBreakpoint }],
  }], context);
}
```

Our logs show the effect across two different questions about the Lahman database (simplified):

```text
Team eras, visual planner:      6,589 tokens in, 0 cache read + 6,586 cache write
Player careers, visual planner: 6,593 tokens in, 6,559 cache read + 31 cache write
Player careers, SQL draft:      1,338 tokens in, 0 cache read + 1,335 cache write
```

For the second question, only the request itself was new. The three planner calls cost about $0.003 with nothing cached and about $0.0008 with the shared part cached. That saves roughly $0.002 on every run against a database used in the last 30 minutes, whatever the question. The planner calls took about as long either way, because most of their time goes to writing the plan, so caching saves money rather than time here.

We also reuse the downloaded SQLite file. Within a run, we read the database structure once and share it across tasks.
