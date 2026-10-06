/**
 * Jest setup — runs in each test worker process BEFORE any test file.
 * Ensures FIRESTORE_EMULATOR_HOST is set so that both firebase-admin
 * (in testHelpers) and @google-cloud/firestore (in services/firestore)
 * connect to the emulator instead of production.
 */
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "test-project";
process.env.FUNCTIONS_EMULATOR = "true";
process.env.USE_ENV_SECRETS = "1";

// Non-secret OAuth config. appHelper.ts sets the same values with `||`
// defaults; these cover suites that mount a router directly instead.
process.env.CALLBACK_URL = process.env.CALLBACK_URL || "http://localhost:5001/test-project/us-central1/webUi/auth/twitch/callback";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5002";

// Bind supertest's per-request server to 127.0.0.1.
//
// supertest starts the app with `listen(0)`, which binds every interface, then
// connects to 127.0.0.1:<port>. On macOS another process can hold 127.0.0.1 on
// that same port, and its more specific bind takes the connection, so a test
// gets a response from an unrelated local server. Binding to 127.0.0.1 makes the
// OS pick a port that is free there. Passing a host makes listen() asynchronous,
// so the real port is filled in once the server is listening. Until then the URL
// carries port 0, because request.agent() parses it as soon as the request is
// created.
const {Test} = require("supertest");

const LOOPBACK = "127.0.0.1";
const serverAddress = Test.prototype.serverAddress;
const end = Test.prototype.end;
Test.prototype.serverAddress = function(app, path) {
  if (app.address()) return serverAddress.call(this, app, path);
  this._server = app.listen(0, LOOPBACK);
  this._loopbackPath = path;
  return `http://${LOOPBACK}:0${path}`;
};
Test.prototype.end = function(fn) {
  const server = this._server;
  const path = this._loopbackPath;
  if (!server || path === undefined) return end.call(this, fn);
  this._loopbackPath = undefined;
  const send = () => {
    this.url = `http://${LOOPBACK}:${server.address().port}${path}`;
    end.call(this, fn);
  };
  if (server.listening) send();
  else {
    server.once("listening", send);
    server.once("error", (err) => fn && fn(err));
  }
  return this;
};
