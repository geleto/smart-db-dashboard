/**
 * Turn a plain-English SQLite question into an interactive dashboard.
 * Three planners stream cards concurrently; orchestrator.cas fetches their data
 * with cheap SQL drafts and stronger-model repairs. Metrics use shared markup,
 * insights produce HTML directly, and other cards get generated HTML/JS.
 * This file wires the generators and composes, saves, and opens the final page.
 */

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { basicModel, advancedModel, basicProviderOptions, advancedProviderOptions } from './setup';
import { printModelStatsSummary } from './model-logging';
import { create, FileSystemLoader } from 'casai';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { createSchemaMetadataForTables, Database } from './Database';
import { schemas } from './types';
import type { types } from './types';
import { formatMetric } from './metric';
import { listScenarios, selectScenario } from './scenarios';

import inputJson from './input.json';
const inputFile: types.PlanningInputFile = inputJson;
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--list') {
	console.log(listScenarios(inputFile));
	process.exit(0);
}
let selection: ReturnType<typeof selectScenario>;
try {
	selection = selectScenario(inputFile, args);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
const { key: scenarioKey, scenario: input } = selection;

const BASE_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_HTML = path.join(BASE_DIR, 'dashboard.html');
const templateLoader = new FileSystemLoader(fileURLToPath(new URL('./templates', import.meta.url)));
const scriptLoader = new FileSystemLoader(BASE_DIR);

function openInBrowser(url: string): void {
	const command = process.platform === 'win32'
		? 'cmd'
		: process.platform === 'darwin' ? 'open' : 'xdg-open';
	const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
	const child = spawn(command, args, {
		detached: true, stdio: 'ignore', windowsHide: true,
	});
	child.on('error', (error) => {
		console.warn(`Could not open dashboard automatically: ${error.message}`);
	});
	child.unref();
}

const layoutPriority = {
	header: 0, metric: 1, chart: 2, table: 3, insight: 4, text: 5, other: 6,
};

function columnClass(element: types.ProcessedElement, metricIndex: number, metricCount: number, contentIndex: number, contentCount: number): string {
	const isLastOddContentItem = element.type != 'metric' && contentIndex == contentCount - 1 && (contentCount - 1) % 2 == 1;
	const isFullWidth = element.type == 'header' || (element.type != 'metric' && (contentIndex == 0 || isLastOddContentItem));
	const isHalfWidth = element.type != 'metric' || metricCount == 2 || metricCount == 4 || (metricCount == 5 && metricIndex < 2);
	if (isFullWidth) return 'col-12';
	if (isHalfWidth) return 'col-12 col-md-6';
	return metricCount > 5 ? 'col-12 col-md-6 col-xl-4' : 'col-12 col-md-4';
}

function layoutElements(elements: types.ProcessedElement[]): types.LayoutElement[] {
	const metricCount = elements.filter(element => element.type == 'metric').length;
	const contentCount = elements.filter(element => element.type != 'header' && element.type != 'metric').length;
	let metricIndex = 0, contentIndex = 0;
	return [...elements]
		.sort((a, b) => layoutPriority[a.type] - layoutPriority[b.type])
		.map(element => {
			const column = columnClass(element, metricIndex, metricCount, contentIndex, contentCount);
			if (element.type == 'metric') metricIndex++;
			else if (element.type != 'header') contentIndex++;
			return {
				...element,
				columnClass: column,
			};
		});
}

function normalizeElementId(element: types.ProcessedElement): string {
	return `${element.type}-${element.id}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

// ---------------------------------------------------------------------------
// Planner LLMs - stream independent sections of the dashboard plan.
// ---------------------------------------------------------------------------
const plannerConfig = create.Config({
	model: advancedModel,
	providerOptions: advancedProviderOptions,
	loader: templateLoader,
	output: 'array',
	context: input,
});

const headerMetricPlanner = create.ObjectStreamer.loadsTemplate({
	prompt: 'header-metric-planner.md',
	schema: schemas.headerMetricElement,
}, plannerConfig);

const visualPlanner = create.ObjectStreamer.loadsTemplate({
	prompt: 'visual-planner.md',
	schema: schemas.visualElement,
}, plannerConfig);

const insightTextPlanner = create.ObjectStreamer.loadsTemplate({
	prompt: 'insight-text-planner.md',
	schema: schemas.insightTextElement,
}, plannerConfig);

// ---------------------------------------------------------------------------
// SQL generator - tries a cheap first draft, then repairs with the advanced model if needed.
// ---------------------------------------------------------------------------
const sqlFromRequestGenerator = create.TextGenerator.loadsTemplate({
	model: basicModel,
	providerOptions: basicProviderOptions,
	loader: templateLoader,
	prompt: 'sql-generator.md',
	context: input,
});

const sqlRepairGenerator = create.TextGenerator.loadsTemplate({
	model: advancedModel,
	providerOptions: advancedProviderOptions,
	loader: templateLoader,
	prompt: 'sql-repair-generator.md',
	context: input,
});

// ---------------------------------------------------------------------------
// Insight generator - turns query results into data-backed HTML text.
// ---------------------------------------------------------------------------
const textInsightGenerator = create.TextGenerator.loadsTemplate({
	model: advancedModel,
	providerOptions: advancedProviderOptions,
	loader: templateLoader,
	prompt: 'text-insight-generator.md',
	context: input,
});

// ---------------------------------------------------------------------------
// Element renderer - renders content into HTML and JS; the page supplies card markup.
// ---------------------------------------------------------------------------
const elementRenderer = create.ObjectGenerator.loadsTemplate({
	model: basicModel,
	providerOptions: basicProviderOptions,
	loader: templateLoader,
	prompt: 'element-renderer.md',
	output: 'object',
	schema: schemas.renderedElement,
});

// ---------------------------------------------------------------------------
// Templates - wrap the dashboard and summarize the DB schema.
// ---------------------------------------------------------------------------
const dashboardTemplate = create.Template.loadsTemplate({
	loader: templateLoader,
	template: 'dashboard-template.html',
	context: { formatMetric },
});

const schemaSummaryTemplate = create.Template.loadsTemplate({
	loader: templateLoader,
	template: 'schema-summary.txt',
});

// ---------------------------------------------------------------------------
// Dashboard processor - plans sections in parallel, fetches data, and renders cards.
// ---------------------------------------------------------------------------
const dashboardProcessor = create.Script.loadsScript({
	loader: scriptLoader,
	context: {
		headerMetricPlanner,
		visualPlanner,
		insightTextPlanner,
		sqlFromRequestGenerator,
		sqlRepairGenerator,
		textInsightGenerator,
		elementRenderer,
		schemaSummaryTemplate,
		generatePreviewJson: (rows: unknown[], rowLimit = 5) => {
			const json = JSON.stringify(rows.slice(0, rowLimit), null, 2);
			return rows.length > rowLimit ? `${json}\n... ${rows.length - rowLimit} more rows` : json;
		},
		toJson: (value: unknown) => JSON.stringify(value, null, 2),
		normalizeElementId,
	},
	schema: schemas.processedDashboard,
	script: 'orchestrator.cas'
});

console.log('SMART DB DASHBOARD\nCreates a data dashboard by first planning the layout and data requirements, then executing that plan.\n');
console.log(`Scenario "${scenarioKey}": ${input.name}`);
console.log(`User request: ${input.userRequest}\n Dataset: ${input.datasetName}`);

// 1. Initialize database
const database = new Database(input.datasetName, input.datasetDescription, input.databaseUrl);
try {
	// 2. Prepare the local file, then time SQLite opening and generation.
	await database.prepare();
	const generationStartedAt = performance.now();
	database.open();

	// 3. Extract schema summary
	const schemaMetadata = database.getSchemaMetadata();
	const fullSchemaSummary = await schemaSummaryTemplate(schemaMetadata);
	const schemaMetadataForTables = createSchemaMetadataForTables(schemaMetadata);
	console.log(`\n=== Schema Summary ===\n${fullSchemaSummary}`);

	// 4. Plan sections, fetch data, generate insights, and render each card
	console.log('\nRunning planner sections and processing elements...\n');
	const elements = await dashboardProcessor({ database, fullSchemaSummary, schemaMetadataForTables });
	if (elements[0]?.type != 'header') {
		throw new Error('Planner must return a header element first.');
	}
	console.log(`\nPlanner returned and processed ${elements.length} elements.`);

	// 6. Log a compact plan summary
	console.log('\n=== DASHBOARD PLAN ===');
	for (const element of elements) {
		console.log(`${element.type}: ${element.title}`);
	}

	// 7. Compose final dashboard body
	console.log('\nComposing dashboard...\n');

	// 8. Wrap, save, and open final HTML
	const finalHtml = await dashboardTemplate({
		elements: layoutElements(elements),
	});
	writeFileSync(OUTPUT_HTML, finalHtml, 'utf-8');
	const dashboardUrl = pathToFileURL(OUTPUT_HTML).href;
	console.log('\nDashboard written to:', OUTPUT_HTML);
	console.log('Dashboard URL:', dashboardUrl);

	console.log('\n--- Dashboard generation complete ---');
	console.log(`Generated dashboard: ${dashboardUrl}`);
	printModelStatsSummary(performance.now() - generationStartedAt);
	openInBrowser(dashboardUrl);

} catch (error) {
	process.exitCode = 1;
	console.error('Dashboard generation failed:', error);
} finally {
	database.close();
}
