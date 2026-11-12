// Validates that repo config files parse, and that no .env/secret files are tracked.
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

let failed = false
const fail = (msg) => { console.error(`✗ ${msg}`); failed = true }

for (const file of ['package.json', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'wrangler.jsonc']) {
  try {
    const text = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,(\s*[}\]])/g, '$1')
    JSON.parse(text)
    console.log(`✓ ${file}`)
  } catch (e) {
    fail(`${file} is not valid JSON: ${e.message}`)
  }
}

const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n')
for (const f of tracked) {
  if (/(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.example')) fail(`tracked env file: ${f}`)
  if (/(^|\/)\.dev\.vars/.test(f)) fail(`tracked Wrangler secrets file: ${f}`)
}

process.exit(failed ? 1 : 0)
