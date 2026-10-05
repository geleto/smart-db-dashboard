import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, generateText, NoObjectGeneratedError, streamObject } from 'ai';
import { create, FileSystemLoader } from 'casai';
import { fileURLToPath } from 'node:url';
import { withOpenAIFinalAnswer } from '../src/openai-final-answer.ts';
import { schemas } from '../src/types.ts';

const card = { id: 'chart-trends', type: 'chart', html: '<div>Trends</div>', script: '' };
const header = {
	id: 'overview', type: 'header', title: 'Overview', description: 'Test dashboard',
	usesData: false, dataRequest: '', requiredTables: [],
};
const usage = {
	input_tokens: 1567,
	input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 500 },
	output_tokens: 1279,
	output_tokens_details: { reasoning_tokens: 0 },
};

function message(id: string, text: string, phase?: 'commentary' | 'final_answer') {
	return {
		id, type: 'message', role: 'assistant', status: 'completed',
		...(phase ? { phase } : {}),
		content: [{ type: 'output_text', text, annotations: [] }],
	};
}

function mockModel(output: ReturnType<typeof message>[], latePhase = false) {
	const response = { id: 'resp_test', created_at: 1, model: 'gpt-6-luna', status: 'completed', output, usage };
	const provider = createOpenAI({
		apiKey: 'test-key',
		fetch: async (_url, init) => {
			const request = JSON.parse(String(init?.body));
			if (!request.stream) return Response.json(response);
			const events: unknown[] = [{ type: 'response.created', response }];
			output.forEach((item, output_index) => {
				const startItem = { ...item };
				if (latePhase) delete startItem.phase;
				events.push({ type: 'response.output_item.added', output_index, item: startItem });
				const text = item.content[0].text;
				// Split within the JSON to exercise incremental parsing.
				for (const delta of [text.slice(0, 15), text.slice(15)]) {
					events.push({ type: 'response.output_text.delta', item_id: item.id, output_index, content_index: 0, delta });
				}
				events.push({ type: 'response.output_item.done', output_index, item });
			});
			events.push({ type: 'response.completed', response });
			return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
				headers: { 'content-type': 'text/event-stream' },
			});
		},
	});
	return provider.responses('gpt-6-luna');
}

const mixedOutput = (finalText: string) => [
	message('msg_commentary', `${JSON.stringify(card)} extra commentary`, 'commentary'),
	message('msg_final', finalText, 'final_answer'),
];

test('reproduces the JSON failure and selects the final answer with full usage', async () => {
	const model = mockModel(mixedOutput(JSON.stringify(card)));
	await assert.rejects(generateObject({ model, schema: schemas.renderedElement, prompt: 'Render the card.' }),
		error => NoObjectGeneratedError.isInstance(error));
	const result = await generateObject({ model: withOpenAIFinalAnswer(model), schema: schemas.renderedElement, prompt: 'Render the card.' });
	assert.deepEqual(result.object, card);
	assert.equal(result.usage.inputTokens, usage.input_tokens);
	assert.equal(result.usage.outputTokens, usage.output_tokens);
	assert.equal(result.usage.inputTokenDetails.cacheReadTokens, 1000);
	assert.equal(result.usage.inputTokenDetails.cacheWriteTokens, 500);
	assert.equal(result.providerMetadata?.openai?.responseId, 'resp_test');
});

test('the Casai element renderer parses the final card using the real template', async () => {
	const renderer = create.ObjectGenerator.loadsTemplate({
		model: withOpenAIFinalAnswer(mockModel(mixedOutput(JSON.stringify(card)))),
		loader: new FileSystemLoader(fileURLToPath(new URL('../src/templates', import.meta.url))),
		prompt: 'element-renderer.md', output: 'object', schema: schemas.renderedElement,
	});
	assert.deepEqual((await renderer({ elementType: card.type, elementJson: JSON.stringify(card) })).object, card);
});

test('SQL and HTML text consumers receive only the final answer', async () => {
	for (const text of ['SELECT * FROM teams;', '<p>Revenue increased.</p>']) {
		const result = await generateText({ model: withOpenAIFinalAnswer(mockModel(mixedOutput(text))), prompt: 'Generate the result.' });
		assert.equal(result.text, text);
	}
});

for (const latePhase of [false, true]) {
	test(`streamed planners ignore commentary with phase on ${latePhase ? 'message completion' : 'message start'}`, async () => {
		const result = streamObject({
			model: withOpenAIFinalAnswer(mockModel(mixedOutput(JSON.stringify({ elements: [header] })), latePhase)),
			output: 'array', schema: schemas.headerMetricElement, prompt: 'Plan the dashboard.',
		});
		const elements = [];
		for await (const element of result.elementStream) elements.push(element);
		assert.deepEqual(elements, [header]);
		assert.deepEqual(await result.object, [header]);
		assert.equal((await result.usage).outputTokens, usage.output_tokens);
	});
}

test('responses without phase metadata still work in generation and streaming', async () => {
	const generated = await generateObject({
		model: withOpenAIFinalAnswer(mockModel([message('msg_legacy', JSON.stringify(card))])),
		schema: schemas.renderedElement, prompt: 'Render the card.',
	});
	assert.deepEqual(generated.object, card);
	const streamed = streamObject({
		model: withOpenAIFinalAnswer(mockModel([message('msg_legacy', JSON.stringify({ elements: [header] }))])),
		output: 'array', schema: schemas.headerMetricElement, prompt: 'Plan the dashboard.',
	});
	for await (const _element of streamed.elementStream) { /* Consume the stream. */ }
	assert.deepEqual(await streamed.object, [header]);
});

test('invalid final JSON still fails instead of accepting valid commentary', async () => {
	const model = withOpenAIFinalAnswer(mockModel(mixedOutput('invalid final JSON')));
	await assert.rejects(generateObject({ model, schema: schemas.renderedElement, prompt: 'Render the card.' }),
		error => NoObjectGeneratedError.isInstance(error));
});

test('the dashboard orchestrator completes with commentary in planners and the renderer', async () => {
	const loader = new FileSystemLoader(fileURLToPath(new URL('../src/templates', import.meta.url)));
	const planner = (prompt: string, schema: typeof schemas.headerMetricElement | typeof schemas.visualElement | typeof schemas.insightTextElement, elements: unknown[]) =>
		create.ObjectStreamer.loadsTemplate({
			model: withOpenAIFinalAnswer(mockModel(mixedOutput(JSON.stringify({ elements })))),
			loader, prompt, output: 'array', schema,
		});
	const renderedHeader = { ...card, id: 'header-overview', type: 'header', html: '<header>Overview</header>' };
	const renderer = create.ObjectGenerator.loadsTemplate({
		model: withOpenAIFinalAnswer(mockModel(mixedOutput(JSON.stringify(renderedHeader)))),
		loader, prompt: 'element-renderer.md', output: 'object', schema: schemas.renderedElement,
	});
	const processor = create.Script.loadsScript({
		loader: new FileSystemLoader(fileURLToPath(new URL('../src', import.meta.url))),
		script: 'orchestrator.cas', schema: schemas.processedDashboard,
		context: {
			headerMetricPlanner: planner('header-metric-planner.md', schemas.headerMetricElement, [header]),
			visualPlanner: planner('visual-planner.md', schemas.visualElement, []),
			insightTextPlanner: planner('insight-text-planner.md', schemas.insightTextElement, []),
			elementRenderer: renderer,
			normalizeElementId: (type: string, id: string) => `${type}-${id}`,
			toJson: JSON.stringify,
			datasetName: 'Test', datasetDescription: 'Test database', userRequest: 'Show an overview.',
			schemaSummary: 'No data needed.',
		},
	});
	assert.deepEqual(await processor({}), [{ ...header, id: renderedHeader.id, html: renderedHeader.html, script: '' }]);
});
