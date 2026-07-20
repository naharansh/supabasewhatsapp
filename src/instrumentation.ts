export function register() {
  if (process.env.NEXT_RUNTIME !== 'edge') {
    require('./instrumentation.node')
  }
}
