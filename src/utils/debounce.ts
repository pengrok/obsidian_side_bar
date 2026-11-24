/** 키별로 따로 도는 디바운스. 같은 키로 다시 부르면 타이머를 다시 잰다. */
export class KeyedDebouncer {
	private timers = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(private wait: number) {}

	run(key: string, fn: () => void): void {
		const t = this.timers.get(key);
		if (t !== undefined) clearTimeout(t);
		this.timers.set(
			key,
			setTimeout(() => {
				this.timers.delete(key);
				fn();
			}, this.wait),
		);
	}

	cancel(key: string): void {
		const t = this.timers.get(key);
		if (t !== undefined) clearTimeout(t);
		this.timers.delete(key);
	}

	clear(): void {
		for (const t of this.timers.values()) clearTimeout(t);
		this.timers.clear();
	}
}

/** 단순 디바운스 */
export function debounceFn<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
	let t: ReturnType<typeof setTimeout> | undefined;
	const wrapped = (...args: A) => {
		if (t !== undefined) clearTimeout(t);
		t = setTimeout(() => {
			t = undefined;
			fn(...args);
		}, wait);
	};
	wrapped.cancel = () => {
		if (t !== undefined) clearTimeout(t);
		t = undefined;
	};
	return wrapped;
}

/** 스로틀: wait 안에 여러 번 불러도 마지막 호출을 wait마다 한 번 실행 */
export function throttleFn<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
	let last = 0;
	let t: ReturnType<typeof setTimeout> | undefined;
	let pending: A | null = null;
	const wrapped = (...args: A) => {
		const now = Date.now();
		pending = args;
		if (now - last >= wait) {
			last = now;
			pending = null;
			fn(...args);
		} else if (t === undefined) {
			t = setTimeout(() => {
				t = undefined;
				last = Date.now();
				if (pending) fn(...pending);
				pending = null;
			}, wait - (now - last));
		}
	};
	wrapped.cancel = () => {
		if (t !== undefined) clearTimeout(t);
		t = undefined;
		pending = null;
	};
	return wrapped;
}
