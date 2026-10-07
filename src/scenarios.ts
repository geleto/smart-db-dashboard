import type { types } from './types';

export function listScenarios(inputFile: types.PlanningInputFile): string {
	return Object.entries(inputFile.scenarios)
		.map(([key, scenario], index) => `${index + 1}. ${scenario.name} (${key})`)
		.join('\n');
}

export function selectScenario(inputFile: types.PlanningInputFile, args: string[] = []) {
	const [number] = args;
	const keys = Object.keys(inputFile.scenarios);
	if (args.length > 1 || (number !== undefined && (!/^[1-9]\d*$/.test(number) || Number(number) > keys.length))) {
		throw new Error(`Choose a scenario number from 1 to ${keys.length}.\nUsage: npm start -- <number>\n\n${listScenarios(inputFile)}`);
	}
	const key = number === undefined ? inputFile.activeScenario : keys[Number(number) - 1];
	const scenario = inputFile.scenarios[key];
	if (!scenario) {
		throw new Error(`input.json activeScenario "${key}" was not found.`);
	}
	return { key, scenario };
}
