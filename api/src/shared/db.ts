import { Pool, PoolConfig, QueryResultRow } from 'pg';

let pool: Pool | undefined;

function missingSetting(name: string): never {
  throw new Error(`${name} is not configured`);
}

function databaseConfig(): PoolConfig {
  const connectionString = process.env.AZURE_POSTGRESQL_CONNECTION_STRING;
  if (connectionString) {
    return {
      connectionString,
      ssl: { rejectUnauthorized: true },
      max: 5,
    };
  }

  const host = process.env.AZURE_POSTGRESQL_HOST;
  const database = process.env.AZURE_POSTGRESQL_DATABASE;
  const user = process.env.AZURE_POSTGRESQL_USER;
  const password = process.env.AZURE_POSTGRESQL_PASSWORD;
  const port = Number(process.env.AZURE_POSTGRESQL_PORT ?? '5432');

  if (!host) missingSetting('AZURE_POSTGRESQL_HOST');
  if (!database) missingSetting('AZURE_POSTGRESQL_DATABASE');
  if (!user) missingSetting('AZURE_POSTGRESQL_USER');
  if (!password) missingSetting('AZURE_POSTGRESQL_PASSWORD');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('AZURE_POSTGRESQL_PORT must be a valid TCP port');
  }

  return {
    host,
    port,
    database,
    user,
    password,
    ssl: { rejectUnauthorized: true },
    max: 5,
  };
}

export function getDb(): Pool {
  if (!pool) {
    pool = new Pool(databaseConfig());
  }
  return pool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await getDb().query<T>(text, values);
  return result.rows;
}
