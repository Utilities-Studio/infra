#!/usr/bin/env bun
import { join } from 'node:path'

const ROOT = process.cwd()
const OUT_FILE = join(ROOT, 'src', 'vite-env.d.ts')
const ENV_FILE = join(ROOT, '.env.development')

if (!(await Bun.file(ENV_FILE).exists())) {
	console.log('Skipping vite-env generation (.env.development not found)')
	process.exit(0)
}

const keys = Object.keys(process.env).filter((k) => k.startsWith('VITE_'))

if (keys.length === 0) {
	console.log('No VITE_ environment variables found, skipping generation')
	process.exit(0)
}

const content = `// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface ViteTypeOptions {
	strictImportMetaEnv: unknown
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface ImportMetaEnv {
${keys.map((k) => `	readonly ${k}: string`).join('\n')}
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface ImportMeta {
	readonly env: ImportMetaEnv
}
`

await Bun.write(OUT_FILE, content)
console.log(`Generated ${OUT_FILE}`)
