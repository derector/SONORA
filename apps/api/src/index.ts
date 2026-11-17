import Fastify from "fastify";
import cors from "@fastify/cors";

const app = Fastify({ logger: true, trustProxy: true });
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

await app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(",").map((value) => value.trim()) ?? ["http://localhost:3000"],
  credentials: true
});

app.get("/health", async () => ({
  status: "ok",
  service: "sonora-api",
  timestamp: new Date().toISOString()
}));

app.get("/api/v1", async () => ({
  name: "SONORA API",
  version: "0.1.0",
  status: "foundation",
  endpoints: ["/health"]
}));

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
