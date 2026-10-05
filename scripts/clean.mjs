import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

for (const relativePath of ['../src/database/', '../src/dashboard.html']) {
	const target = fileURLToPath(new URL(relativePath, import.meta.url));
	await rm(target, { recursive: true, force: true });
	console.log(`Deleted: ${target}`);
}
