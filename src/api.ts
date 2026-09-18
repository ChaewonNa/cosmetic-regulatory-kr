export type ApiError = { message: string };
export type ApiResult<T> = { data: T; error: ApiError | null; count?: number | null };
export type Filter = { op?: 'eq' | 'in' | 'is'; column: string; value: unknown };
export type Order = { column: string; ascending?: boolean };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export async function getMe() {
  return request<{
    id: string;
    email: string;
    fullName: string | null;
    role: 'admin' | 'ra' | 'customer';
    companyName: string | null;
    businessRegistrationNumber: string | null;
    jobTitle: string | null;
    phone: string | null;
    disabled: boolean;
  }>('/api/me');
}

export async function dataSelect<T = any>(
  table: string,
  options: {
    columns?: string;
    filters?: Filter[];
    orders?: Order[];
    limit?: number;
    single?: boolean;
    count?: string;
    head?: boolean;
  } = {},
): Promise<ApiResult<T>> {
  try {
    const body = await request<{ data: T; error: null; count?: number | null }>('/api/data', {
      method: 'POST',
      body: JSON.stringify({ table, action: 'select', ...options }),
    });
    return { data: body.data, error: null, count: body.count ?? null };
  } catch (error) {
    return { data: null as T, error: { message: error instanceof Error ? error.message : 'Request failed' } };
  }
}

export async function dataInsert<T = any>(table: string, payload: unknown, single = true): Promise<ApiResult<T>> {
  try {
    const body = await request<{ data: T; error: null }>('/api/data', {
      method: 'POST',
      body: JSON.stringify({ table, action: 'insert', payload, single }),
    });
    return { data: body.data, error: null };
  } catch (error) {
    return { data: null as T, error: { message: error instanceof Error ? error.message : 'Insert failed' } };
  }
}

export async function dataUpdate<T = any>(table: string, payload: unknown, filters: Filter[], single = true): Promise<ApiResult<T>> {
  try {
    const body = await request<{ data: T; error: null }>('/api/data', {
      method: 'POST',
      body: JSON.stringify({ table, action: 'update', payload, filters, single }),
    });
    return { data: body.data, error: null };
  } catch (error) {
    return { data: null as T, error: { message: error instanceof Error ? error.message : 'Update failed' } };
  }
}

export async function dataDelete<T = any>(table: string, filters: Filter[], single = false): Promise<ApiResult<T>> {
  try {
    const body = await request<{ data: T; error: null }>('/api/data', {
      method: 'POST',
      body: JSON.stringify({ table, action: 'delete', filters, single }),
    });
    return { data: body.data, error: null };
  } catch (error) {
    return { data: null as T, error: { message: error instanceof Error ? error.message : 'Delete failed' } };
  }
}

export const eq = (column: string, value: unknown): Filter => ({ op: 'eq', column, value });
