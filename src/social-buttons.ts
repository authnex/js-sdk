// AuthNex Social Login Buttons — "Sign in with Google/Microsoft/GitHub"

export interface SocialButtonConfig {
  container: string;
  apiUrl: string;
  tenant: string;
  providers?: ('google' | 'microsoft' | 'github')[];
  redirectUri?: string;
  theme?: 'light' | 'dark';
  onLogin?: (result: { user: any; access_token: string; refresh_token: string; is_new_user: boolean }) => void;
  onError?: (error: Error) => void;
}

const PROVIDER_META: Record<string, { label: string; icon: string; color: string; hoverColor: string }> = {
  google: {
    label: 'Sign in with Google',
    icon: `<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58Z"/></svg>`,
    color: '#ffffff',
    hoverColor: '#f5f5f5',
  },
  microsoft: {
    label: 'Sign in with Microsoft',
    icon: `<svg width="18" height="18" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>`,
    color: '#ffffff',
    hoverColor: '#f5f5f5',
  },
  github: {
    label: 'Sign in with GitHub',
    icon: `<svg width="18" height="18" viewBox="0 0 16 16"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`,
    color: '#24292e',
    hoverColor: '#1b1f23',
  },
};

export class SocialButtons {
  private config: SocialButtonConfig;
  private container: HTMLElement;

  constructor(config: SocialButtonConfig) {
    this.config = {
      providers: ['google', 'microsoft', 'github'],
      theme: 'light',
      ...config,
    };

    const el = document.querySelector(this.config.container);
    if (!el) throw new Error(`Container not found: ${this.config.container}`);
    this.container = el as HTMLElement;

    this.render();
    this.handleCallback();
  }

  private render(): void {
    const isDark = this.config.theme === 'dark';
    const buttons = this.config.providers!.map(provider => {
      const meta = PROVIDER_META[provider];
      if (!meta) return '';
      const isGithub = provider === 'github';
      const bgColor = isDark ? '#2d3748' : (isGithub ? meta.color : '#ffffff');
      const textColor = isDark ? '#e2e8f0' : (isGithub ? '#ffffff' : '#374151');
      const borderColor = isDark ? '#4a5568' : '#d1d5db';

      return `
        <button class="authnex-social-btn" data-provider="${provider}"
          style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:10px 16px;margin-bottom:8px;border:1px solid ${borderColor};border-radius:8px;background:${bgColor};color:${textColor};font-size:14px;font-weight:500;cursor:pointer;transition:background .15s;font-family:inherit">
          ${meta.icon}
          ${meta.label}
        </button>`;
    }).join('');

    this.container.innerHTML = `<div class="authnex-social-buttons">${buttons}</div>`;

    // Bind click events
    this.container.querySelectorAll('.authnex-social-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const provider = (btn as HTMLElement).dataset.provider!;
        this.initiateLogin(provider);
      });
    });
  }

  private initiateLogin(provider: string): void {
    const redirectUri = this.config.redirectUri || `${window.location.origin}/auth/callback`;
    const state = btoa(JSON.stringify({
      provider,
      tenant: this.config.tenant,
      returnTo: window.location.href,
    }));

    const url = `${this.config.apiUrl}/social/${provider}/authorize?` + new URLSearchParams({
      tenant_slug: this.config.tenant,
      redirect_uri: redirectUri,
      state,
    }).toString();

    window.location.href = url;
  }

  private handleCallback(): void {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const stateParam = params.get('state');

    if (!code || !stateParam) return;

    try {
      const state = JSON.parse(atob(stateParam));
      const provider = state.provider;

      if (!provider) return;

      // Exchange code for tokens
      const redirectUri = this.config.redirectUri || `${window.location.origin}/auth/callback`;

      fetch(`${this.config.apiUrl}/social/${provider}/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          redirect_uri: redirectUri,
          tenant_slug: state.tenant || this.config.tenant,
        }),
      })
        .then(res => res.json())
        .then((data: any) => {
          if (data.success && data.data) {
            // Store tokens
            localStorage.setItem('authnex_tokens', JSON.stringify({
              access_token: data.data.access_token,
              refresh_token: data.data.refresh_token,
              expires_at: Date.now() + (data.data.expires_in * 1000),
            }));
            localStorage.setItem('authnex_user', JSON.stringify(data.data.user));

            this.config.onLogin?.(data.data);

            // Clean URL
            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete('code');
            cleanUrl.searchParams.delete('state');
            window.history.replaceState({}, '', cleanUrl.toString());
          } else {
            throw new Error(data.error?.message || 'Social login failed');
          }
        })
        .catch(error => {
          this.config.onError?.(error);
        });
    } catch {
      // Not a valid callback, ignore
    }
  }

  destroy(): void {
    this.container.innerHTML = '';
  }
}

// Global registration
if (typeof window !== 'undefined') {
  (window as any).AuthNexSocial = SocialButtons;
}

export default SocialButtons;
