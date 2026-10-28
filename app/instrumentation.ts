// Only needed in networks that force outbound traffic through an HTTP proxy (Node's fetch ignores it).
// On a normal machine or on Vercel no proxy variable is set, so this does nothing.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxy) return;
  try {
    const { setGlobalDispatcher, EnvHttpProxyAgent } = await import("undici");
    setGlobalDispatcher(new EnvHttpProxyAgent());
  } catch (e) {
    console.warn("Proxy support could not be enabled:", e instanceof Error ? e.message : e);
  }
}
