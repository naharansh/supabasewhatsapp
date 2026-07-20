process.on('uncaughtException', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
    return
  }
  console.error('[uncaughtException]', err)
})

process.on('unhandledRejection', (reason) => {
  const err = reason as NodeJS.ErrnoException
  if (err?.code === 'ECONNRESET') {
    return
  }
  console.error('[unhandledRejection]', reason)
})
