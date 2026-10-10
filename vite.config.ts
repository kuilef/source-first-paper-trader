import { defineConfig } from "vitest/config";
import { createProxyHandler } from "./worker/proxy.ts";
export default defineConfig({
  plugins: [
    {
      name: "embedded-project-branding",
      configureServer(server) {
        const handle = createProxyHandler();
        server.middlewares.use(async (request, response, next) => {
          const url = new URL(request.url ?? "/", "http://127.0.0.1");
          if (!["/logo.png", "/favicon.ico"].includes(url.pathname))
            return next();
          try {
            const result = await handle(
              new Request(url, { method: request.method }),
            );
            response.statusCode = result.status;
            result.headers.forEach((value, name) =>
              response.setHeader(name, value),
            );
            response.end(Buffer.from(await result.arrayBuffer()));
          } catch (error) {
            next(error);
          }
        });
      },
    },
  ],
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
  },
  server: { port: 4173 },
  build: { target: "es2022" },
});
