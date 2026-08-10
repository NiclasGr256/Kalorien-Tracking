/**
 * Zentraler Test-Runner
 * Führt alle .test.mjs Dateien im Ordner aus.
 */
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(__dirname).filter(file => file.endsWith('.test.mjs'));

console.log(`🚀 Starte ${files.length} Test-Suiten...\n`);

for (const file of files) {
  console.log(`Testing: ${file}`);
  const filePath = join(__dirname, file);
  // pathToFileURL stellt sicher, dass der Pfad unter Windows mit file:/// beginnt
  await import(pathToFileURL(filePath).href);
}

console.log('\n✅ Alle Tests geladen und ausgeführt.');
