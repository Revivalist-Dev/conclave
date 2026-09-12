/**
 * Base58 encoding utilities for compact, sortable IDs
 *
 * ID Scheme:
 *   project_id : 3 b58 chars (sequential, padded with '1', max 195,112 = 58^3)
 *   tab_id     : 4 b58 chars (sequential, padded with '1', max 11,316,496 = 58^4)
 *   message_id : tab_id (4) + timestamp seconds (6) + random (2) = 12 chars
 *   step_id    : 8 chars (timestamp seconds 6 + random 2)
 */
export const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Raw Base58 encode a byte array */
export function b58(bytes: Uint8Array | number[]): string {
	let src = [...bytes],
		out: string[] = [];
	while (src.some((v) => v)) {
		let rem = 0;
		src = src.reduce((next: number[], x: number) => {
			const acc = (rem << 8) + x;
			const q = (acc / 58) | 0;
			rem = acc % 58;
			if (next.length || q) next.push(q);
			return next;
		}, []);
		out.push(B58[rem]);
	}
	// pad with 1s to ensure fixed chars
	for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out.push('1');
	return out.reverse().join('');
}

/** Encode a non-negative integer as fixed-length Base58 string (padded with '1') */
export function encodeB58(n: number, length: number): string {
	let out = '';
	let val = n;
	while (val > 0) {
		out = B58[val % 58] + out;
		val = Math.floor(val / 58);
	}
	return out.padStart(length, '1');
}

/** Decode Base58 string back to number */
export function decodeB58(str: string): number {
	let num = 0;
	for (let i = 0; i < str.length; i++) {
		const idx = B58.indexOf(str[i]);
		if (idx === -1) continue;
		num = num * 58 + idx;
	}
	return num;
}

/** 3 b58 chars, sequential (max 195,112) */
export function newProjectId(seq: number): string {
	return encodeB58(seq, 3);
}

/** 4 b58 chars, sequential (max 11,316,496) */
export function newTabId(seq: number): string {
	return encodeB58(seq, 4);
}

/** tab_id (4 chars) + 6-char timestamp(seconds) + 2-char random = 12 chars */
export function newMessageId(tabId: string): string {
	const ts = Math.floor(Date.now() / 1000);
	const rand = Math.floor(Math.random() * (58 * 58));
	return tabId + encodeB58(ts, 6) + encodeB58(rand, 2);
}

/** Alias for newMessageId */
export function generateChatId(tabId: string): string {
	return newMessageId(tabId);
}

/** 8 chars: 6-char timestamp(seconds) + 2-char random */
export function newToolStepId(): string {
	const ts = Math.floor(Date.now() / 1000);
	const rand = Math.floor(Math.random() * (58 * 58));
	return encodeB58(ts, 6) + encodeB58(rand, 2);
}