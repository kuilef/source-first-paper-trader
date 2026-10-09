import { createProxyHandler, type CacheLike, type ProxyEnvironment } from './proxy';

// Cache lookup is inside fetch because runtime bindings are request-scoped.
export default {
  fetch(request: Request, env: ProxyEnvironment): Promise<Response> {
    const edgeCache = (globalThis.caches as CacheStorage & { default: CacheLike }).default;
    return createProxyHandler({ cache: edgeCache })(request, env);
  },
};
