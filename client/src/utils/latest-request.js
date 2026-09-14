export function createLatestRequest() {
  let revision = 0;
  let controller;
  let disposed = false;

  function cancel() {
    revision += 1;
    controller?.abort();
    controller = undefined;
  }

  async function run(task, { onStart, onSuccess, onError, onFinish } = {}) {
    if (disposed) return;
    cancel();
    const current = revision;
    controller = new AbortController();
    const signal = controller.signal;
    const isCurrent = () => !disposed && current === revision;
    onStart?.();
    try {
      const result = await task(signal);
      if (isCurrent()) onSuccess?.(result);
    } catch (error) {
      if (isCurrent()) onError?.(error);
    } finally {
      if (isCurrent()) onFinish?.();
    }
  }

  return { run, cancel, dispose() { disposed = true; cancel(); } };
}
