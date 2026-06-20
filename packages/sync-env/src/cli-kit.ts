import pc from 'picocolors'

export function isCi(): boolean {
	return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
}

export function isInteractive(): boolean {
	return Boolean(process.stdout.isTTY && process.stdin.isTTY && !isCi())
}

function colorsEnabled(): boolean {
	return Boolean(process.stdout.isTTY && !isCi() && !process.env.NO_COLOR)
}

export const colors = pc.createColors(colorsEnabled())

export async function readPackageVersion(): Promise<string> {
	const pkg = (await Bun.file(new URL('../package.json', import.meta.url)).json()) as {
		version?: string
	}
	return pkg.version ?? '0.0.0'
}

export function printVersion(name: string, version: string): void {
	console.log(`${name} ${version}`)
}

export function banner(
	name: string,
	version: string,
	tagline: string,
	options: { quiet?: boolean } = {},
): void {
	if (options.quiet || !isInteractive() || process.env.NO_BANNER) return

	const lines = [`${name} v${version}`, tagline]
	const width = Math.max(...lines.map((line) => line.length)) + 4
	const border = `+${'-'.repeat(width - 2)}+`

	console.log(colors.cyan(border))
	for (const line of lines) {
		console.log(colors.cyan(`| ${line.padEnd(width - 4)} |`))
	}
	console.log(colors.cyan(border))
}

function marker(label: string, color: (value: string) => string): string {
	return isInteractive() ? color(label) : label
}

export function info(message = '', indent = ''): void {
	console.log(`${indent}${message}`)
}

export function step(message: string, indent = ''): void {
	console.log(`${indent}${marker('-', colors.cyan)} ${message}`)
}

export function ok(message: string, indent = ''): void {
	console.log(`${indent}${marker('ok', colors.green)} ${message}`)
}

export function fail(message: string, indent = ''): void {
	console.log(`${indent}${marker('FAIL', colors.red)} ${message}`)
}
