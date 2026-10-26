import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	fetchAddressHistoryData,
	RequestParametersSchema,
} from '#lib/server/address-history'

const { indexer, getTransactionReceipt, getTransactions } = vi.hoisted(() => ({
	indexer: vi.fn(),
	getTransactionReceipt: vi.fn(),
	getTransactions: vi.fn(),
}))

// A devnet build on its own tidx, with no API.
vi.mock('#lib/server/env', () => ({ tempoApi: undefined }))
vi.mock('#lib/server/dex-indexer', () => ({ indexer }))
vi.mock('#lib/server/tempo-api', () => ({
	api: { v1: { transactions: { $get: getTransactions } } },
}))
vi.mock('#lib/server/transaction-activities', () => ({
	getTransactionActivities: async () => [],
}))
vi.mock('#wagmi.config', () => ({
	getBatchedClient: () => ({ getTransactionReceipt }),
	getWagmiConfig: () => ({}),
}))

const ACCOUNT = '0x0000000000000000000000000000000000000a00'
const SENDER = '0xaf1bf95d223a2c06d0726aa1107d2ed44356b0c1'
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const cursor = (block: number, index: number) =>
	btoa(JSON.stringify([block, index]))

/** Rows as tidx returns them, newest first, one transaction a block. */
const rows = (blocks: number[]) =>
	blocks.map((block) => ({
		hash: hash(block),
		block_num: block,
		idx: 0,
		timestamp: 1792744092,
		from: SENDER,
		to: ACCOUNT,
		value: '0',
		input: '0x318b38b1',
	}))

beforeEach(() => {
	vi.resetAllMocks()
	indexer.mockImplementation(async (_chainId: number, sql: string) =>
		sql.includes('count()') ? [{ n: 32 }] : rows([30, 29, 28]),
	)
	getTransactionReceipt.mockImplementation(async () => ({
		status: 'success',
		from: SENDER,
		gasUsed: 2_843_694n,
		effectiveGasPrice: 20_000_000_000n,
		contractAddress: null,
		logs: [],
	}))
})

const sql = () => indexer.mock.calls.map(([, query]) => String(query))

describe('fetchAddressHistoryData on a devnet build with its own tidx', () => {
	it('pages and counts from tidx, and reads receipts from the node', async () => {
		const result = await fetchAddressHistoryData({
			address: ACCOUNT,
			chainId: 31318,
			searchParams: RequestParametersSchema.parse({ limit: 2 }),
		})
		expect(result.transactions.map((tx) => tx.hash)).toEqual([
			hash(30),
			hash(29),
		])
		expect(result.transactions[0]).toMatchObject({
			timestamp: 1792744092,
			from: '0xaf1BF95D223A2C06D0726Aa1107D2eD44356b0C1',
			status: 'success',
			gasUsed: '0x2b642e',
		})
		expect(result.total).toBe(32)
		// The row past the page says there is another.
		expect(result.nextCursor).toBe(cursor(29, 0))
		expect(sql()[0]).toContain(
			`(t."from" = '${ACCOUNT}' OR t."to" = '${ACCOUNT}')`,
		)
		expect(sql()[0]).toContain('LIMIT 3')
		expect(getTransactionReceipt).toHaveBeenCalledTimes(2)
		expect(getTransactions).not.toHaveBeenCalled()
	})

	it('filters by side and status, and continues from a cursor without counting', async () => {
		await fetchAddressHistoryData({
			address: ACCOUNT,
			chainId: 31318,
			searchParams: RequestParametersSchema.parse({
				include: 'sent',
				status: 'reverted',
				cursor: cursor(29, 0),
			}),
		})
		expect(sql()).toHaveLength(1)
		expect(sql()[0]).toContain(`t."from" = '${ACCOUNT}'`)
		expect(sql()[0]).not.toContain('t."to" =')
		expect(sql()[0]).toContain('r.status = 0')
		expect(sql()[0]).toContain('(t.block_num, t.idx) < (29, 0)')
	})
})
