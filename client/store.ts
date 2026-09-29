// Settings in localStorage. Blocked or full storage must not break the game: settings just aren't remembered.
export const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* full or blocked */ } },
  remove(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
