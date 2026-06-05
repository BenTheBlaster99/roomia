'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center gap-4 p-6">
      <h2 className="text-xl font-bold">Something went wrong</h2>
      <p className="text-sm text-zinc-400">{error.message}</p>
      <button
        onClick={reset}
        className="px-6 py-2 bg-amber-400 text-zinc-950 rounded-lg text-sm font-bold"
      >
        Try again
      </button>
    </div>
  )
}
