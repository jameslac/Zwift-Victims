export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle same-origin /api/* routes for Zwift, ZwiftPower, and ZwiftRacing
    if (url.pathname === '/api/health') {
      return new Response(
        JSON.stringify({
          status: 'Online',
          service: 'zwift-victims-worker',
          timestamp: new Date().toISOString(),
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Fallback to serving the static React PWA assets
    return env.ASSETS.fetch(request);
  },
};
