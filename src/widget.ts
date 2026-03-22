// AuthNex Login Widget — Drop-in login/register UI component
// Usage: AuthNex.init({ container: '#authnex-login', apiUrl: '...', tenant: '...' })

import { AuthNexApiClient, AuthNexError, LoginResponse, UserData } from './api-client';
import { SocialButtons } from './social-buttons';
import { EventBus, WidgetEvent, WidgetEventMap } from './event-bus';
import { EN, WidgetTranslations } from './translations/en';

// --- Custom Field interface (Phase 3) ---
export interface CustomField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'select' | 'checkbox';
  required?: boolean;
  placeholder?: string;
  options?: string[];
  validation?: RegExp;
  position?: 'before-password' | 'after-password' | 'after-form';
}

export interface WidgetConfig {
  container: string;
  apiUrl: string;
  tenant?: string;
  theme?: 'light' | 'dark';
  logo?: string;
  title?: string;
  showRegister?: boolean;
  showForgotPassword?: boolean;
  showRememberMe?: boolean;
  redirectUrl?: string;
  primaryColor?: string;
  mode?: 'login' | 'register' | 'auto';
  display?: 'inline' | 'modal' | 'redirect';
  socialProviders?: ('google' | 'microsoft' | 'github')[];
  customFields?: CustomField[];
  passwordless?: boolean;
  telemetry?: boolean;
  locale?: string;
  translations?: Partial<WidgetTranslations>;
  onLogin?: (user: UserData, tokens: { access_token: string; refresh_token?: string }) => void;
  onRegister?: (user: UserData) => void;
  onSuccess?: (user: UserData, tokens: { access_token: string; refresh_token?: string }) => void;
  onTokenRefresh?: (tokens: { access_token: string; refresh_token: string }) => void;
  onLogout?: () => void;
  onError?: (error: Error) => void;
  onReady?: () => void;
}

type WidgetView = 'login' | 'register' | 'forgot-password' | 'reset-password' | 'verify-email' | 'magic-link';

const TOKEN_KEY = 'authnex_tokens';
const USER_KEY = 'authnex_user';
const WIDGET_VERSION = '1.0.0';

// --- User-friendly error messages ---
function getErrorMessage(error: AuthNexError, t: WidgetTranslations): string {
  switch (error.code) {
    case 'AUTH_INVALID_CREDENTIALS': return t.invalidCredentials;
    case 'AUTH_ACCOUNT_LOCKED': return t.accountLocked;
    case 'AUTH_EMAIL_NOT_VERIFIED': return t.emailNotVerified;
    case 'AUTH_TENANT_NOT_FOUND': console.error('AuthNex: Tenant not found — check widget config'); return t.configError;
    case 'AUTH_RATE_LIMITED': return error.retryAfter ? t.tooManyAttempts.replace('{seconds}', String(error.retryAfter)) : t.tooManyAttempts.replace('{seconds}s', '');
    case 'AUTH_NETWORK_ERROR': return t.connectionError;
    case 'AUTH_PASSWORD_WEAK': return error.message; // pass through specific requirements
    case 'AUTH_EMAIL_EXISTS': return t.emailExists;
    case 'AUTH_TOKEN_EXPIRED': return '';
    default: return t.unknownError;
  }
}

class AuthNexWidget {
  private config: WidgetConfig;
  private client: AuthNexApiClient;
  private container: HTMLElement;
  private currentView: WidgetView = 'login';
  private refreshTimer?: ReturnType<typeof setInterval>;
  private detectedProviders?: string[];
  private brandingLoaded = false;
  private rateLimitUntil = 0;
  private rateLimitTimer?: ReturnType<typeof setInterval>;
  private onlineListener?: () => void;
  private offlineListener?: () => void;
  private eventBus: EventBus;
  private t: WidgetTranslations;

  constructor(config: WidgetConfig) {
    this.config = {
      theme: 'light',
      showRegister: true,
      showForgotPassword: true,
      showRememberMe: true,
      title: 'Welcome',
      mode: 'auto',
      display: 'inline',
      telemetry: true,
      passwordless: false,
      ...config,
    };

    // Merge translations
    this.t = { ...EN, ...(this.config.translations || {}) };

    this.eventBus = new EventBus();

    // Set initial view based on mode
    if (this.config.mode === 'register') {
      this.currentView = 'register';
    } else if (this.config.passwordless) {
      this.currentView = 'magic-link';
    }

    const el = document.querySelector(this.config.container);
    if (!el) throw new Error(`Container not found: ${this.config.container}`);
    this.container = el as HTMLElement;

    // RTL support
    if (this.config.locale === 'ar' || this.config.locale === 'he') {
      this.container.setAttribute('dir', 'rtl');
    }

    this.client = new AuthNexApiClient({
      apiUrl: this.config.apiUrl,
      tenant: this.config.tenant || el.getAttribute('data-tenant') || '',
    });

    this.injectStyles();
    this.handleOAuthFragment();
    this.handleMagicLinkCallback();

    // Show skeleton first, then load branding
    if (this.config.display === 'modal') {
      this.renderModalWrapper();
    }
    this.renderSkeleton();
    this.initAsync();
  }

  private async initAsync(): Promise<void> {
    // Setup offline/online listeners
    this.offlineListener = () => { this.showBanner(this.t.offline); this.eventBus.emit('offline'); };
    this.onlineListener = () => { this.hideBanner(); this.eventBus.emit('online'); };
    window.addEventListener('offline', this.offlineListener);
    window.addEventListener('online', this.onlineListener);

    // Fetch branding with 2s timeout
    const brandingPromise = this.fetchBranding();
    const timeout = new Promise<void>(r => setTimeout(r, 2000));
    await Promise.race([brandingPromise, timeout]);

    this.brandingLoaded = true;
    this.render();
    this.startAutoRefresh();
    this.fetchSocialProviders();
    this.sendTelemetry('init');

    // Focus first input
    this.focusFirstInput();

    // Fire onReady
    this.config.onReady?.();
    this.eventBus.emit('ready');
  }

  // --- OAuth Fragment (social login callback) ---
  private handleOAuthFragment(): void {
    const hash = window.location.hash;
    if (!hash || !hash.includes('access_token=')) return;

    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const expiresIn = parseInt(params.get('expires_in') || '900', 10);
    const userJson = params.get('user');

    if (!accessToken) return;

    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken || '',
      expires_at: Date.now() + (expiresIn * 1000),
    }));

    let user: UserData | null = null;
    if (userJson) {
      try {
        user = JSON.parse(decodeURIComponent(userJson));
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      } catch {}
    }

    window.history.replaceState({}, '', window.location.pathname + window.location.search);

    if (user) {
      const tokens = { access_token: accessToken, refresh_token: refreshToken || undefined };
      this.config.onLogin?.(user, tokens);
      this.config.onSuccess?.(user, tokens);
      this.eventBus.emit('login', { user, tokens });
    }

    if (this.config.redirectUrl) {
      window.location.href = this.config.redirectUrl;
    }
  }

  // --- Magic Link Callback ---
  private handleMagicLinkCallback(): void {
    const params = new URLSearchParams(window.location.search);
    const magicToken = params.get('magic_token');
    if (!magicToken) return;

    this.client.verifyMagicLink(magicToken).then(result => {
      this.saveTokens(result);
      const user = result.user;
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      const tokens = { access_token: result.access_token, refresh_token: result.refresh_token };
      this.config.onLogin?.(user, tokens);
      this.config.onSuccess?.(user, tokens);
      this.eventBus.emit('login', { user, tokens });
      this.sendTelemetry('login_success');

      // Clean URL
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('magic_token');
      window.history.replaceState({}, '', cleanUrl.toString());

      if (this.config.redirectUrl) {
        window.location.href = this.config.redirectUrl;
      }
    }).catch(err => {
      this.showError(err.message || 'Magic link verification failed');
      this.config.onError?.(err);
    });
  }

  // --- Branding ---
  private async fetchBranding(): Promise<void> {
    const tenant = this.config.tenant || this.container.getAttribute('data-tenant');
    if (!tenant) return;
    try {
      const resp = await fetch(`${this.config.apiUrl}/tenant/${tenant}/branding`);
      if (!resp.ok) return;
      const data = await resp.json();
      const branding = data.data?.branding || data.branding || {};
      if (branding.logo_url && !this.config.logo) this.config.logo = branding.logo_url;
      if (branding.app_name && !this.config.title) this.config.title = branding.app_name;
      if (branding.primary_color && !this.config.primaryColor) this.config.primaryColor = branding.primary_color;
      if (this.config.primaryColor) this.applyBrandingColors(this.config.primaryColor, branding.button_color);
      this.eventBus.emit('branding:loaded', branding);
    } catch {}
  }

  // --- Social Providers ---
  private async fetchSocialProviders(): Promise<void> {
    if (this.config.socialProviders) return;
    const tenant = this.config.tenant || this.container.getAttribute('data-tenant');
    if (!tenant) return;
    try {
      const resp = await fetch(`${this.config.apiUrl}/tenant/${tenant}/social-providers`);
      if (!resp.ok) return;
      const data = await resp.json();
      const providers = data.data?.providers || data.providers || [];
      if (providers.length > 0) {
        this.detectedProviders = providers;
        this.render();
      }
    } catch {}
  }

  private applyBrandingColors(primaryColor: string, buttonColor?: string): void {
    const style = document.getElementById('authnex-branding-vars') || document.createElement('style');
    style.id = 'authnex-branding-vars';
    style.textContent = `.authnex-widget{--authnex-primary:${buttonColor || primaryColor};--authnex-primary-hover:${buttonColor || primaryColor};--authnex-link:${primaryColor}}`;
    if (!style.parentNode) document.head.appendChild(style);
  }

  private getSocialProviders(): ('google' | 'microsoft' | 'github')[] | undefined {
    return this.config.socialProviders || this.detectedProviders as any;
  }

  // --- Telemetry ---
  private sendTelemetry(event: string): void {
    if (!this.config.telemetry) return;
    const tenant = this.config.tenant || this.container.getAttribute('data-tenant') || '';
    this.client.sendTelemetry({
      tenant_slug: tenant,
      widget_version: WIDGET_VERSION,
      event,
      referrer: window.location.origin,
      timestamp: new Date().toISOString(),
    });
  }

  // --- Public API ---

  getUser(): UserData | null {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  getAccessToken(): string | null {
    const tokens = this.getTokens();
    return tokens?.access_token || null;
  }

  isAuthenticated(): boolean {
    return !!this.getAccessToken();
  }

  async logout(): Promise<void> {
    const tokens = this.getTokens();
    if (tokens?.access_token) {
      try { await this.client.logout(tokens.access_token); } catch {}
    }
    this.clearTokens();
    this.config.onLogout?.();
    this.eventBus.emit('logout');
    this.currentView = this.config.passwordless ? 'magic-link' : 'login';
    this.render();
  }

  open(): void {
    if (this.config.display !== 'modal') return;
    const overlay = document.getElementById('authnex-modal-overlay');
    if (overlay) overlay.classList.add('visible');
  }

  close(): void {
    if (this.config.display !== 'modal') return;
    const overlay = document.getElementById('authnex-modal-overlay');
    if (overlay) overlay.classList.remove('visible');
  }

  destroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.rateLimitTimer) clearInterval(this.rateLimitTimer);
    if (this.offlineListener) window.removeEventListener('offline', this.offlineListener);
    if (this.onlineListener) window.removeEventListener('online', this.onlineListener);
    this.eventBus.removeAll();
    this.container.innerHTML = '';
  }

  on<K extends WidgetEvent>(event: K, callback: (data: WidgetEventMap[K]) => void): () => void {
    return this.eventBus.on(event, callback);
  }

  // --- Render ---

  private render(): void {
    const theme = this.config.theme === 'dark' ? ' dark' : '';
    this.eventBus.emit('view:change', this.currentView);
    switch (this.currentView) {
      case 'login': this.renderLogin(theme); break;
      case 'register': this.renderRegister(theme); break;
      case 'forgot-password': this.renderForgotPassword(theme); break;
      case 'magic-link': this.renderMagicLink(theme); break;
      default: this.renderLogin(theme);
    }
    this.focusFirstInput();
  }

  private renderSkeleton(): void {
    const theme = this.config.theme === 'dark' ? ' dark' : '';
    const target = this.getContentTarget();
    target.innerHTML = `
      <div class="authnex-widget${theme}">
        <div class="authnex-skeleton">
          <div class="authnex-skel-circle"></div>
          <div class="authnex-skel-line authnex-skel-title"></div>
          <div class="authnex-skel-line authnex-skel-subtitle"></div>
          <div class="authnex-skel-line authnex-skel-input"></div>
          <div class="authnex-skel-line authnex-skel-input"></div>
          <div class="authnex-skel-line authnex-skel-btn"></div>
        </div>
      </div>`;
  }

  private renderModalWrapper(): void {
    const overlay = document.createElement('div');
    overlay.id = 'authnex-modal-overlay';
    overlay.className = 'authnex-modal-overlay';
    overlay.innerHTML = `<div class="authnex-modal-content" id="authnex-modal-content"></div>`;
    this.container.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });
    // Close on ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  private getContentTarget(): HTMLElement {
    if (this.config.display === 'modal') {
      return document.getElementById('authnex-modal-content') || this.container;
    }
    return this.container;
  }

  private renderSocialSection(): string {
    const providers = this.getSocialProviders();
    if (!providers || providers.length === 0) return '';
    return `<div id="authnex-social-container"></div>
      <div class="authnex-divider"><span>${this.t.orContinueWith}</span></div>`;
  }

  private mountSocialButtons(): void {
    const providers = this.getSocialProviders();
    if (!providers || providers.length === 0) return;
    const socialContainer = document.getElementById('authnex-social-container');
    if (!socialContainer) return;

    const tenant = this.config.tenant || this.container.getAttribute('data-tenant') || '';
    new SocialButtons({
      container: '#authnex-social-container',
      apiUrl: this.config.apiUrl,
      tenant,
      providers,
      redirectUri: window.location.href.split('#')[0],
      theme: this.config.theme,
      onLogin: (result) => {
        const user: UserData = result.user;
        const tokens = { access_token: result.access_token, refresh_token: result.refresh_token };
        this.config.onLogin?.(user, tokens);
        this.config.onSuccess?.(user, tokens);
        this.eventBus.emit('login', { user, tokens });
        this.sendTelemetry('login_success');
        if (this.config.redirectUrl) window.location.href = this.config.redirectUrl;
      },
      onError: (error) => {
        this.showError(error.message || 'Social login failed');
        this.config.onError?.(error);
        this.eventBus.emit('error', error);
      },
    });
  }

  // --- Custom Fields Rendering (Phase 3) ---
  private renderCustomFields(position: string): string {
    if (!this.config.customFields) return '';
    return this.config.customFields
      .filter(f => (f.position || 'after-password') === position)
      .map(f => {
        if (f.type === 'checkbox') {
          return `<div class="authnex-checkbox">
            <input type="checkbox" id="authnex-cf-${f.name}" ${f.required ? 'required' : ''} />
            <label for="authnex-cf-${f.name}">${f.label}</label>
          </div>`;
        }
        if (f.type === 'select') {
          const opts = (f.options || []).map(o => `<option value="${o}">${o}</option>`).join('');
          return `<div class="authnex-form-group">
            <label for="authnex-cf-${f.name}">${f.label}</label>
            <select id="authnex-cf-${f.name}" class="authnex-select" ${f.required ? 'required' : ''}>
              <option value="">${f.placeholder || 'Select...'}</option>${opts}
            </select>
          </div>`;
        }
        return `<div class="authnex-form-group">
          <label for="authnex-cf-${f.name}">${f.label}</label>
          <input type="${f.type}" id="authnex-cf-${f.name}" placeholder="${f.placeholder || ''}" ${f.required ? 'required' : ''} />
        </div>`;
      }).join('');
  }

  private collectCustomFields(): Record<string, any> {
    if (!this.config.customFields) return {};
    const data: Record<string, any> = {};
    for (const f of this.config.customFields) {
      const el = document.getElementById(`authnex-cf-${f.name}`) as HTMLInputElement | HTMLSelectElement;
      if (!el) continue;
      if (f.type === 'checkbox') {
        data[f.name] = (el as HTMLInputElement).checked;
      } else {
        data[f.name] = el.value;
      }
      // Client-side validation
      if (f.validation && f.type !== 'checkbox') {
        if (!f.validation.test(el.value)) {
          this.showError(`Invalid ${f.label}`);
          throw new Error(`Validation failed: ${f.name}`);
        }
      }
    }
    return data;
  }

  // --- View Renderers ---

  private renderLogin(theme: string): void {
    const c = this.config;
    const target = this.getContentTarget();
    target.innerHTML = `
      <div class="authnex-widget${theme}" role="form" aria-label="${this.t.signIn}">
        ${this.renderHeader(this.t.signIn, this.t.signInSubtitle)}
        <div class="authnex-banner" id="authnex-banner" role="status" aria-live="polite"></div>
        ${this.renderSocialSection()}
        <div class="authnex-error" id="authnex-error" role="alert" aria-live="assertive"></div>
        <form id="authnex-login-form" novalidate>
          <div class="authnex-form-group">
            <label for="authnex-email">${this.t.emailLabel}</label>
            <input type="email" id="authnex-email" placeholder="${this.t.emailPlaceholder}" required autocomplete="email" aria-required="true" />
          </div>
          <div class="authnex-form-group">
            <label for="authnex-password">${this.t.passwordLabel}</label>
            <input type="password" id="authnex-password" placeholder="${this.t.passwordPlaceholder}" required autocomplete="current-password" aria-required="true" aria-describedby="authnex-error" />
          </div>
          ${c.showRememberMe ? `
          <div class="authnex-checkbox">
            <input type="checkbox" id="authnex-remember" checked />
            <label for="authnex-remember">${this.t.rememberMe}</label>
          </div>` : ''}
          <button type="submit" class="authnex-btn" id="authnex-submit">${this.t.signInButton}</button>
        </form>
        <div class="authnex-footer">
          ${c.showForgotPassword ? `<a id="authnex-forgot-link" role="button" tabindex="0">${this.t.forgotPassword.toLowerCase().includes('reset') ? this.t.forgotPassword : 'Forgot password?'}</a>` : ''}
          ${c.showRegister ? `<p>${this.t.noAccount} <a id="authnex-register-link" role="button" tabindex="0">${this.t.signUp}</a></p>` : ''}
        </div>
        <div class="authnex-powered">${this.t.securedBy}</div>
      </div>`;
    this.bindLoginEvents();
    this.mountSocialButtons();
  }

  private renderRegister(theme: string): void {
    const target = this.getContentTarget();
    target.innerHTML = `
      <div class="authnex-widget${theme}" role="form" aria-label="${this.t.signUp}">
        ${this.renderHeader(this.t.signUp, this.t.signUpSubtitle)}
        <div class="authnex-banner" id="authnex-banner" role="status" aria-live="polite"></div>
        ${this.renderSocialSection()}
        <div class="authnex-error" id="authnex-error" role="alert" aria-live="assertive"></div>
        <div class="authnex-success" id="authnex-success" role="status" aria-live="polite"></div>
        <form id="authnex-register-form" novalidate>
          <div class="authnex-form-group">
            <label for="authnex-reg-email">${this.t.emailLabel}</label>
            <input type="email" id="authnex-reg-email" placeholder="${this.t.emailPlaceholder}" required autocomplete="email" aria-required="true" />
          </div>
          ${this.renderCustomFields('before-password')}
          <div class="authnex-form-group">
            <label for="authnex-reg-password">${this.t.passwordLabel}</label>
            <input type="password" id="authnex-reg-password" placeholder="Min 8 chars, mixed case + number" required autocomplete="new-password" aria-required="true" />
          </div>
          <div class="authnex-form-group">
            <label for="authnex-reg-confirm">${this.t.confirmPasswordLabel}</label>
            <input type="password" id="authnex-reg-confirm" placeholder="${this.t.confirmPasswordPlaceholder}" required autocomplete="new-password" aria-required="true" aria-describedby="authnex-error" />
          </div>
          ${this.renderCustomFields('after-password')}
          ${this.renderCustomFields('after-form')}
          <button type="submit" class="authnex-btn" id="authnex-submit">${this.t.signUpButton}</button>
        </form>
        <div class="authnex-footer">
          <p>${this.t.hasAccount} <a id="authnex-login-link" role="button" tabindex="0">${this.t.signIn}</a></p>
        </div>
        <div class="authnex-powered">${this.t.securedBy}</div>
      </div>`;
    this.bindRegisterEvents();
    this.mountSocialButtons();
  }

  private renderForgotPassword(theme: string): void {
    const target = this.getContentTarget();
    target.innerHTML = `
      <div class="authnex-widget${theme}" role="form" aria-label="${this.t.forgotPassword}">
        ${this.renderHeader(this.t.forgotPassword, this.t.forgotPasswordSubtitle)}
        <div class="authnex-banner" id="authnex-banner" role="status" aria-live="polite"></div>
        <div class="authnex-error" id="authnex-error" role="alert" aria-live="assertive"></div>
        <div class="authnex-success" id="authnex-success" role="status" aria-live="polite"></div>
        <form id="authnex-forgot-form" novalidate>
          <div class="authnex-form-group">
            <label for="authnex-forgot-email">${this.t.emailLabel}</label>
            <input type="email" id="authnex-forgot-email" placeholder="${this.t.emailPlaceholder}" required autocomplete="email" aria-required="true" />
          </div>
          <button type="submit" class="authnex-btn" id="authnex-submit">${this.t.sendResetLink}</button>
        </form>
        <div class="authnex-footer">
          <a id="authnex-back-login" role="button" tabindex="0">${this.t.backToSignIn}</a>
        </div>
        <div class="authnex-powered">${this.t.securedBy}</div>
      </div>`;
    this.bindForgotEvents();
  }

  private renderMagicLink(theme: string): void {
    const target = this.getContentTarget();
    target.innerHTML = `
      <div class="authnex-widget${theme}" role="form" aria-label="${this.t.signIn}">
        ${this.renderHeader(this.t.signIn, this.t.enterEmail)}
        <div class="authnex-banner" id="authnex-banner" role="status" aria-live="polite"></div>
        <div class="authnex-error" id="authnex-error" role="alert" aria-live="assertive"></div>
        <div class="authnex-success" id="authnex-success" role="status" aria-live="polite"></div>
        <form id="authnex-magic-form" novalidate>
          <div class="authnex-form-group">
            <label for="authnex-magic-email">${this.t.emailLabel}</label>
            <input type="email" id="authnex-magic-email" placeholder="${this.t.emailPlaceholder}" required autocomplete="email" aria-required="true" />
          </div>
          <button type="submit" class="authnex-btn" id="authnex-submit">${this.t.sendLoginLink}</button>
        </form>
        <div class="authnex-powered">${this.t.securedBy}</div>
      </div>`;
    this.bindMagicLinkEvents();
  }

  private renderHeader(title: string, subtitle: string): string {
    return `
      <div class="authnex-header">
        ${this.config.logo ? `<img class="authnex-logo" src="${this.config.logo}" alt="Logo" />` : ''}
        <h2>${this.config.title || title}</h2>
        <p>${subtitle}</p>
      </div>`;
  }

  // --- Event Binding ---

  private bindLoginEvents(): void {
    const form = document.getElementById('authnex-login-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this.isRateLimited()) return;
      this.eventBus.emit('form:submit', 'login');
      const email = (document.getElementById('authnex-email') as HTMLInputElement).value;
      const password = (document.getElementById('authnex-password') as HTMLInputElement).value;
      const remember = (document.getElementById('authnex-remember') as HTMLInputElement)?.checked ?? true;
      await this.handleLogin(email, password, remember);
    });

    document.getElementById('authnex-register-link')?.addEventListener('click', () => {
      this.currentView = 'register';
      this.render();
    });

    document.getElementById('authnex-forgot-link')?.addEventListener('click', () => {
      this.currentView = 'forgot-password';
      this.render();
    });
  }

  private bindRegisterEvents(): void {
    const form = document.getElementById('authnex-register-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this.isRateLimited()) return;
      this.eventBus.emit('form:submit', 'register');
      const email = (document.getElementById('authnex-reg-email') as HTMLInputElement).value;
      const password = (document.getElementById('authnex-reg-password') as HTMLInputElement).value;
      const confirm = (document.getElementById('authnex-reg-confirm') as HTMLInputElement).value;

      if (password !== confirm) {
        this.showError(this.t.passwordsNoMatch);
        return;
      }
      await this.handleRegister(email, password);
    });

    document.getElementById('authnex-login-link')?.addEventListener('click', () => {
      this.currentView = this.config.passwordless ? 'magic-link' : 'login';
      this.render();
    });
  }

  private bindForgotEvents(): void {
    const form = document.getElementById('authnex-forgot-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this.isRateLimited()) return;
      this.eventBus.emit('form:submit', 'forgot-password');
      const email = (document.getElementById('authnex-forgot-email') as HTMLInputElement).value;
      await this.handleForgotPassword(email);
    });

    document.getElementById('authnex-back-login')?.addEventListener('click', () => {
      this.currentView = this.config.passwordless ? 'magic-link' : 'login';
      this.render();
    });
  }

  private bindMagicLinkEvents(): void {
    const form = document.getElementById('authnex-magic-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this.isRateLimited()) return;
      this.eventBus.emit('form:submit', 'magic-link');
      const email = (document.getElementById('authnex-magic-email') as HTMLInputElement).value;
      await this.handleMagicLink(email);
    });
  }

  // --- Action Handlers ---

  private async handleLogin(email: string, password: string, remember: boolean): Promise<void> {
    if (!navigator.onLine) { this.showError(this.t.offline); return; }
    this.setLoading(true);
    this.hideMessages();
    try {
      const result = await this.client.login(email, password, remember);
      this.saveTokens(result);
      const user: UserData = result.user;
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      const tokens = { access_token: result.access_token, refresh_token: result.refresh_token };
      this.config.onLogin?.(user, tokens);
      this.config.onSuccess?.(user, tokens);
      this.eventBus.emit('login', { user, tokens });
      this.sendTelemetry('login_success');
      if (this.config.redirectUrl) window.location.href = this.config.redirectUrl;
    } catch (error: any) {
      this.handleActionError(error);
      this.sendTelemetry('login_fail');
    } finally {
      this.setLoading(false);
    }
  }

  private async handleRegister(email: string, password: string): Promise<void> {
    if (!navigator.onLine) { this.showError(this.t.offline); return; }
    this.setLoading(true);
    this.hideMessages();
    try {
      const metadata = this.collectCustomFields();
      const result = await this.client.register(email, password, Object.keys(metadata).length ? metadata : undefined);
      this.showSuccess(this.t.accountCreated);
      this.config.onRegister?.(result.user);
      this.config.onSuccess?.(result.user, { access_token: '', refresh_token: '' });
      this.eventBus.emit('register', { user: result.user });
      this.sendTelemetry('register_success');
      setTimeout(() => {
        this.currentView = this.config.passwordless ? 'magic-link' : 'login';
        this.render();
      }, 3000);
    } catch (error: any) {
      this.handleActionError(error);
    } finally {
      this.setLoading(false);
    }
  }

  private async handleForgotPassword(email: string): Promise<void> {
    if (!navigator.onLine) { this.showError(this.t.offline); return; }
    this.setLoading(true);
    this.hideMessages();
    try {
      await this.client.forgotPassword(email);
      this.showSuccess(this.t.resetLinkSent);
    } catch (error: any) {
      this.handleActionError(error);
    } finally {
      this.setLoading(false);
    }
  }

  private async handleMagicLink(email: string): Promise<void> {
    if (!navigator.onLine) { this.showError(this.t.offline); return; }
    this.setLoading(true);
    this.hideMessages();
    try {
      await this.client.sendMagicLink(email);
      this.showSuccess(this.t.magicLinkSent);
    } catch (error: any) {
      this.handleActionError(error);
    } finally {
      this.setLoading(false);
    }
  }

  private handleActionError(error: any): void {
    if (error instanceof AuthNexError) {
      // Rate limit countdown
      if (error.code === 'AUTH_RATE_LIMITED' && error.retryAfter) {
        this.startRateLimitCountdown(error.retryAfter);
      }
      // Token expired — silently return to login
      if (error.code === 'AUTH_TOKEN_EXPIRED') {
        this.clearTokens();
        this.currentView = this.config.passwordless ? 'magic-link' : 'login';
        this.render();
        return;
      }
      const msg = getErrorMessage(error, this.t);
      this.showError(msg);
    } else {
      this.showError(error.message || this.t.unknownError);
    }
    this.config.onError?.(error);
    this.eventBus.emit('error', error);
  }

  // --- Rate Limit ---

  private isRateLimited(): boolean {
    return Date.now() < this.rateLimitUntil;
  }

  private startRateLimitCountdown(seconds: number): void {
    this.rateLimitUntil = Date.now() + (seconds * 1000);
    const btn = document.getElementById('authnex-submit') as HTMLButtonElement;
    if (!btn) return;
    btn.disabled = true;

    if (this.rateLimitTimer) clearInterval(this.rateLimitTimer);
    this.rateLimitTimer = setInterval(() => {
      const remaining = Math.ceil((this.rateLimitUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        clearInterval(this.rateLimitTimer!);
        this.rateLimitTimer = undefined;
        btn.disabled = false;
        btn.textContent = btn.dataset.originalText || 'Submit';
        this.hideMessages();
      } else {
        btn.textContent = `Wait ${remaining}s`;
        this.showError(this.t.tooManyAttempts.replace('{seconds}', String(remaining)));
      }
    }, 1000);
  }

  // --- Token Management ---

  private saveTokens(data: LoginResponse): void {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000),
    }));
  }

  private getTokens(): { access_token: string; refresh_token?: string; expires_at: number } | null {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  private clearTokens(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  private startAutoRefresh(): void {
    this.refreshTimer = setInterval(async () => {
      const tokens = this.getTokens();
      if (!tokens?.refresh_token) return;
      if (tokens.expires_at - Date.now() < 60_000) {
        try {
          const result = await this.client.refresh(tokens.refresh_token);
          this.saveTokens(result);
          const refreshed = { access_token: result.access_token, refresh_token: result.refresh_token || tokens.refresh_token };
          this.config.onTokenRefresh?.(refreshed);
          this.eventBus.emit('token:refresh', refreshed);
        } catch {
          this.clearTokens();
          this.currentView = this.config.passwordless ? 'magic-link' : 'login';
          this.render();
        }
      }
    }, 30_000);
  }

  // --- UI Helpers ---

  private showError(msg: string): void {
    const el = document.getElementById('authnex-error');
    if (el) { el.textContent = msg; el.classList.add('visible'); }
  }

  private showSuccess(msg: string): void {
    const el = document.getElementById('authnex-success');
    if (el) { el.textContent = msg; el.classList.add('visible'); }
  }

  private showBanner(msg: string): void {
    const el = document.getElementById('authnex-banner');
    if (el) { el.textContent = msg; el.classList.add('visible'); }
  }

  private hideBanner(): void {
    document.getElementById('authnex-banner')?.classList.remove('visible');
  }

  private hideMessages(): void {
    document.getElementById('authnex-error')?.classList.remove('visible');
    document.getElementById('authnex-success')?.classList.remove('visible');
  }

  private focusFirstInput(): void {
    requestAnimationFrame(() => {
      const input = this.getContentTarget().querySelector('input:not([type=checkbox]):not([type=hidden])') as HTMLInputElement;
      input?.focus();
    });
  }

  private setLoading(loading: boolean): void {
    const btn = document.getElementById('authnex-submit') as HTMLButtonElement;
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent || '';
      btn.innerHTML = '<span class="spinner"></span> Please wait...';
    } else {
      if (!this.isRateLimited()) {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalText || 'Submit';
      }
    }
  }

  private injectStyles(): void {
    if (document.getElementById('authnex-widget-styles')) return;
    const link = document.createElement('style');
    link.id = 'authnex-widget-styles';
    link.textContent = `
      .authnex-widget{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;max-width:400px;margin:0 auto;padding:32px;border-radius:12px;background:var(--authnex-bg,#fff);color:var(--authnex-text,#1a1a2e);box-shadow:0 4px 24px rgba(0,0,0,.1);box-sizing:border-box}
      .authnex-widget *{box-sizing:border-box}
      .authnex-widget.dark{--authnex-bg:#1a1a2e;--authnex-text:#e0e0e0;--authnex-input-bg:#16213e;--authnex-input-border:#0f3460;--authnex-primary:#e94560;--authnex-primary-hover:#c23152;--authnex-link:#53a8ff;--authnex-error-bg:#3a1525;--authnex-error-text:#ff6b6b;--authnex-success-bg:#153a2a;--authnex-success-text:#4ade80}
      .authnex-header{text-align:center;margin-bottom:24px}.authnex-header h2{margin:0 0 4px;font-size:24px;font-weight:700;color:var(--authnex-text,#1a1a2e)}.authnex-header p{margin:0;font-size:14px;color:#6b7280}
      .authnex-logo{width:48px;height:48px;margin:0 auto 12px;display:block}
      .authnex-form-group{margin-bottom:16px}.authnex-form-group label{display:block;margin-bottom:6px;font-size:14px;font-weight:500;color:var(--authnex-text,#374151)}.authnex-form-group input,.authnex-select{width:100%;padding:10px 14px;font-size:14px;border:1px solid var(--authnex-input-border,#d1d5db);border-radius:8px;background:var(--authnex-input-bg,#fff);color:var(--authnex-text,#1a1a2e);outline:none;transition:border-color .2s}.authnex-form-group input:focus,.authnex-select:focus{border-color:var(--authnex-primary,#3b82f6);box-shadow:0 0 0 3px rgba(59,130,246,.15)}
      .authnex-btn{width:100%;padding:12px;font-size:15px;font-weight:600;color:#fff;background:var(--authnex-primary,#3b82f6);border:none;border-radius:8px;cursor:pointer;transition:background .2s,opacity .2s}.authnex-btn:hover{background:var(--authnex-primary-hover,#2563eb)}.authnex-btn:disabled{opacity:.6;cursor:not-allowed}
      .authnex-btn .spinner{display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:authnex-spin .6s linear infinite;vertical-align:middle;margin-right:8px}@keyframes authnex-spin{to{transform:rotate(360deg)}}
      .authnex-error{padding:10px 14px;margin-bottom:16px;font-size:13px;border-radius:8px;background:var(--authnex-error-bg,#fef2f2);color:var(--authnex-error-text,#dc2626);display:none}.authnex-error.visible{display:block}
      .authnex-success{padding:10px 14px;margin-bottom:16px;font-size:13px;border-radius:8px;background:var(--authnex-success-bg,#f0fdf4);color:var(--authnex-success-text,#16a34a);display:none}.authnex-success.visible{display:block}
      .authnex-banner{padding:10px 14px;margin-bottom:16px;font-size:13px;border-radius:8px;background:#fef3c7;color:#92400e;display:none;text-align:center}.authnex-banner.visible{display:block}
      .authnex-footer{text-align:center;margin-top:16px;font-size:13px;color:#6b7280}.authnex-footer a{color:var(--authnex-link,#3b82f6);text-decoration:none;cursor:pointer}.authnex-footer a:hover{text-decoration:underline}
      .authnex-checkbox{display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:13px;color:var(--authnex-text,#374151)}.authnex-checkbox input[type=checkbox]{width:16px;height:16px}
      .authnex-powered{text-align:center;margin-top:20px;font-size:11px;color:#9ca3af}
      .authnex-divider{display:flex;align-items:center;margin:16px 0;gap:12px}.authnex-divider::before,.authnex-divider::after{content:'';flex:1;height:1px;background:var(--authnex-input-border,#d1d5db)}.authnex-divider span{font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px}
      .authnex-skeleton{display:flex;flex-direction:column;align-items:center;gap:16px;padding:16px 0}
      .authnex-skel-circle{width:48px;height:48px;border-radius:50%;background:var(--authnex-input-border,#e5e7eb);animation:authnex-pulse 1.5s ease-in-out infinite}
      .authnex-skel-line{border-radius:6px;background:var(--authnex-input-border,#e5e7eb);animation:authnex-pulse 1.5s ease-in-out infinite}
      .authnex-skel-title{width:50%;height:24px}.authnex-skel-subtitle{width:70%;height:14px}
      .authnex-skel-input{width:100%;height:42px}.authnex-skel-btn{width:100%;height:44px;border-radius:8px}
      @keyframes authnex-pulse{0%,100%{opacity:1}50%{opacity:.4}}
      .authnex-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:10000}.authnex-modal-overlay.visible{display:flex}
      .authnex-modal-content{max-width:440px;width:100%;margin:16px}
      @media(max-width:480px){.authnex-widget{margin:0;border-radius:0;box-shadow:none;padding:24px 16px}}
    `;
    document.head.appendChild(link);
  }
}

// --- Global singleton API ---
let _instance: AuthNexWidget | null = null;
let _eventBusProxy: EventBus | null = null;

const AuthNex = {
  init(config: WidgetConfig): AuthNexWidget {
    if (_instance) _instance.destroy();

    // Redirect mode — don't render, just redirect
    if (config.display === 'redirect') {
      const tenant = config.tenant || '';
      const redirect = config.redirectUrl || window.location.href;
      window.location.href = `https://sdk.authnex.dev/login/?tenant=${encodeURIComponent(tenant)}&redirect=${encodeURIComponent(redirect)}`;
      return null as any;
    }

    _instance = new AuthNexWidget(config);
    return _instance;
  },

  open(): void { _instance?.open(); },
  close(): void { _instance?.close(); },

  on<K extends WidgetEvent>(event: K, callback: (data: WidgetEventMap[K]) => void): () => void {
    if (_instance) return _instance.on(event, callback);
    return () => {};
  },

  onLogin(cb: (user: UserData, tokens: { access_token: string; refresh_token?: string }) => void): void {
    if (_instance) (_instance as any).config.onLogin = cb;
  },

  onRegister(cb: (user: UserData) => void): void {
    if (_instance) (_instance as any).config.onRegister = cb;
  },

  onSuccess(cb: (user: UserData, tokens: { access_token: string; refresh_token?: string }) => void): void {
    if (_instance) (_instance as any).config.onSuccess = cb;
  },

  onTokenRefresh(cb: (tokens: { access_token: string; refresh_token: string }) => void): void {
    if (_instance) (_instance as any).config.onTokenRefresh = cb;
  },

  onLogout(cb: () => void): void {
    if (_instance) (_instance as any).config.onLogout = cb;
  },

  onError(cb: (error: Error) => void): void {
    if (_instance) (_instance as any).config.onError = cb;
  },

  getUser(): UserData | null {
    return _instance?.getUser() || null;
  },

  getAccessToken(): string | null {
    return _instance?.getAccessToken() || null;
  },

  isAuthenticated(): boolean {
    return _instance?.isAuthenticated() || false;
  },

  logout(): Promise<void> {
    return _instance?.logout() || Promise.resolve();
  },

  destroy(): void {
    _instance?.destroy();
    _instance = null;
  },
};

// UMD export for CDN usage
if (typeof window !== 'undefined') {
  (window as any).AuthNex = AuthNex;
}

export { AuthNex, AuthNexWidget, AuthNexError };
export type { WidgetConfig, UserData, CustomField, WidgetTranslations };
