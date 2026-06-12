/*
  Reproduce el 500 de /app/rutas/<id> autenticado como un usuario real:
  genera un magic link (admin), lo canjea por sesión (GoTrue REST, sin SDK)
  y arma la cookie exacta de @supabase/ssr para pegarle a producción.
  Solo diagnóstico — no muta nada.
*/
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const email = "hola@aulia.ai";
const target = process.argv[2] ?? "https://www.aulia.ai/app/rutas/495c9bb6-d04d-4b09-a9a5-d19dd18f8c08";

const linkRes = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ type: "magiclink", email }),
});
const link = (await linkRes.json()) as { hashed_token?: string };
if (!link.hashed_token) throw new Error(`generate_link: ${JSON.stringify(link).slice(0, 200)}`);

const verifyRes = await fetch(`${url}/auth/v1/verify`, {
  method: "POST",
  headers: { apikey: anonKey, "content-type": "application/json" },
  body: JSON.stringify({ type: "magiclink", token_hash: link.hashed_token }),
});
const session = (await verifyRes.json()) as Record<string, unknown>;
if (!session.access_token) throw new Error(`verify: ${JSON.stringify(session).slice(0, 200)}`);
if (process.env.STALE_SESSION) {
  // Simula la sesión de un navegador viejo: access token vencido hace 1h →
  // fuerza el refresh server-side durante el request (caso del fundador).
  session.expires_at = Math.floor(Date.now() / 1000) - 3600;
  session.expires_in = -3600;
  console.log("sesión envejecida artificialmente");
}

// Formato cookie @supabase/ssr: sb-<ref>-auth-token = base64-<b64url(JSON)>,
// chunked en trozos de 3180 chars con sufijo .0/.1 si excede.
const ref = new URL(url).hostname.split(".")[0];
const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
const cookieName = `sb-${ref}-auth-token`;
const CHUNK = 3180;
const cookies: string[] = [];
if (value.length <= CHUNK) {
  cookies.push(`${cookieName}=${value}`);
} else {
  for (let i = 0; i * CHUNK < value.length; i++) {
    cookies.push(`${cookieName}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  }
}

if (process.env.SAVE_COOKIE) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync("/tmp/aulia-cookie.txt", cookies.join("; "));
  console.log("cookie guardada");
  process.exit(0);
}
const res = await fetch(target, {
  headers: {
    cookie: cookies.join("; "),
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "es-CL,es;q=0.9,en;q=0.8",
    "accept-encoding": "gzip, deflate, br, zstd",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "sec-ch-ua": '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
  },
  redirect: "manual",
});
console.log(`GET ${target}`);
console.log(`status: ${res.status}`);
console.log(`location: ${res.headers.get("location") ?? "-"}`);
const body = await res.text();
const digest = body.match(/digest[":\s]+(\d+)/)?.[1];
console.log(`digest: ${digest ?? "-"}`);
console.log(body.slice(0, 300).replace(/\s+/g, " "));
process.exit(0);
