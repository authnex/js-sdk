// AuthNex Event Bus — Simple pub/sub for widget events

export type WidgetEventMap = {
  'view:change': string;
  'branding:loaded': Record<string, any>;
  'social:click': string;
  'form:submit': string;
  'error': Error;
  'token:refresh': { access_token: string; refresh_token: string };
  'login': { user: any; tokens: any };
  'register': { user: any };
  'logout': void;
  'ready': void;
  'offline': void;
  'online': void;
};

export type WidgetEvent = keyof WidgetEventMap;

type Listener<T> = (data: T) => void;

export class EventBus {
  private listeners: Map<string, Set<Listener<any>>> = new Map();

  on<K extends WidgetEvent>(event: K, callback: Listener<WidgetEventMap[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    // Return unsubscribe function
    return () => this.off(event, callback);
  }

  off<K extends WidgetEvent>(event: K, callback: Listener<WidgetEventMap[K]>): void {
    this.listeners.get(event)?.delete(callback);
  }

  emit<K extends WidgetEvent>(event: K, data?: WidgetEventMap[K]): void {
    this.listeners.get(event)?.forEach(cb => {
      try { cb(data as any); } catch {}
    });
  }

  removeAll(): void {
    this.listeners.clear();
  }
}
