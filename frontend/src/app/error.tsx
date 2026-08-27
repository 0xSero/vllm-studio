"use client";
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page">
      <h1>Something went wrong</h1>
      <p className="error">{error.message}</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
