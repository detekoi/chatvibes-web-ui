import express from "express";
import request from "supertest";
import { trustCloudRunProxies } from "../trustProxy";

describe("trustCloudRunProxies", () => {
  // Under supertest the socket peer is loopback, standing in for Cloud Run's front end.
  const ipFor = async (xff?: string): Promise<string> => {
    const app = express();
    app.set("trust proxy", trustCloudRunProxies);
    app.get("/", (req, res) => res.json({ ip: req.ip }));
    const req = request(app).get("/");
    return (await (xff === undefined ? req : req.set("X-Forwarded-For", xff))).body.ip;
  };

  it("takes the client from a Firebase Hosting chain", async () => {
    expect(await ipFor("198.51.100.7, 66.249.84.137")).toBe("198.51.100.7");
    expect(await ipFor("198.51.100.7, 74.125.209.166")).toBe("198.51.100.7");
  });

  it("takes the address Cloud Run saw on the function URL", async () => {
    expect(await ipFor("198.51.100.7")).toBe("198.51.100.7");
  });

  it("ignores entries a client forges on the function URL, even ones that look like Hosting", async () => {
    expect(await ipFor("203.0.113.9, 198.51.100.7")).toBe("198.51.100.7");
    expect(await ipFor("203.0.113.9, 66.249.84.1, 198.51.100.7")).toBe("198.51.100.7");
  });

  it("never looks past the Hosting hop", async () => {
    expect(await ipFor("203.0.113.9, 66.249.84.1, 74.125.209.166")).toBe("66.249.84.1");
  });

  it("falls back to the socket peer without X-Forwarded-For", async () => {
    expect(await ipFor()).toMatch(/127\.0\.0\.1$/);
  });

  it.each([
    ["Hosting egress", "66.249.84.137", 1, true],
    ["IPv4-mapped Hosting egress", "::ffff:66.249.84.137", 1, true],
    ["Google Cloud customer address", "35.192.0.1", 1, false],
    ["ordinary client", "198.51.100.7", 1, false],
    ["IPv6 address", "2001:4860::1", 1, false],
    ["malformed entry", "not-an-ip", 1, false],
    ["Hosting egress beyond the first hop", "66.249.84.137", 2, false],
  ])("trusts a %s: %s at hop %d -> %s", (_label, addr, hop, trusted) => {
    expect(trustCloudRunProxies(addr as string, hop as number)).toBe(trusted);
  });
});
