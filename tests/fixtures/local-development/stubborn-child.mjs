import { createServer } from "node:net";

process.on("SIGINT", () => {});
process.on("SIGTERM", () => {});

const server = createServer();
server.once("error", (error) => {
  process.stdout.write(`ERROR:${error.code}\n`);
  process.exitCode = 1;
});
server.listen(Number(process.argv[2] ?? 0), "127.0.0.1", () => {
  const ready = { pid: process.pid, port: server.address().port };
  if (process.send) process.send(ready);
  else process.stdout.write(`${ready.port}\n`);
});
