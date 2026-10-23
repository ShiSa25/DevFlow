export type EnvSource = {
  DATABASE_URL?: string;
};

export function readDatabaseUrl(env?: EnvSource): string | undefined {
  const value = (env ? env.DATABASE_URL : process.env.DATABASE_URL)?.trim();
  if (!value) {
    return undefined;
  }
  return value;
}
