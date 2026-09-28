// Shared validation for the editor and background. Entries are DNS domains, not URLs or IPs.
function normalizeDomain(value) {
  if (typeof value !== "string") throw new Error("Enter a domain name.");
  const domain = value.trim().toLowerCase();
  const validDomain = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (domain.length > 253 || !validDomain.test(domain)) {
    throw new Error("Use a valid DNS domain such as docs.example.com. IP addresses and * wildcards are not supported.");
  }
  return domain;
}

function normalizeHosts(hosts) {
  if (!Array.isArray(hosts)) throw new Error("The allowlist must be a list of domains.");
  return [...new Set(hosts.map(normalizeDomain))].sort();
}

// Editor shorthand only: persist individual domains, never full URLs or range rules.
function expandDomainInput(value) {
  if (typeof value !== "string") throw new Error("Enter a domain name.");
  let input = value.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) {
    let url;
    try {
      url = new URL(input);
    } catch {
      throw new Error("Enter a valid http:// or https:// website URL.");
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Only http:// and https:// website URLs are supported.");
    }
    if (url.username || url.password) {
      throw new Error("Remove the username and password from the URL before adding it.");
    }
    input = url.hostname;
  }
  input = input.toLowerCase();
  if (!/[{}]/.test(input)) return [normalizeDomain(input)];
  const range = /^([^{}]*)\{(0|[1-9]\d*)\.\.(0|[1-9]\d*)\}([^{}]*)$/.exec(input);
  if (!range) throw new Error("Use one numeric range such as app-{1..49}.example.com, without leading zeros.");
  const start = Number(range[2]);
  const end = Number(range[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end - start >= 100) {
    throw new Error("Use an ascending range of at most 100 domains.");
  }
  return normalizeHosts(Array.from({ length: end - start + 1 }, (_, index) =>
    `${range[1]}${start + index}${range[4]}`));
}

function buildPac(hosts) {
  return `function FindProxyForURL(url, host) {
  var allowed = ${JSON.stringify(hosts)};
  host = host.toLowerCase();
  for (var i = 0; i < allowed.length; i++) {
    if (host === allowed[i] || dnsDomainIs(host, "." + allowed[i])) return "DIRECT";
  }
  return "PROXY 127.0.0.1:9";
}`;
}

function buildConfig(hosts) {
  return {
    mode: "pac_script",
    // Prevent direct fallback for an invalid PAC script; browser exceptions still apply.
    pacScript: { data: buildPac(normalizeHosts(hosts)), mandatory: true },
  };
}
