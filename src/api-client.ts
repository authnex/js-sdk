// AuthNex JS API Client — Typed HTTP client for all auth operations

export interface AuthNexConfig {
  apiUrl: string;
  tenant?: string;
  apiKey?: string;
  timeout?: number;
}

export interface LoginResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  user: UserData;
  tenant?: TenantData;
  force_password_reset?: boolean;
}

export interface UserData {
  id: number;
  email: string;
  email_verified?: boolean;
  status?: string;
  metadata?: Record<string, any>;
}

export interface TenantData {
  id: number;
  name: string;
  slug: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// --- Standardized Error Codes ---
export type AuthErrorCode =
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_ACCOUNT_LOCKED'
  | 'AUTH_EMAIL_NOT_VERIFIED'
  | 'AUTH_TENANT_NOT_FOUND'
  | 'AUTH_RATE_LIMITED'
  | 'AUTH_NETWORK_ERROR'
  | 'AUTH_PASSWORD_WEAK'
  | 'AUTH_EMAIL_EXISTS'
  | 'AUTH_TOKEN_EXPIRED'
  | 'AUTH_UNKNOWN';

export class AuthNexError extends Error {
  code: AuthErrorCode;
  status: number;
  retryAfter?: number;

  constructor(message: string, code: AuthErrorCode, status: number, retryAfter?: number) {
    super(message);
    this.name = 'AuthNexError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// Map API error codes/messages to standardized widget codes
function mapErrorCode(apiCode: string | undefined, status: number, message: string): AuthErrorCode {
  if (status === 429) return 'AUTH_RATE_LIMITED';
  if (status === 0) return 'AUTH_NETWORK_ERROR';

  const code = apiCode?.toUpperCase() || '';
  const msg = message.toLowerCase();

  if (code.includes('INVALID_CREDENTIALS') || msg.includes('invalid email') || msg.includes('invalid password') || msg.includes('wrong password')) return 'AUTH_INVALID_CREDENTIALS';
  if (code.includes('ACCOUNT_LOCKED') || msg.includes('account locked') || msg.includes('too many login attempts')) return 'AUTH_ACCOUNT_LOCKED';
  if (code.includes('EMAIL_NOT_VERIFIED') || msg.includes('verify your email') || msg.includes('email not verified')) return 'AUTH_EMAIL_NOT_VERIFIED';
  if (code.includes('TENANT_NOT_FOUND') || msg.includes('tenant not found')) return 'AUTH_TENANT_NOT_FOUND';
  if (code.includes('RATE_LIMIT') || msg.includes('rate limit')) return 'AUTH_RATE_LIMITED';
  if (code.includes('PASSWORD') || msg.includes('password') && (msg.includes('weak') || msg.includes('must') || msg.includes('require'))) return 'AUTH_PASSWORD_WEAK';
  if (code.includes('EMAIL_EXISTS') || msg.includes('already registered') || msg.includes('already exists')) return 'AUTH_EMAIL_EXISTS';
  if (code.includes('TOKEN_EXPIRED') || msg.includes('token expired') || msg.includes('jwt expired')) return 'AUTH_TOKEN_EXPIRED';

  return 'AUTH_UNKNOWN';
}

const DEFAULT_TIMEOUT = 10_000;

export class AuthNexApiClient {
  private apiUrl: string;
  private tenant: string;
  private apiKey?: string;
  private timeout: number;

  constructor(config: AuthNexConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, '');
    this.tenant = config.tenant || '';
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  async login(email: string, password: string, rememberMe = true): Promise<LoginResponse> {
    return this.post<LoginResponse>('/auth/login', {
      email, password, tenant_slug: this.tenant, remember_me: rememberMe,
    });
  }

  async register(email: string, password: string, metadata?: Record<string, any>): Promise<{ user: UserData }> {
    return this.post<{ user: UserData }>('/auth/register', {
      email, password, tenant_slug: this.tenant, metadata,
    });
  }

  async refresh(refreshToken: string): Promise<LoginResponse> {
    return this.post<LoginResponse>('/auth/refresh', { refresh_token: refreshToken });
  }

  async logout(accessToken: string): Promise<void> {
    await this.post('/auth/logout', {}, accessToken);
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    return this.post<{ message: string }>('/auth/verify-email', { token });
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    return this.post<{ message: string }>('/auth/forgot-password', { email });
  }

  async resetPassword(token: string, password: string): Promise<{ message: string }> {
    return this.post<{ message: string }>('/auth/reset-password', { token, password });
  }

  async getProfile(accessToken: string): Promise<{ user: UserData }> {
    return this.get<{ user: UserData }>('/user/profile', accessToken);
  }

  async sendMagicLink(email: string): Promise<{ message: string }> {
    return this.post<{ message: string }>('/auth/magic-link', {
      email, tenant_slug: this.tenant,
    });
  }

  async verifyMagicLink(token: string): Promise<LoginResponse> {
    return this.get<LoginResponse>(`/auth/magic-link/verify?token=${encodeURIComponent(token)}`);
  }

  async sendTelemetry(payload: Record<string, any>): Promise<void> {
    try {
      // Fire-and-forget, don't block on telemetry
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.tenant) headers['X-Tenant-Slug'] = this.tenant;
      fetch(`${this.apiUrl}/widget/telemetry`, {
        method: 'POST', headers, body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {}
  }

  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      return response;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new AuthNexError('Request timed out. Please try again', 'AUTH_NETWORK_ERROR', 0);
      }
      throw new AuthNexError('Connection error. Check your internet', 'AUTH_NETWORK_ERROR', 0);
    } finally {
      clearTimeout(timer);
    }
  }

  private async post<T>(path: string, body: any, bearerToken?: string): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (this.tenant) headers['X-Tenant-Slug'] = this.tenant;
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

    const response = await this.fetchWithTimeout(`${this.apiUrl}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });

    return this.handleResponse<T>(response);
  }

  private async get<T>(path: string, bearerToken?: string): Promise<T> {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (this.tenant) headers['X-Tenant-Slug'] = this.tenant;
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

    const response = await this.fetchWithTimeout(`${this.apiUrl}${path}`, { method: 'GET', headers });
    return this.handleResponse<T>(response);
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    // Parse rate limit header
    const retryAfter = response.headers.get('Retry-After');
    const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : undefined;

    const data: ApiResponse<T> = await response.json();
    if (!data.success || !response.ok) {
      const rawMsg = data.error?.message || `Request failed (${response.status})`;
      const code = mapErrorCode(data.error?.code, response.status, rawMsg);
      throw new AuthNexError(rawMsg, code, response.status, retrySeconds);
    }
    return data.data as T;
  }
}
