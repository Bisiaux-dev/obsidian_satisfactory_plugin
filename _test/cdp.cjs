/**
 * Client CDP : connexion WebSocket au endpoint Chrome DevTools d'Obsidian
 * (lancé avec --remote-debugging-port). Adapté du harness obsidian-lore-graph,
 * enrichi de `screenshot()` et `drag()` (events souris réels via CDP) pour
 * tester le rendu React Flow et le write-back au drop du plugin Satisfactory.
 */
const http = require("http");
const fs = require("fs");
const WebSocket = require("ws");

const PORT = Number(process.env.CDP_PORT || 9222);

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(3000, () => req.destroy(new Error("timeout")));
  });
}

async function findTarget() {
  const targets = await fetchJson(`http://localhost:${PORT}/json/list`);
  // La page principale d'Obsidian (pas les devtools ni les iframes vides).
  const page = targets.find(
    (t) => t.type === "page" && !t.url.startsWith("devtools://") && t.url.startsWith("app://"),
  ) || targets.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
  if (!page) throw new Error("aucune page Obsidian trouvée sur le CDP");
  return page;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Se connecte à Obsidian et renvoie { evalJS, send, screenshot, drag, close, target }.
 */
async function connect() {
  const target = await findTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  });

  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  function send(method, params = {}) {
    const id = ++msgId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send("Runtime.enable");
  await send("Page.enable");

  async function evalJS(expression) {
    const res = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(
        "eval exception: " +
          (res.exceptionDetails.exception?.description || res.exceptionDetails.text),
      );
    }
    return res.result?.value;
  }

  async function screenshot(filePath) {
    const res = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(filePath, Buffer.from(res.data, "base64"));
    return filePath;
  }

  // Drag souris réel (CDP Input) : mousePressed → moves → mouseReleased.
  // Pauses généreuses : React Flow capture le pointer au mousedown puis suit les
  // pointermove ; un drag trop rapide rate parfois la capture.
  async function drag(x1, y1, x2, y2, steps = 12) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y: y1 });
    await sleep(40);
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: x1, y: y1, button: "left", buttons: 1, clickCount: 1,
    });
    await sleep(80);
    for (let i = 1; i <= steps; i++) {
      const x = x1 + ((x2 - x1) * i) / steps;
      const y = y1 + ((y2 - y1) * i) / steps;
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
      await sleep(25);
    }
    await sleep(60);
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: x2, y: y2, button: "left", buttons: 0, clickCount: 1,
    });
  }

  return { evalJS, send, screenshot, drag, close: () => ws.close(), target };
}

module.exports = { connect, sleep, PORT };
