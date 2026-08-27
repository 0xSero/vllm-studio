interface AccessRouteProps {
  readonly searchParams: Promise<{ readonly error?: string | string[] }>;
}

export default async function AccessRoute({ searchParams }: AccessRouteProps) {
  const invalid = (await searchParams).error === "invalid";
  return (
    <main className="page">
      <section className="card narrow">
        <h1>Unlock Local Studio</h1>
        <p>
          This server can access the host shell and filesystem. Enter the operator-provided access
          token to continue.
        </p>
        <form action="/api/auth/session" method="post">
          {invalid ? <p className="error">The access token is invalid.</p> : null}
          <label>
            Access token
            <input
              name="token"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
            />
          </label>
          <button type="submit">Continue</button>
        </form>
      </section>
    </main>
  );
}
