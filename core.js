const LAMPORTS_PER_SOL = 1_000_000_000n;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function base58Encode(bytes) {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    value /= 58n;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return "1".repeat(zeroes) + encoded;
}

export function checkedLamports(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("RPC returned an unsafe lamport balance.");
  }
  return BigInt(value);
}

export function expectedPayouts(route, sourceLamports, rentLamports) {
  const source = BigInt(sourceLamports);
  const rent = BigInt(rentLamports);
  const surplus = source > rent ? source - rent : 0n;
  const payouts = route.recipients.map(({ basisPoints }) =>
    surplus * BigInt(basisPoints) / 10_000n);
  let distributed = payouts.reduce((sum, amount) => sum + amount, 0n);
  if (route.remainderIndex !== null) {
    payouts[route.remainderIndex] += surplus - distributed;
    distributed = surplus;
  }
  return {
    surplus,
    payouts,
    distributed,
    retained: surplus - distributed,
  };
}

export function formatSol(lamports) {
  const value = BigInt(lamports);
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / LAMPORTS_PER_SOL;
  const fraction = (absolute % LAMPORTS_PER_SOL).toString().padStart(9, "0").replace(/0+$/u, "");
  return `${sign}${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

export function shortAddress(value) {
  return `${value.slice(0, 5)}…${value.slice(-5)}`;
}

export function alphabeticalRoutes(routes) {
  return [...routes].sort((left, right) =>
    left.name.localeCompare(right.name, "en", { sensitivity: "base" }));
}

export function sweepDescriptor(route, keeperProgram) {
  return Object.freeze({
    program: keeperProgram,
    accounts: Object.freeze([
      route.sourceAddress,
      ...route.recipients.map(({ address }) => address),
    ]),
    data: Uint8Array.of(1, route.id),
  });
}

export function validateRpcUrl(raw, pageProtocol = "https:") {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Enter a complete RPC URL.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("RPC must use HTTPS; local development may use HTTP.");
  }
  if (pageProtocol === "https:" && url.protocol !== "https:" && !local) {
    throw new Error("An HTTPS page cannot use an insecure remote RPC.");
  }
  url.hash = "";
  return url.toString();
}

export function publicRpcLabel(raw) {
  const url = new URL(raw);
  return url.host;
}

export function validateRoutes(routes) {
  if (!Array.isArray(routes) || routes.length !== 33) throw new Error("Expected 33 frozen routes.");
  const sources = new Set();
  routes.forEach((route, index) => {
    if (route.id !== index || !route.name || !route.sourceAddress || !route.originProgramAddress ||
        !Number.isInteger(route.bump) || route.bump < 0 || route.bump > 255) {
      throw new Error(`Route ${index} is malformed.`);
    }
    if (sources.has(route.sourceAddress)) throw new Error(`Route ${index} repeats a source PDA.`);
    sources.add(route.sourceAddress);
    if (!Array.isArray(route.recipients) || route.recipients.length < 1 || route.recipients.length > 5) {
      throw new Error(`Route ${index} has an invalid recipient count.`);
    }
    if (new Set(route.recipients.map(({ address }) => address)).size !== route.recipients.length) {
      throw new Error(`Route ${index} repeats a recipient.`);
    }
    if (route.recipients.some(({ address, basisPoints }) =>
      !address || !Number.isInteger(basisPoints) || basisPoints <= 0 || basisPoints > 10_000 || basisPoints % 50 !== 0)) {
      throw new Error(`Route ${index} has an invalid recipient.`);
    }
    if (route.recipients.reduce((sum, { basisPoints }) => sum + basisPoints, 0) !== 10_000) {
      throw new Error(`Route ${index} has an invalid royalty split.`);
    }
    if (route.remainderIndex !== null && route.remainderIndex !== 0) {
      throw new Error(`Route ${index} has an invalid remainder recipient.`);
    }
  });
}
