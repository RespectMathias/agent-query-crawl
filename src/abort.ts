/** Link a caller abort signal to an internal abort controller. */
export function linkAbortSignal(signal?: AbortSignal): { controller: AbortController; signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController();

  if (!signal) {
    return { controller, signal: controller.signal, cleanup() {} };
  }

  if (signal.aborted) {
    controller.abort(signal.reason);
    return { controller, signal: controller.signal, cleanup() {} };
  }

  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });

  return {
    controller,
    signal: controller.signal,
    cleanup() {
      signal.removeEventListener('abort', abort);
    },
  };
}
