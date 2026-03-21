// Proxy /docs/* to the docs Pages project
export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  // Strip /docs prefix — the docs site expects paths from root
  const docsPath = url.pathname.replace(/^\/docs\/?/, "/");
  url.hostname = "wine-cellar-docs.pages.dev";
  url.pathname = docsPath;
  const response = await fetch(new Request(url.toString(), context.request));
  return new Response(response.body, response);
};
