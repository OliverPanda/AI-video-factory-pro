import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const testsDir = path.resolve(process.cwd(), 'tests');
const filters = process.argv.slice(2).map((value) => value.toLowerCase());
const testFiles = fs.existsSync(testsDir)
  ? fs
      .readdirSync(testsDir)
      .filter((file) => file.endsWith('.test.js'))
      .filter((file) =>
        filters.length === 0 ? true : filters.some((filter) => file.toLowerCase().includes(filter))
      )
      .sort()
  : [];

if (testFiles.length === 0) {
  console.log('No test files found.');
  process.exit(0);
}

for (const file of testFiles) {
  await import(pathToFileURL(path.join(testsDir, file)).href);
}
