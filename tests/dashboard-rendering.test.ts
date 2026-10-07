import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { create, FileSystemLoader } from 'casai';
import Sqlite from 'better-sqlite3';
import { Database } from '../src/Database.ts';
import { formatMetric } from '../src/metric.ts';
import { schemas } from '../src/types.ts';
import type { types } from '../src/types.ts';

const contentHtml = '<ul><li><strong>North</strong> leads revenue.</li><li>Compare basket sizes & sales counts.</li></ul>';
const rows = [{ region: 'North', revenue: 400 }];

for (const outcome of ['success', 'failure', 'empty']) {
	test(`insight ${outcome === 'success' ? 'generation skips rendering' : `${outcome} query keeps the error card`}`, async () => {
		const calls = { sql: 0, repair: 0, insight: 0, render: 0 };
		const processor = create.Script.loadsScript({
			loader: new FileSystemLoader(fileURLToPath(new URL('../src', import.meta.url))),
			script: 'orchestrator.cas', schema: schemas.processedDashboard,
			context: {
				headerMetricPlanner: () => ({ elementStream: [] }),
				visualPlanner: () => ({ elementStream: [] }),
				insightTextPlanner: () => ({ elementStream: [{
					id: 'regional-revenue', type: 'insight', title: 'Regional revenue', description: 'Ranked evidence.',
					usesData: true, dataRequest: 'Rank regions by revenue.', requiredTables: ['sales'],
				}] }),
				sqlFromRequestGenerator: (element: { schemaSummary: string }) => {
					calls.sql++;
					assert.equal(element.schemaSummary, 'sales: region, revenue');
					return { text: 'SELECT region, revenue FROM sales' };
				},
				sqlRepairGenerator: ({ element, repairAttempt, failureReason }: { element: { schemaSummary: string }; repairAttempt: number; failureReason: string }) => {
					calls.repair++;
					assert.equal(element.schemaSummary, repairAttempt === 2 ? 'sales: region, revenue; customers: id' : 'sales: region, revenue');
					assert.equal(failureReason, outcome === 'failure' ? 'no such column: revenue' : 'The query returned zero rows.');
					return { text: 'SELECT region, revenue FROM sales' };
				},
				textInsightGenerator: (element: types.ProcessedElement) => {
					calls.insight++;
					assert.equal(element.title, 'Regional revenue');
					assert.equal(element.dataRequest, 'Rank regions by revenue.');
					assert.equal(element.previewJson, JSON.stringify(rows));
					return { text: contentHtml };
				},
				elementRenderer: () => { calls.render++; assert.fail('Insight HTML must not be rendered twice'); },
				database: { executeSql: () => {
					if (outcome === 'failure') throw new Error('no such column: revenue');
					return outcome === 'success' ? rows : [];
				} },
				schemaMetadataForTables: () => ({}), schemaSummaryTemplate: () => 'sales: region, revenue',
				generatePreviewJson: JSON.stringify, toJson: JSON.stringify,
				normalizeElementId: (element: types.ProcessedElement) => `${element.type}-${element.id}`,
				fullSchemaSummary: 'sales: region, revenue; customers: id',
			},
		});
		const [element] = await processor({});
		assert.equal(element.id, 'insight-regional-revenue');
		assert.equal(element.html, undefined);
		assert.equal(element.script, undefined);
		if (outcome === 'success') {
			assert.deepEqual(calls, { sql: 1, repair: 0, insight: 1, render: 0 });
			assert.equal(element.contentHtml, contentHtml);
			assert.equal(element.dataJson, undefined);
			assert.equal(element.previewJson, JSON.stringify(rows));
			assert.equal(element.queryError, undefined);
		} else {
			assert.deepEqual(calls, { sql: 1, repair: 2, insight: 0, render: 0 });
			assert.equal(element.queryError, outcome === 'failure' ? 'no such column: revenue' : 'The query returned zero rows.');
			assert.equal(element.contentHtml, undefined);
		}
	});
}

test('the page wraps card content once, escapes headings, and preserves insight HTML', async () => {
	const element = (type: types.LayoutElement['type'], title: string, extra: Partial<types.LayoutElement> = {}): types.LayoutElement => ({
		id: `${type}-test`, type, title, description: 'Description <after> fees & adjustments',
		usesData: false, dataRequest: '', requiredTables: [], columnClass: 'col-12', ...extra,
	});
	const elements = [
		element('header', 'Overview', { html: '<header><h1>Overview</h1></header>', script: '' }),
		element('metric', 'Revenue & <margin>', { metric: { value: 400, label: 'North & <West>' } }),
		element('chart', 'Regional revenue', { html: '<div style="height:300px"><canvas id="chart-test-canvas"></canvas></div>' }),
		element('table', 'Top customers', { html: '<table><tbody id="table-test-body"></tbody></table>' }),
		element('insight', 'Findings', { contentHtml }),
		element('text', 'Guide', { description: 'Use the charts to compare regions.', html: '<p>Use the charts to compare regions.</p>', script: '' }),
		element('other', 'Coverage', { html: '<p>Sales from 2025.</p>' }),
		element('insight', 'Failed query', { id: 'insight-error', queryError: 'no such column: <revenue>' }),
	];
	const template = create.Template.loadsTemplate({
		loader: new FileSystemLoader(fileURLToPath(new URL('../src/templates', import.meta.url))),
		template: 'dashboard-template.html',
		context: { formatMetric },
	});
	const html = await template({ elements });
	assert.equal((html.match(/<div class="card h-100\b/g) ?? []).length, 7);
	assert.equal((html.match(/<div class="card-body">/g) ?? []).length, 7);
	assert.equal((html.match(/Revenue &amp; &lt;margin&gt;/g) ?? []).length, 1);
	assert(html.includes('Description &lt;after&gt; fees &amp; adjustments'));
	assert.equal((html.match(/<header><h1>Overview<\/h1><\/header>/g) ?? []).length, 1);
	assert.equal(html.split(contentHtml).length - 1, 1);
	assert(html.includes('border-danger-subtle'));
	assert(html.includes('no such column: &lt;revenue&gt;'));
	assert(html.includes('card-title fw-semibold mb-1">Revenue &amp; &lt;margin&gt;</h6>'));
	assert(html.includes('card-title fw-semibold mb-1">Regional revenue</h5>'));
	assert.equal((html.match(/class="metric-value"/g) ?? []).length, 1);
	assert(html.includes('class="metric-value">400</div>'));
	assert(html.includes('class="metric-label">North &amp; &lt;West&gt;</div>'));
	assert.equal(html.split('Use the charts to compare regions.').length - 1, 1);
});

test('metric formatting preserves zero, missing values, text, precision, currency, and percentage scale', () => {
	assert.equal(formatMetric({ value: 0 }), '0');
	assert.equal(formatMetric({ value: null, suffix: '%' }), '-');
	assert.equal(formatMetric({ value: 'No records' }), 'No records');
	assert.equal(formatMetric({ value: 1220 }), new Intl.NumberFormat().format(1220));
	assert.equal(formatMetric({ value: 1.225, decimals: 2 }), new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(1.225));
	assert.equal(formatMetric({ value: 1234.5, currency: 'GBP' }), new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP' }).format(1234.5));
	assert.equal(formatMetric({ value: 12.345, decimals: 1, suffix: '%' }), new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(12.345) + '%');
});

test('the renderer receives card details and preview data without the SQL schema', async () => {
	const element = {
		id: 'table-revenue', type: 'table', title: 'Revenue', description: 'Compare regions.',
		usesData: true, dataRequest: 'Rank regional revenue.', requiredTables: ['sales'],
		rowCount: rows.length, previewJson: JSON.stringify(rows), schemaSummary: 'QUERY_ONLY_SCHEMA',
	};
	const template = create.Template.loadsTemplate({
		loader: new FileSystemLoader(fileURLToPath(new URL('../src/templates', import.meta.url))),
		template: 'element-renderer.md',
	});
	const prompt = await template({ element });
	assert(!prompt.includes(element.schemaSummary));
	const json = JSON.parse(prompt.match(/```json\s*([\s\S]*?)\s*```/)![1]);
	assert.equal(json.id, element.id);
	assert.equal(json.title, element.title);
	assert.equal(json.description, element.description);
	assert.equal(json.dataRequest, element.dataRequest);
	assert.equal(json.rowCount, element.rowCount);
	assert.equal(json.previewJson, element.previewJson);
});

test('chart rendering receives the full row count with a five-row preview', async () => {
	const chartRows = Array.from({ length: 9 }, (_, index) => ({ quantity: index + 1, revenue: (index + 1) * 100 }));
	const previewJson = JSON.stringify(chartRows.slice(0, 5));
	const rendererTemplate = create.Template.loadsTemplate({
		loader: new FileSystemLoader(fileURLToPath(new URL('../src/templates', import.meta.url))),
		template: 'element-renderer.md',
	});
	let renderCalls = 0;
	const processor = create.Script.loadsScript({
		loader: new FileSystemLoader(fileURLToPath(new URL('../src', import.meta.url))),
		script: 'orchestrator.cas', schema: schemas.processedDashboard,
		context: {
			headerMetricPlanner: () => ({ elementStream: [] }),
			visualPlanner: () => ({ elementStream: [{
				id: 'quantity-revenue', type: 'chart', title: 'Revenue by quantity', description: 'Compare revenue by order quantity.',
				usesData: true, dataRequest: 'Revenue per quantity, ordered by quantity.', requiredTables: ['sales'],
			}] }),
			insightTextPlanner: () => ({ elementStream: [] }),
			sqlFromRequestGenerator: () => ({ text: 'SELECT quantity, revenue FROM sales ORDER BY quantity' }),
			sqlRepairGenerator: () => assert.fail('The query must not need repair'),
			database: { executeSql: () => chartRows },
			schemaMetadataForTables: () => ({}), schemaSummaryTemplate: () => 'sales: quantity, revenue',
			generatePreviewJson: (data: unknown[]) => JSON.stringify(data.slice(0, 5)),
			toJson: JSON.stringify,
			normalizeElementId: (element: types.ProcessedElement) => `${element.type}-${element.id}`,
			fullSchemaSummary: 'sales: quantity, revenue',
			elementRenderer: async ({ element }: { element: types.ProcessedElement }) => {
				renderCalls++;
				assert.equal(element.rowCount, chartRows.length);
				assert.equal(element.previewJson, previewJson);
				const prompt = await rendererTemplate({ element });
				const json = JSON.parse(prompt.match(/```json\s*([\s\S]*?)\s*```/)![1]);
				assert.equal(json.rowCount, chartRows.length);
				assert.equal(json.previewJson, previewJson);
				return { object: { html: '<canvas id="quantity-revenue-canvas"></canvas>', script: 'getData("chart-quantity-revenue");' } };
			},
		},
	});
	const [element] = await processor({});
	assert.equal(renderCalls, 1);
	assert.equal(element.rowCount, chartRows.length);
	assert.equal(element.previewJson, previewJson);
	assert.deepEqual(JSON.parse(`{${element.dataJson}}`)[element.id], chartRows);
});

for (const scenario of [
	{ name: 'a record with a secondary label', sql: "SELECT 116 AS value, 'Chicago Cubs · 1906' AS label", repairs: 0, metric: { value: 116, label: 'Chicago Cubs · 1906' } },
	{ name: 'a zero without a label', sql: 'SELECT 0 AS value', repairs: 0, metric: { value: 0 } },
	{ name: 'a null aggregate', sql: 'SELECT NULL AS value', repairs: 0, metric: { value: null } },
	{ name: 'a repair after invalid SQL', sql: 'SELECT missing_column AS value', repairs: 1, metric: { value: 116 } },
	{ name: 'a second repair after invalid SQL', sql: 'SELECT missing_column AS value', repairs: 2, metric: { value: 116 } },
	{ name: 'a repair after an incorrect alias', sql: 'SELECT 116 AS wins', repairs: 1, metric: { value: 116 } },
	{ name: 'a repair after multiple rows', sql: 'SELECT 116 AS value UNION ALL SELECT 100', repairs: 1, metric: { value: 116 } },
	{ name: 'a repair after invalid formatting', sql: "SELECT 116 AS value, 'two' AS decimals", repairs: 1, metric: { value: 116 } },
	{ name: 'a repair after a misspelled context alias', sql: "SELECT 116 AS value, 'Cubs' AS team_name", repairs: 1, metric: { value: 116 } },
	{ name: 'an unrepaired invalid result', sql: 'SELECT 116 AS wins', repairs: 2, metric: undefined },
]) {
	test(`KPI processing handles ${scenario.name} without a renderer call`, async () => {
		const sqlite = new Sqlite(':memory:');
		const database = new Database('Test', 'Test database', '');
		database.getDb = () => sqlite;
		const calls = { sql: 0, repair: 0 };
		const processor = create.Script.loadsScript({
			loader: new FileSystemLoader(fileURLToPath(new URL('../src', import.meta.url))),
			script: 'orchestrator.cas', schema: schemas.processedDashboard,
			context: {
				headerMetricPlanner: () => ({ elementStream: [{
					id: 'wins', type: 'metric', title: 'Most wins', description: 'The single-season record.',
					usesData: true, dataRequest: 'Find the season wins record.', requiredTables: ['Teams'],
				}] }),
				visualPlanner: () => ({ elementStream: [] }), insightTextPlanner: () => ({ elementStream: [] }),
				sqlFromRequestGenerator: (element: { schemaSummary: string }) => {
					calls.sql++;
					assert.equal(element.schemaSummary, 'Teams: W, name, yearID');
					return { text: scenario.sql };
				},
				sqlRepairGenerator: ({ failureReason, element, repairAttempt }: { failureReason: string; element: { schemaSummary: string }; repairAttempt: number }) => {
					calls.repair++;
					assert.match(failureReason, /value|array|decimals|team_name|missing_column/i);
					assert.equal(element.schemaSummary, repairAttempt === 2 ? 'Teams: W, name, yearID; People: playerID' : 'Teams: W, name, yearID');
					return { text: scenario.metric && calls.repair >= scenario.repairs ? 'SELECT 116 AS value' : scenario.sql };
				},
				elementRenderer: () => assert.fail('KPIs must not call the renderer'),
				database,
				schemaMetadataForTables: () => ({}), schemaSummaryTemplate: () => 'Teams: W, name, yearID',
				toJson: JSON.stringify, normalizeElementId: (element: types.ProcessedElement) => `${element.type}-${element.id}`,
				fullSchemaSummary: 'Teams: W, name, yearID; People: playerID',
			},
		});
		try {
			const [element] = await processor({});
			assert.deepEqual(calls, { sql: 1, repair: scenario.repairs });
			assert.deepEqual(element.metric, scenario.metric);
			assert.equal(element.html, undefined);
			assert.equal(element.script, undefined);
			assert.equal(element.dataJson, undefined);
			assert.equal(element.previewJson, undefined);
			assert.equal(Boolean(element.queryError), !scenario.metric);
		} finally {
			database.close();
		}
	});
}

test('a failed SQL card does not prevent other streamed cards from completing', async () => {
	const sqlite = new Sqlite(':memory:');
	const database = new Database('Test', 'Test database', '');
	database.getDb = () => sqlite;
	const processor = create.Script.loadsScript({
		loader: new FileSystemLoader(fileURLToPath(new URL('../src', import.meta.url))),
		script: 'orchestrator.cas', schema: schemas.processedDashboard,
		context: {
			headerMetricPlanner: () => ({ elementStream: ['broken', 'healthy'].map(id => ({
				id, type: 'metric', title: id, description: 'A record.',
				usesData: true, dataRequest: 'Find the record.', requiredTables: [],
			})) }),
			visualPlanner: () => ({ elementStream: [] }), insightTextPlanner: () => ({ elementStream: [] }),
			sqlFromRequestGenerator: (element: types.ProcessedElement) => ({ text: element.id === 'metric-broken' ? 'SELECT missing_column AS value' : 'SELECT 0 AS value' }),
			sqlRepairGenerator: ({ previousSql }: { previousSql: string }) => ({ text: previousSql }),
			elementRenderer: () => assert.fail('KPIs must not call the renderer'),
			database, fullSchemaSummary: 'Test database.',
			schemaMetadataForTables: () => ({}), schemaSummaryTemplate: () => 'Test database.',
			normalizeElementId: (element: types.ProcessedElement) => `${element.type}-${element.id}`,
		},
	});
	try {
		const [broken, healthy] = await processor({});
		assert.equal(broken.queryError, 'no such column: missing_column');
		assert.equal(broken.metric, undefined);
		assert.deepEqual(healthy.metric, { value: 0 });
		assert.equal(healthy.queryError, undefined);
	} finally {
		database.close();
	}
});

test('the shared KPI markup escapes text and omits absent secondary labels', async () => {
	const template = create.Template.loadsTemplate({
		loader: new FileSystemLoader(fileURLToPath(new URL('../src/templates', import.meta.url))),
		template: 'dashboard-template.html', context: { formatMetric },
	});
	const elements = [
		{ value: 0 },
		{ value: null, label: null },
		{ value: '<record>', label: '<Cubs> & 1906' },
	].map((metric, index): types.LayoutElement => ({
		id: `metric-${index}`, type: 'metric', title: 'Record', description: 'Archive headline',
		usesData: true, dataRequest: 'Find records', requiredTables: ['Teams'], columnClass: 'col-12', metric,
	}));
	const html = await template({ elements });
	assert(html.includes('class="metric-value">0</div>'));
	assert(html.includes('class="metric-value">-</div>'));
	assert(html.includes('class="metric-value">&lt;record&gt;</div>'));
	assert.equal((html.match(/class="metric-label"/g) ?? []).length, 1);
	assert(html.includes('&lt;Cubs&gt; &amp; 1906'));
	assert(!html.includes('"metric-0":'));
});
