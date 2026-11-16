import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";

const SECRET = "rate-limit-test-secret";
jest.mock("../../config", () => ({ secrets: { JWT_SECRET: "rate-limit-test-secret" } }));

import { apiLimiter, API_LIMIT_PER_IP, API_LIMIT_PER_USER } from "../rateLimit";

const tokenFor = (userId: string, secret = SECRET): string =>
  jwt.sign({ userId, userLogin: userId, displayName: userId }, secret, {
    issuer: "chatvibes-auth",
    audience: "chatvibes-api",
    expiresIn: "1h",
  });

// The limiter keeps its counts in memory for the life of the module, so each
// test uses user IDs and addresses of its own.
const app = express();
app.set("trust proxy", true);
app.use("/api", apiLimiter);
app.get("/api/ping", (_req, res) => res.json({ ok: true }));

const send = (opts: { token?: string; ip: string }) => {
  const req = request(app).get("/api/ping").set("X-Forwarded-For", opts.ip);
  return opts.token ? req.set("Authorization", `Bearer ${opts.token}`) : req;
};

async function sendMany(count: number, opts: { token?: string; ip: string }): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < count; i++) statuses.push((await send(opts)).status);
  return statuses;
}

describe("apiLimiter", () => {
  it("gives a signed-in user the per-user limit, not the per-address one", async () => {
    const statuses = await sendMany(API_LIMIT_PER_USER + 1, { token: tokenFor("user-a"), ip: "198.51.100.1" });
    expect(statuses.slice(0, API_LIMIT_PER_USER).every(s => s === 200)).toBe(true);
    expect(statuses[API_LIMIT_PER_USER]).toBe(429);
  });

  it("keeps one bucket per user, also behind one address", async () => {
    const ip = "198.51.100.2";
    await sendMany(API_LIMIT_PER_USER, { token: tokenFor("user-b"), ip });
    expect((await send({ token: tokenFor("user-b"), ip })).status).toBe(429);
    expect((await send({ token: tokenFor("user-c"), ip })).status).toBe(200);
    // The user's requests did not use up the bucket of the address.
    expect((await send({ ip })).status).toBe(200);
  });

  it("counts a request without a token against its address", async () => {
    const statuses = await sendMany(API_LIMIT_PER_IP + 1, { ip: "198.51.100.3" });
    expect(statuses[API_LIMIT_PER_IP - 1]).toBe(200);
    expect(statuses[API_LIMIT_PER_IP]).toBe(429);
  });

  it("counts a token with a bad signature against its address", async () => {
    const forged = (n: number) => tokenFor(`forged-${n}`, "not-the-secret");
    const ip = "198.51.100.4";
    for (let i = 0; i < API_LIMIT_PER_IP; i++) await send({ token: forged(i), ip });
    expect((await send({ token: forged(API_LIMIT_PER_IP), ip })).status).toBe(429);
  });
});
