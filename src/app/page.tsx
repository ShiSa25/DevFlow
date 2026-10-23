import { getHealthSnapshot } from "@/health/snapshot";

export default function Home() {
  const health = getHealthSnapshot();

  return (
    <main>
      <h1>DevFlow</h1>
      <p>Application scaffold is running.</p>
      <dl>
        <dt>Status</dt>
        <dd>{health.status}</dd>
        <dt>Database</dt>
        <dd>{health.database}</dd>
      </dl>
    </main>
  );
}
