import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAddressBalancesData } from '#lib/server/address-balances'
import { fetchAccountTransfers, fetchTransfers } from '#lib/server/token'

const { indexer, getMetadata, hosted } = vi.hoisted(() => ({
	indexer: vi.fn(),
	getMetadata: vi.fn(),
	hosted: vi.fn(),
}))

vi.mock('@tanstack/react-start', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/react-start')>()),
	createServerFn: () => ({
		inputValidator: (validate: (data: unknown) => unknown) => ({
			handler:
				(handler: (input: { data: unknown }) => unknown) =>
				(input: { data: unknown }) =>
					handler({ data: validate(input.data) }),
		}),
	}),
}))
// A devnet build on its own tidx, with no API.
vi.mock('#lib/server/env', () => ({ tempoApi: undefined }))
vi.mock('#lib/server/dex-indexer', () => ({ indexer }))
vi.mock('#lib/server/tempo-api', () => ({
	api: {
		v1: {
			transfers: { $get: hosted },
			addresses: { ':address': { balances: { $get: hosted } } },
		},
	},
}))
vi.mock('#wagmi.config.ts', () => ({
	getWagmiConfig: () => ({ state: { chainId: 31318 } }),
	getBatchedClient: () => ({ token: { getMetadata } }),
}))

const ACCOUNT = '0x286ad6cfc7279c8a6d86d15dcefcb77a65aa7e92'
const NUSD = '0x20c0000000000000000000000000000000000000'
const OTHER = '0x20c0000000000000000000000000000000000001'
const sql = () => indexer.mock.calls.map(([, query]) => String(query))

beforeEach(() => {
	vi.resetAllMocks()
	getMetadata.mockImplementation(async ({ token }: { token: string }) => {
		if (token !== NUSD) throw new Error('not a TIP-20')
		return { name: 'nUSD', symbol: 'nUSD', currency: 'USD', decimals: 6 }
	})
})

describe('transfers from a devnet build’s own tidx', () => {
	beforeEach(() => {
		indexer.mockImplementation(async (_chainId: number, query: string) =>
			query.includes('count()')
				? [{ n: '12' }]
				: [
						{
							token: NUSD,
							from: ACCOUNT,
							to: OTHER,
							amount: '1500000',
							tx_hash: `0x${'a'.repeat(64)}`,
							block_num: 7,
							log_idx: 2,
							timestamp: 1792744092,
						},
					],
		)
	})

	it.each([
		{
			direction: undefined,
			side: `(\`from\` = '${ACCOUNT}' OR \`to\` = '${ACCOUNT}')`,
		},
		{ direction: 'in' as const, side: `\`to\` = '${ACCOUNT}'` },
		{ direction: 'out' as const, side: `\`from\` = '${ACCOUNT}'` },
	])('pages the $direction feed with its count and token details', async ({
		direction,
		side,
	}) => {
		const result = await fetchAccountTransfers({
			data: { account: ACCOUNT, page: 2, limit: 10, direction },
		})
		expect(result.total).toBe(12)
		expect(result.transfers).toEqual([
			{
				id: `0x${'a'.repeat(64)}-2`,
				from: ACCOUNT,
				to: OTHER,
				value: '1500000',
				transactionHash: `0x${'a'.repeat(64)}`,
				blockNumber: '7',
				timestamp: '1792744092',
				token: { address: NUSD, symbol: 'nUSD', decimals: 6, currency: 'USD' },
			},
		])
		expect(sql()[0]).toContain(`WHERE ${side}`)
		expect(sql()[0]).toContain('LIMIT 10 OFFSET 10')
		expect(sql()[1]).toBe(
			`SELECT count() AS n FROM token_transfers WHERE ${side}`,
		)
		expect(hosted).not.toHaveBeenCalled()
	})

	it('filters a token page’s feed by token and account', async () => {
		const result = await fetchTransfers({
			data: { address: NUSD, page: 1, limit: 10, account: ACCOUNT },
		})
		expect(result.total).toBe(12)
		expect(sql()[0]).toContain(
			`WHERE token = '${NUSD}' AND (\`from\` = '${ACCOUNT}' OR \`to\` = '${ACCOUNT}')`,
		)
		expect(getMetadata).not.toHaveBeenCalled()
	})
})

describe('holdings from a devnet build’s own tidx', () => {
	it('lists the holder’s balances with token details from the node', async () => {
		indexer.mockResolvedValue([
			{ token: OTHER, balance: '7' },
			{ token: NUSD, balance: '2500000' },
		])
		const { balances } = await fetchAddressBalancesData({
			address: '0x286AD6CFC7279c8A6d86D15dcEfcb77A65aA7E92',
			chainId: 31318,
		})
		expect(sql()[0]).toContain(`WHERE holder = '${ACCOUNT}'`)
		// USD-denominated first; a token the node cannot describe keeps its raw balance.
		expect(balances).toEqual([
			{
				token: NUSD,
				balance: '2500000',
				name: 'nUSD',
				symbol: 'nUSD',
				currency: 'USD',
				decimals: 6,
			},
			{ token: OTHER, balance: '7' },
		])
		expect(hosted).not.toHaveBeenCalled()
	})
})
