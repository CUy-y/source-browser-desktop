import fs from "node:fs";

const port = Number(process.argv[2] || 9333);
const outputArg = process.argv[3];
const output = outputArg && !outputArg.startsWith("--") ? outputArg : undefined;
const shouldOpenLogin = process.argv.includes("--open-login");
const deadline = Date.now() + 20_000;
let targets = [];

while (Date.now() < deadline) {
  try {
    targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    if (targets.length) break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const target = targets.find((item) => item.type === "page" && item.url.startsWith("file:"));
if (!target) throw new Error("未找到 Electron 渲染页面");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

await command("Page.enable");
const renderDeadline = Date.now() + 15_000;
while (Date.now() < renderDeadline) {
  const state = await command("Runtime.evaluate", { expression: "document.body?.innerText.length || 0", returnByValue: true });
  if (state.result.value > 0) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
const evaluation = await command("Runtime.evaluate", {
  expression: `({ title: document.title, heading: document.querySelector('h1')?.textContent, loginButton: [...document.querySelectorAll('button')].find((button) => button.textContent.includes('官方登录'))?.textContent, bodyLength: document.body.innerText.length })`,
  returnByValue: true
});
if (output) {
  const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
}

let loginTarget = null;
if (shouldOpenLogin) {
  await command("Runtime.evaluate", { expression: `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('官方登录'))?.click()` });
  const loginDeadline = Date.now() + 20_000;
  while (Date.now() < loginDeadline) {
    const refreshed = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    loginTarget = refreshed.find((item) => item.type === "page" && item.url.startsWith("https://pay.ldxp.cn/merchant")) || null;
    if (loginTarget) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!loginTarget) throw new Error("点击后未打开链动小铺官方登录窗口");
}

console.log(JSON.stringify({
  target: { title: target.title, url: target.url },
  page: evaluation.result.value,
  loginTarget: loginTarget ? { title: loginTarget.title, url: loginTarget.url } : null
}, null, 2));
socket.close();
