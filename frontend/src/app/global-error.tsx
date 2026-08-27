"use client";
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html>
      <body>
        <main className="page">
          <h1>Local Studio encountered an error</h1>
          <p className="error">{error.message}</p>
          <button onClick={reset}>Try again</button>
        </main>
      </body>
    </html>
  );
}
