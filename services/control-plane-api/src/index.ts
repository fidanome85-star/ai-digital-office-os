import { loadAuthConfigFromEnv } from "@ai-office/auth";
import { createApp } from "./app.js";

const port = Number(process.env["PORT"] ?? 3000);
const app = createApp(loadAuthConfigFromEnv());

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`control-plane-api listening on :${port}`);
});
