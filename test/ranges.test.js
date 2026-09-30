const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "rules.js"), "utf8"), context);
const { expandDomainInput, buildConfig } = context;

test("plain domains still normalize and numbered ranges expand inclusively", () => {
  assert.deepEqual(Array.from(expandDomainInput(" DOCS.EXAMPLE.COM ")), ["docs.example.com"]);
  const hosts = Array.from(expandDomainInput(" APP-{1..49}.EXAMPLE.COM "));
  assert.equal(hosts.length, 49);
  for (let number = 1; number <= 49; number++) {
    assert.ok(hosts.includes(`app-${number}.example.com`));
  }
  assert.deepEqual(Array.from(expandDomainInput("app-{7..7}.example.com")), ["app-7.example.com"]);
});

test("pasted website URLs keep only their hostname, including URLs longer than 253 characters", () => {
  for (const input of [
    "https://docs.example.com/", " HTTP://DOCS.EXAMPLE.COM/guide ",
    "https://docs.example.com:8443/guide?q=setup#install",
    "https://docs.example.com/{1..49}?filter={value}#section",
    `https://docs.example.com/guide?q=${"x".repeat(500)}`,
  ]) {
    assert.deepEqual(Array.from(expandDomainInput(input)), ["docs.example.com"], input);
  }
});

test("pasted URLs support ranges in the hostname", () => {
  assert.deepEqual(
    Array.from(expandDomainInput("https://app-{1..49}.example.com:8443/guide?q=setup#install")),
    Array.from(expandDomainInput("app-{1..49}.example.com")),
  );
});

test("URL input rejects unsupported schemes, credentials, malformed hosts and IPs", () => {
  for (const input of [
    "ftp://docs.example.com/file", "file:///tmp/example.html", "javascript:alert(1)",
    "chrome://extensions", "https://user:password@docs.example.com/",
    "https://docs.example.com@other.example.com/", "https://", "https://bad host.example.com/",
    "https://docs.example.com:invalid/", "https://*.example.com/",
    "https://127.0.0.1/", "http://[::1]/",
  ]) {
    assert.throws(() => expandDomainInput(input), undefined, input);
  }
});

test("expanded ranges keep other numbers, zero-padded names and lookalikes blocked", () => {
  const config = buildConfig(expandDomainInput("app-{1..49}.example.com"));
  const findProxy = new Function("dnsDomainIs", `${config.pacScript.data}; return FindProxyForURL;`)((host, suffix) => host.endsWith(suffix));
  for (const host of ["app-1.example.com", "app-15.example.com", "app-49.example.com", "api.app-15.example.com"]) {
    assert.equal(findProxy(`https://${host}/`, host), "DIRECT", host);
  }
  for (const host of ["app-0.example.com", "app-50.example.com", "app-149.example.com", "app-01.example.com", "app-prod.example.com", "other-15.example.com", "app-15.example.com.evil.com"]) {
    assert.equal(findProxy(`https://${host}/`, host), "HTTPS 127.0.0.1:9", host);
  }
});

test("range input rejects broad patterns, invalid domains and unbounded expansion", () => {
  for (const input of [
    "app-*.example.com", "app-{49..1}.example.com", "app-{1..101}.example.com",
    "app-{01..49}.example.com", "app-{1..049}.example.com", "app-{-1..49}.example.com",
    "app-{1.5..49}.example.com", "app-{1..2}-{3..4}.example.com", "app-{1..2.example.com",
    "app-{9007199254740992..9007199254740992}.example.com",
    "app-{1..49}.example.com/path",
    "app-{1..49}.example.com:443", "app-{1..49}.*.example.com", "10.0.0.{1..49}",
  ]) {
    assert.throws(() => expandDomainInput(input), undefined, input);
  }
  assert.equal(expandDomainInput("app-{1..100}.example.com").length, 100);
});
