import { app, HttpResponseInit, InvocationContext } from '@azure/functions';
import { query } from '../shared/db';
import { getDocumentContainerClient } from '../shared/storage';

function classifyDatabaseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/AZURE_POSTGRESQL_.*not configured/i.test(message)) return 'missing_configuration';
  if (/password authentication failed|28P01/i.test(message)) return 'authentication_failed';
  if (/does not exist|3D000/i.test(message)) return 'database_not_found';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) return 'host_resolution_failed';
  if (/ECONNREFUSED|connection refused/i.test(message)) return 'connection_refused';
  if (/timeout|ETIMEDOUT/i.test(message)) return 'connection_timeout';
  if (/certificate|self[- ]signed|unable to verify/i.test(message)) return 'tls_verification_failed';
  if (/no pg_hba.conf entry|not allowed|firewall/i.test(message)) return 'network_or_firewall';
  return 'connection_failed';
}

async function health(_: unknown, context: InvocationContext): Promise<HttpResponseInit> {
  let database = 'unavailable';
  let storage = 'unavailable';
  let reason: string | null = null;
  let appUsers = false;
  let marketSchema = false;
  let coreTables = false;
  let documentBlobColumn = false;
  let auditLogReady = false;

  try {
    await query('select 1');
    database = 'connected';
    const rows = await query<{ app_users: boolean; kr_schema: boolean; core_tables: boolean; blob_column: boolean; audit_table: boolean }>(
      `select
         exists(select 1 from information_schema.tables where table_schema='public' and table_name='app_users') as app_users,
         exists(select 1 from information_schema.schemata where schema_name='kr') as kr_schema,
         (
           exists(select 1 from information_schema.tables where table_schema='kr' and table_name='products') and
           exists(select 1 from information_schema.tables where table_schema='kr' and table_name='product_classification') and
           exists(select 1 from information_schema.tables where table_schema='kr' and table_name='formula_ingredients') and
           exists(select 1 from information_schema.tables where table_schema='kr' and table_name='safety_assessment')
         ) as core_tables,
         exists(select 1 from information_schema.columns where table_schema='kr' and table_name='product_documents' and column_name='blob_name') as blob_column,
         exists(select 1 from information_schema.tables where table_schema='kr' and table_name='audit_logs') as audit_table`,
    );
    appUsers = !!rows[0]?.app_users;
    marketSchema = !!rows[0]?.kr_schema;
    coreTables = !!rows[0]?.core_tables;
    documentBlobColumn = !!rows[0]?.blob_column;
    auditLogReady = !!rows[0]?.audit_table;
  } catch (error) {
    reason = classifyDatabaseError(error);
    context.error('Database health check failed', error);
  }

  try {
    const container = getDocumentContainerClient();
    await container.createIfNotExists();
    await container.getProperties();
    storage = 'connected';
  } catch (error) {
    context.error('Storage health check failed', error);
  }

  const ready = database === 'connected' && storage === 'connected' && appUsers && marketSchema && coreTables && documentBlobColumn && auditLogReady;
  return {
    status: ready ? 200 : 503,
    jsonBody: {
      service: 'cosmetic-compliance-kr-api',
      status: ready ? 'ready' : 'degraded',
      database,
      storage,
      appUsers,
      marketSchema,
      coreTables,
      documentBlobColumn,
      auditLogReady,
      reason,
      timestamp: new Date().toISOString(),
    },
  };
}

app.http('health', { methods: ['GET'], authLevel: 'anonymous', route: 'health', handler: health });
