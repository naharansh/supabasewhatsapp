export function withAbortHandler(
  request: Request,
  fn: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const controller = new AbortController()

  const onAbort = () => {
    controller.abort()
  }

  request.signal.addEventListener('abort', onAbort, { once: true })

  return fn(controller.signal).finally(() => {
    request.signal.removeEventListener('abort', onAbort)
  })
}

export function createAbortSignal(request: Request, timeoutMs?: number): AbortSignal {
  const controller = new AbortController()

  request.signal.addEventListener('abort', () => controller.abort(), { once: true })

  if (timeoutMs && timeoutMs > 0) {
    setTimeout(() => controller.abort(), timeoutMs)
  }

  return controller.signal
}
