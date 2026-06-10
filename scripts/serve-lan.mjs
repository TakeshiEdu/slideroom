import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.argv[2] || 5175);
const root = path.resolve(process.cwd(), "dist");
const dataRoot = path.resolve(process.cwd(), "local-server-data");
const uploadsRoot = path.join(dataRoot, "uploads");
const statePath = path.join(dataRoot, "state.json");
const maxUploadBytes = 300 * 1024 * 1024;
const roomTtlMs = 24 * 60 * 60 * 1000;

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".json", "application/json; charset=utf-8"],
]);

fs.mkdirSync(uploadsRoot, { recursive: true });

function sendFile(response, filePath) {
  response.setHeader("Content-Type", mimeTypes.get(path.extname(filePath)) || "application/octet-stream");
  fs.createReadStream(filePath).pipe(response);
}

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function setApiHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function safeStorageKey(rawKey) {
  const key = decodeURIComponent(rawKey || "");
  if (!/^[A-Za-z0-9._-]+$/.test(key)) return null;
  return key;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxUploadBytes) {
        reject(new Error("Payload too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function getRoomCreatedAt(room) {
  const timestamp = Date.parse(room?.createdAt || room?.updatedAt || "");
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

function deleteUpload(storageKey) {
  if (!storageKey || !/^[A-Za-z0-9._-]+$/.test(storageKey)) return;
  const filePath = path.join(uploadsRoot, storageKey);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function purgeExpiredRooms(state) {
  const rooms = Array.isArray(state?.rooms) ? state.rooms : [];
  const expiredRoomIds = new Set(
    rooms
      .filter((room) => Date.now() - getRoomCreatedAt(room) >= roomTtlMs)
      .map((room) => room.id),
  );

  if (expiredRoomIds.size === 0) return state;

  const expiredFiles = (state.files || []).filter((file) => expiredRoomIds.has(file.roomId));
  expiredFiles.forEach((file) => deleteUpload(file.storageKey));

  const nextState = {
    ...state,
    rooms: (state.rooms || []).filter((room) => !expiredRoomIds.has(room.id)),
    members: (state.members || []).filter((member) => !expiredRoomIds.has(member.roomId)),
    files: (state.files || []).filter((file) => !expiredRoomIds.has(file.roomId)),
    slides: (state.slides || []).filter((slide) => !expiredRoomIds.has(slide.roomId)),
    exportRecords: (state.exportRecords || []).filter((record) => !expiredRoomIds.has(record.roomId)),
  };
  return nextState;
}

function readStatePayload() {
  if (!fs.existsSync(statePath)) return { initialized: false, state: null };
  const payload = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (!payload?.initialized || !payload.state) return { initialized: false, state: null };
  const state = purgeExpiredRooms(payload.state);
  const nextPayload = { initialized: true, updatedAt: new Date().toISOString(), state };
  fs.writeFileSync(statePath, JSON.stringify(nextPayload, null, 2));
  return nextPayload;
}

async function handleApi(request, response, url) {
  setApiHeaders(response);
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return true;
  }

  if (url.pathname === "/api/info" && request.method === "GET") {
    sendJson(response, 200, { ok: true, port, roomTtlHours: 24 });
    return true;
  }

  if (url.pathname === "/api/state" && request.method === "GET") {
    sendJson(response, 200, readStatePayload());
    return true;
  }

  if (url.pathname === "/api/state" && request.method === "PUT") {
    try {
      const body = await readRequestBody(request);
      const parsed = JSON.parse(body.toString("utf8"));
      const cleaned = purgeExpiredRooms(parsed);
      fs.mkdirSync(dataRoot, { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify({ initialized: true, updatedAt: new Date().toISOString(), state: cleaned }, null, 2));
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith("/api/blob/")) {
    const key = safeStorageKey(url.pathname.slice("/api/blob/".length));
    if (!key) {
      sendJson(response, 400, { ok: false, error: "Invalid storage key" });
      return true;
    }
    const filePath = path.join(uploadsRoot, key);

    if (request.method === "GET") {
      if (!fs.existsSync(filePath)) {
        sendJson(response, 404, { ok: false, error: "Blob not found" });
        return true;
      }
      response.setHeader("Content-Type", "application/octet-stream");
      fs.createReadStream(filePath).pipe(response);
      return true;
    }

    if (request.method === "POST") {
      try {
        const body = await readRequestBody(request);
        fs.writeFileSync(filePath, body);
        sendJson(response, 200, { ok: true, key, size: body.length });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }

    if (request.method === "DELETE") {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  return false;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/") && await handleApi(request, response, url)) return;

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  let filePath = path.join(root, pathname);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(root, "index.html");
  }

  sendFile(response, filePath);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`SlideRoom LAN preview: http://0.0.0.0:${port}/`);
});
