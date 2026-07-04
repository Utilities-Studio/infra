import { describe, expect, test } from 'bun:test'

import { classifyEnvKey, hasPublicEnvMarker, isSecretKey } from './secret-keys'

describe('env key secret classification', () => {
	test('keeps known browser-visible public keys out of secrets', () => {
		expect(isSecretKey('VITE_SITE_URL')).toBe(false)
		expect(isSecretKey('VITE_SUPABASE_PUBLISHABLE_KEY')).toBe(false)
		expect(isSecretKey('VITE_TURNSTILE_SITE_KEY')).toBe(false)
		expect(isSecretKey('NEXT_PUBLIC_FIREBASE_API_KEY')).toBe(false)
		expect(isSecretKey('PUBLIC_STRIPE_PUBLISHABLE_KEY')).toBe(false)
		expect(isSecretKey('SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID')).toBe(false)
		expect(isSecretKey('CLOUDFLARE_ACCOUNT_ID')).toBe(false)
		expect(isSecretKey('AWS_ACCOUNT_ID')).toBe(false)
		expect(isSecretKey('AWS_REGION')).toBe(false)
		expect(isSecretKey('SIGNALWIRE_FROM_NUMBER')).toBe(false)
	})

	test('detects server-side credential patterns from project env files', () => {
		expect(isSecretKey('SUPABASE_SECRET_KEY')).toBe(true)
		expect(isSecretKey('SUPABASE_DB_URL')).toBe(true)
		expect(isSecretKey('SUPABASE_AUTH_CAPTCHA_SECRET')).toBe(true)
		expect(isSecretKey('SUPABASE_AUTH_HOOK_SECRET')).toBe(true)
		expect(isSecretKey('SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET')).toBe(true)
		expect(isSecretKey('COMPOSIO_API_KEY')).toBe(true)
		expect(isSecretKey('NANGO_API_KEY')).toBe(true)
		expect(isSecretKey('AWS_ACCESS_KEY_ID')).toBe(true)
		expect(isSecretKey('AWS_SECRET_ACCESS_KEY')).toBe(true)
		expect(isSecretKey('CLOUDFLARE_API_TOKEN')).toBe(true)
		expect(isSecretKey('SIGNALWIRE_API_TOKEN')).toBe(true)
	})

	test('detects common database, token, signing, and private material names', () => {
		expect(isSecretKey('DATABASE_URL')).toBe(true)
		expect(isSecretKey('POSTGRES_URL')).toBe(true)
		expect(isSecretKey('REDIS_URL')).toBe(true)
		expect(isSecretKey('MONGO_URI')).toBe(true)
		expect(isSecretKey('SESSION_SECRET')).toBe(true)
		expect(isSecretKey('COOKIE_SECRET')).toBe(true)
		expect(isSecretKey('JWT_SECRET')).toBe(true)
		expect(isSecretKey('ENCRYPTION_KEY')).toBe(true)
		expect(isSecretKey('HMAC_KEY')).toBe(true)
		expect(isSecretKey('SIGNING_KEY')).toBe(true)
		expect(isSecretKey('WEBHOOK_SIGNING_SECRET')).toBe(true)
		expect(isSecretKey('CLIENT_SECRET')).toBe(true)
		expect(isSecretKey('PRIVATE_PEM')).toBe(true)
		expect(isSecretKey('STRIPE_RESTRICTED_KEY')).toBe(true)
	})

	test('hard secret markers win over public markers', () => {
		expect(isSecretKey('VITE_INTERNAL_SECRET')).toBe(true)
		expect(isSecretKey('PUBLIC_REFRESH_TOKEN')).toBe(true)
		expect(isSecretKey('NEXT_PUBLIC_PRIVATE_KEY')).toBe(true)
		expect(isSecretKey('EXPO_PUBLIC_PASSWORD')).toBe(true)
	})

	test('recognizes public markers separately from secret classification', () => {
		expect(hasPublicEnvMarker('VITE_SITE_URL')).toBe(true)
		expect(hasPublicEnvMarker('PUBLIC_API_KEY')).toBe(true)
		expect(hasPublicEnvMarker('SENTRY_PUBLIC_KEY')).toBe(true)
		expect(hasPublicEnvMarker('SUPABASE_PROJECT_ID')).toBe(false)
	})

	test('returns classification reasons for tooling output', () => {
		expect(classifyEnvKey('PUBLIC_API_KEY')).toEqual({
			isPublic: true,
			isSecret: false,
			reason: 'public marker'
		})
		expect(classifyEnvKey('AWS_ACCESS_KEY_ID')).toEqual({
			isPublic: false,
			isSecret: true,
			reason: 'secret marker'
		})
		expect(classifyEnvKey('AWS_REGION')).toEqual({
			isPublic: false,
			isSecret: false,
			reason: 'no secret marker'
		})
	})
})
