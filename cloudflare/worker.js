// Cloudflare Worker in front of the game: serves the website from Cloudflare and forwards multiplayer
// connections to the game server (ORIGIN_URL), so players only ever talk to Cloudflare.
// The shared ORIGIN_SECRET proves to the game server that a connection came through here.
//   ORIGIN_URL     plain var in wrangler.jsonc: the game server's Cloudflare Tunnel address, e.g. https://game.<domain>
//   ORIGIN_SECRET  secret: npx wrangler secret put ORIGIN_SECRET (the same value as on the game server)
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isSocket = (request.headers.get('upgrade') || '').toLowerCase() === 'websocket';
    if (isSocket || url.pathname === '/health') {
      if (!env.ORIGIN_URL || !env.ORIGIN_SECRET) return new Response('Game server not configured', { status: 503 });
      const headers = new Headers(request.headers);
      headers.set('x-poxel-secret', env.ORIGIN_SECRET);
      headers.set('x-poxel-client-ip', request.headers.get('cf-connecting-ip') || '');
      const target = new URL(url.pathname + url.search, env.ORIGIN_URL);
      try {
        return await fetch(target, { method: request.method, headers });
      } catch {
        return new Response('Game server is offline', { status: 502 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
