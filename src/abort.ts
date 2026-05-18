/**
 * Link a caller abort signal to an internal abort controller.
 *
 * Creates an internal AbortController that can be aborted either by the
 * caller or by timeout. When the caller signals abort, the internal
 * controller is also aborted, ensuring consistent cancellation behavior.
 * The cleanup function must be called to remove the event listener when
 * the operation completes.
 *
 * @returns An object with the internal controller, its signal, and a cleanup function.
 */
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
