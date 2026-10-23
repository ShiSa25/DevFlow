export type HealthSnapshot = {
  status: "ok";
  database: "not contacted";
};

export function getHealthSnapshot(): HealthSnapshot {
  return {
    status: "ok",
    database: "not contacted",
  };
}
