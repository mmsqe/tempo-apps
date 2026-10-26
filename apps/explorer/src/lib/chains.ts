import { tempoDevnet as tempoDevnet_, tempo, tempoModerato } from 'viem/chains'
import { alphausd, pathusd } from 'viem/tokens'
import { ZONE_PROVER_CHAIN_ID, ZONE_PROVER_EXPLORER_URL } from './zone-prover'

export const tempoZoneProver = tempoDevnet_.extend({
	id: ZONE_PROVER_CHAIN_ID,
	feeToken: '0x20c0000000000000000000000000000000000002',
	name: 'Tempo Prover Devnet',
	rpcUrls: { default: { http: [`${ZONE_PROVER_EXPLORER_URL}/api/rpc`] } },
	blockExplorers: {
		default: {
			name: 'Tempo Prover Explorer',
			url: ZONE_PROVER_EXPLORER_URL,
		},
	},
})

export const tempoMainnet = tempo.extend({
	feeToken: pathusd.addresses[tempo.id],
})

export const tempoTestnet = tempoModerato.extend({
	feeToken: alphausd.addresses[tempoModerato.id],
})

export const tempoDevnet = tempoDevnet_.extend({
	feeToken: '0x20c0000000000000000000000000000000000002',
})

/**
 * The devnet chain the app connects with: viem's, or, for a build on another
 * devnet's RPC (`VITE_DEVNET_RPC_OVERRIDDEN`), that RPC alone, with no
 * WebSocket (the head is polled through `/api/rpc`) and no Tempo explorer.
 */
export const connectedTempoDevnet =
	import.meta.env.VITE_DEVNET_RPC_OVERRIDDEN === 'true'
		? {
				...tempoDevnet_,
				rpcUrls: { default: { http: [import.meta.env.DEVNET_RPC_URL ?? ''] } },
				blockExplorers: undefined,
			}
		: tempoDevnet_

export const tempoNextfork = tempoDevnet_.extend({
	feeToken: '0x20c0000000000000000000000000000000000002',
	rpcUrls: {
		default: {
			http: ['https://rpc-nextfork.devnet.tempoxyz.dev'],
		},
	},
})
