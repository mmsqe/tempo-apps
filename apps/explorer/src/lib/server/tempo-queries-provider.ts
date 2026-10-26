import { QB, Tidx } from 'tidx.ts'
import { getIndexerBackend } from './network'

export function tempoQueryBuilder(
	chainId: number,
	options: { engine?: string | undefined } = {},
) {
	const { url, headers } = getIndexerBackend(chainId)
	const tidx = Tidx.create({ baseUrl: url, headers })
	tidx.on('response', (res) => {
		if (!res.ok)
			res
				.clone()
				.text()
				.then((body) =>
					console.error(
						`[tidx:${res.status}]`,
						decodeURIComponent(res.url),
						body,
					),
				)
	})
	return QB.from({ ...tidx, chainId, ...options })
}
