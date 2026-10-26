#!/usr/bin/env node
/**
 * Serves the Tempo API's data routes (the `tapimo` package) for a `devnet`
 * build's own node and tidx, so the build needs no Tempo host:
 *
 *   DATABASE_URL=postgres://… pnpm node scripts/local-api.ts
 *
 * then `DEVNET_API_URL=http://127.0.0.1:8095` in `.env`. Its verified-token
 * list is every token the tidx has seen, re-read each minute. It reaches no
 * host but those two.
 */

import { createServer } from 'node:http'
import { App, Db } from 'tapimo'
import { data, FxOracle } from 'tapimo/apps'
import { createPublicClient, http, parseAbi } from 'viem'

// The API names MPP payees from Tempo's directory (mpp.dev); locally it has
// none, so payments read as "MPP Service".
const upstream = globalThis.fetch
globalThis.fetch = (input, init) =>
	String(input instanceof Request ? input.url : input).startsWith(
		'https://mpp.dev/',
	)
		? Promise.resolve(Response.json({ services: [] }))
		: upstream(input, init)

const env = (name: string, fallback?: string) => {
	const value = process.env[name] || fallback
	if (!value) throw new Error(`${name} is not set`)
	return value
}
const chainId = Number(env('DEVNET_CHAIN_ID', '31318'))
const rpcUrl = env('DEVNET_RPC_URL', 'http://127.0.0.1:8547')
const tidxUrl = env('DEVNET_TIDX_URL', 'http://127.0.0.1:8090')
const port = Number(env('PORT', '8095'))

const db = Db.postgres({ connectionString: env('DATABASE_URL') })
await db.migrate()

// The list's writer is internal to the package, so it is loaded by path.
const VerifiedTokens = await import(
	new URL('internal/VerifiedTokens.js', import.meta.resolve('tapimo')).href
)

const client = createPublicClient({ transport: http(rpcUrl) })
const tip20 = parseAbi([
	'function name() view returns (string)',
	'function symbol() view returns (string)',
	'function decimals() view returns (uint8)',
	'function currency() view returns (string)',
])

async function listTokens() {
	const url = new URL('/query', tidxUrl)
	url.search = new URLSearchParams({
		sql: 'SELECT token FROM token_metadata ORDER BY token',
		chainId: String(chainId),
		engine: 'clickhouse',
	}).toString()
	const result = (await (await fetch(url)).json()) as { rows?: [string][] }
	const tokens = await Promise.all(
		(result.rows ?? []).map(async ([address]) => {
			const read = (functionName: (typeof tip20)[number]['name']) =>
				client.readContract({
					address: address as `0x${string}`,
					abi: tip20,
					functionName,
				})
			const [name, symbol, decimals, currency] = await Promise.all([
				read('name'),
				read('symbol'),
				read('decimals'),
				read('currency'),
			]).catch(() => [])
			return symbol === undefined
				? undefined
				: { address, name, symbol, decimals: Number(decimals), currency }
		}),
	)
	await VerifiedTokens.replace(db, chainId, tokens.filter(Boolean))
}

await listTokens()
setInterval(() => listTokens().catch(console.error), 60_000)

const app = App.create({
	auth: false,
	db,
	defaultChainId: chainId,
	rpc: { url: (id) => (id === chainId ? rpcUrl : undefined) },
	supportedChainIds: [chainId],
}).route(
	'/',
	data({
		// USD only, instead of the ECB's daily rates.
		fx: {
			oracle: FxOracle.from({
				name: 'local',
				rates: async () => ({
					asOf: new Date().toISOString(),
					base: 'USD',
					rates: { USD: '1' },
				}),
			}),
		},
		tidx: { baseUrl: (id) => (id === chainId ? tidxUrl : undefined) },
		webhook: false,
	}),
)

createServer(App.listener(app)).listen(port, '127.0.0.1', () =>
	console.log(`Tempo API for chain ${chainId} on http://127.0.0.1:${port}`),
)
