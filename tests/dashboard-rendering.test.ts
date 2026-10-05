import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { create, FileSystemLoader } from 'casai';
import { schemas } from '../src/types.ts';
import type { types } from '../src/types.ts';

const contentHtml = '<ul><li><strong>North</strong> leads revenue.</li><li>Compare basket sizes & sales counts.</li></ul>';
const rows = [{ region: 'North', revenue: 400 }];

for (const succeeds of [true, false]) {
	test(`insight ${succeeds ? 'generation skips rendering' : 'query failure keeps the error card'}`, async () => {
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
				sqlFromRequestGenerator: () => { calls.sql++; return { text: 'SELECT region, revenue FROM sales' }; },
				sqlRepairGenerator: () => { calls.repair++; return { text: 'SELECT region, revenue FROM sales' }; },
				textInsightGenerator: () => { calls.insight++; return { text: contentHtml }; },
				elementRenderer: () => { calls.render++; assert.fail('Insight HTML must not be rendered twice'); },
				database: { tryExecuteSql: () => succeeds ? { ok: true, rows } : { ok: false, rows: [], error: 'no such column: revenue' } },
				schemaMetadataForTables: () => ({}), schemaSummaryTemplate: () => 'sales: region, revenue',
				generatePreviewJson: JSON.stringify, toJson: JSON.stringify,
				normalizeElementId: (type: string, id: string) => `${type}-${id}`,
				datasetName: 'Test', datasetDescription: 'Test sales', userRequest: 'Compare regions.',
				schemaSummary: 'sales: region, revenue',
			},
		});
		const [element] = await processor({});
		assert.equal(element.id, 'insight-regional-revenue');
		assert.equal(element.html, undefined);
		assert.equal(element.script, undefined);
		if (succeeds) {
			assert.deepEqual(calls, { sql: 1, repair: 0, insight: 1, render: 0 });
			assert.equal(element.contentHtml, contentHtml);
			assert.equal(element.dataJson, '"insight-regional-revenue": ' + JSON.stringify(rows));
			assert.equal(element.queryError, undefined);
		} else {
			assert.deepEqual(calls, { sql: 1, repair: 2, insight: 0, render: 0 });
			assert.equal(element.queryError, 'no such column: revenue');
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
		element('metric', 'Revenue & <margin>', { html: '<div id="metric-test-value" class="metric-value-number"></div>', script: 'document.getElementById("metric-test-value").textContent = "400";' }),
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
	assert.equal((html.match(/id="metric-test-value"/g) ?? []).length, 1);
	assert.equal(html.split('Use the charts to compare regions.').length - 1, 1);
});
