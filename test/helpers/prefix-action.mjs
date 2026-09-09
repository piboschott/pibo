export function runPrefixAction(router, piboSessionId, id) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => { unsubscribe(); reject(new Error('Prefix refresh did not complete')); }, 25000);
		const unsubscribe = router.subscribe(event => {
			if (event.eventId !== id || !['execution_result', 'session_error'].includes(event.type) || event.result?.queued) return;
			clearTimeout(timer); unsubscribe();
			if (event.type === 'session_error') reject(new Error(event.error)); else resolve(event.result);
		});
		void router.emit({ type: 'execution', piboSessionId, id, action: 'session.prefix.refresh', params: {} })
			.catch(error => { clearTimeout(timer); unsubscribe(); reject(error); });
	});
}
