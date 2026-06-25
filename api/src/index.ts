import Fastify from "fastify";
import { authRoutes } from "./routes/auth";
import { profileRoutes } from "./routes/profile";
import { gamesRoutes } from "./routes/games";
import { artifactsRoutes } from "./routes/artifacts";
import { imagesRoutes } from "./routes/images";
import { webRoutes } from "./routes/web";
import { friendsRoutes } from "./routes/friends";

const app = Fastify({ logger: true });

app.addContentTypeParser("application/tar", { parseAs: "buffer" }, (_req, body, done) => {
  done(null, body);
});
app.addContentTypeParser(/^image\//, { parseAs: "buffer" }, (_req, body, done) => {
  done(null, body);
});
app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) => {
  done(null, body);
});
app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
  done(null, {});
});

app.register(authRoutes);
app.register(profileRoutes);
app.register(gamesRoutes);
app.register(artifactsRoutes);
app.register(imagesRoutes);
app.register(webRoutes);
app.register(friendsRoutes);

app.get("/health", async () => ({ status: "ok" }));

const port = parseInt(process.env.PORT ?? "3000", 10);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
