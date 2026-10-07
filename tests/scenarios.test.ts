import assert from 'node:assert/strict';
import { test } from 'node:test';
import inputJson from '../src/input.json';
import { listScenarios, selectScenario } from '../src/scenarios.ts';
import type { types } from '../src/types.ts';

const inputFile: types.PlanningInputFile = inputJson;

test('no argument uses activeScenario', () => {
	const { key, scenario } = selectScenario(inputFile);
	assert.equal(key, inputFile.activeScenario);
	assert.equal(scenario, inputFile.scenarios[key]);
});

test('scenario numbers follow JSON order and leave activeScenario unchanged', () => {
	const original = JSON.stringify(inputJson);
	const first = selectScenario(inputJson, ['1']);
	assert.equal(first.key, 'sakila_rental_activity');
	assert.equal(first.scenario, inputJson.scenarios.sakila_rental_activity);
	const fifth = selectScenario(inputJson, ['5']);
	assert.equal(fifth.key, 'lahman_team_eras');
	assert.equal(fifth.scenario, inputJson.scenarios.lahman_team_eras);
	const last = selectScenario(inputJson, ['12']);
	assert.equal(last.key, 'chinook_catalog_performance');
	assert.equal(JSON.stringify(inputJson), original);
});

test('invalid numbers and extra arguments report the usage and available scenarios', () => {
	for (const args of [['0'], ['-1'], ['13'], ['1.5'], ['1e1'], ['text'], ['1', '2']]) {
		assert.throws(() => selectScenario(inputJson, args), error => {
			assert(error instanceof Error);
			assert.match(error.message, /Choose a scenario number from 1 to 12/);
			assert.match(error.message, /Usage: npm start -- <number>/);
			assert.match(error.message, /1\. Sakila rental activity/);
			return true;
		});
	}
});

test('an explicit number works even if activeScenario is missing', () => {
	const input = { ...inputJson, activeScenario: 'missing' };
	assert.throws(() => selectScenario(input), /activeScenario "missing" was not found/);
	assert.equal(selectScenario(input, ['1']).key, 'sakila_rental_activity');
});

test('the listing shows scenario names and keys in numbered order', () => {
	const lines = listScenarios(inputJson).split('\n');
	assert.equal(lines.length, 12);
	assert.equal(lines[0], '1. Sakila rental activity (sakila_rental_activity)');
	assert.equal(lines[11], '12. Chinook catalog performance (chinook_catalog_performance)');
});
