export type EnvKeyClassification = {
	isPublic: boolean
	isSecret: boolean
	reason: 'hard secret marker' | 'public marker' | 'secret marker' | 'no secret marker'
}

const PUBLIC_PREFIXES = ['VITE_', 'NEXT_PUBLIC_', 'NUXT_PUBLIC_', 'PUBLIC_', 'EXPO_PUBLIC_', 'REACT_APP_'] as const

const PUBLIC_MARKERS = ['PUBLISHABLE', 'PUBLIC_KEY', 'SITE_KEY'] as const

const HARD_SECRET_MARKERS = [
	'SECRET',
	'PRIVATE_KEY',
	'PRIVATE_PEM',
	'PASSWORD',
	'PASSWD',
	'ACCESS_TOKEN',
	'REFRESH_TOKEN',
	'ID_TOKEN',
	'SERVICE_ROLE',
	'DB_URL',
	'DATABASE_URL',
	'POSTGRES_URL',
	'POSTGRES_PRISMA_URL',
	'MYSQL_URL',
	'MONGO_URI',
	'MONGODB_URI',
	'REDIS_URL',
	'CONNECTION_STRING',
	'DSN_SECRET'
] as const

const SECRET_MARKERS = [
	'API_KEY',
	'API_TOKEN',
	'AUTH_TOKEN',
	'BOT_TOKEN',
	'TOKEN',
	'ACCESS_KEY',
	'CREDENTIAL',
	'CREDENTIALS',
	'ENCRYPTION_KEY',
	'HMAC_KEY',
	'SIGNING_KEY',
	'SIGNING_TOKEN',
	'WEBHOOK_KEY',
	'RESTRICTED_KEY'
] as const

function normalizeEnvKey(key: string): string {
	return key.trim().toUpperCase()
}

function hasMarker(key: string, markers: readonly string[]): boolean {
	return markers.some((marker) => key === marker || key.includes(marker))
}

export function hasPublicEnvMarker(key: string): boolean {
	const normalized = normalizeEnvKey(key)
	return PUBLIC_PREFIXES.some((prefix) => normalized.startsWith(prefix)) || hasMarker(normalized, PUBLIC_MARKERS)
}

export function classifyEnvKey(key: string): EnvKeyClassification {
	const normalized = normalizeEnvKey(key)
	const isPublic = hasPublicEnvMarker(normalized)

	if (hasMarker(normalized, HARD_SECRET_MARKERS)) {
		return {
			isPublic,
			isSecret: true,
			reason: 'hard secret marker'
		}
	}

	if (isPublic) {
		return {
			isPublic: true,
			isSecret: false,
			reason: 'public marker'
		}
	}

	if (hasMarker(normalized, SECRET_MARKERS)) {
		return {
			isPublic: false,
			isSecret: true,
			reason: 'secret marker'
		}
	}

	return {
		isPublic: false,
		isSecret: false,
		reason: 'no secret marker'
	}
}

export function isSecretKey(key: string): boolean {
	return classifyEnvKey(key).isSecret
}
