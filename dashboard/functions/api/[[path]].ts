// Proxy /api/* to the API Worker (same-origin for Cloudflare Access cookies)
export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  url.hostname = "wine-cellar-api.rdrake.workers.dev";
  return fetch(new Request(url.toString(), context.request));
};
