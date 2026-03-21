// Proxy /webhook/* to the API Worker
export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  url.hostname = "wine-cellar-api.rdrake.workers.dev";
  return fetch(new Request(url.toString(), context.request));
};
