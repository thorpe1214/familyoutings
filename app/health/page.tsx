export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HealthPage() {
  const payload = {
    ok: true,
    timestamp: new Date().toISOString(),
  } as const;

  return (
    <main style={{ padding: 20, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Health</h1>
      <pre style={{ background: "#f5f5f5", padding: 12, borderRadius: 6 }}>
        {JSON.stringify(payload, null, 2)}
      </pre>
      <p style={{ marginTop: 8 }}>
        API: <a href="/api/health" style={{ color: "#2563eb" }}>/api/health</a>
      </p>
    </main>
  );
}

