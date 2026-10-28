import { setGlobalDispatcher, EnvHttpProxyAgent } from "undici";

export function register() {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
