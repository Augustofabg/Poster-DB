// Poster universal para Nuvio / AIOMetadata (Vercel Edge Function)
// Uso: https://SEU-PROJETO.vercel.app/poster/{id}.jpg?type={type}
export const config = { runtime: "edge" };

const KNOWN = {
  imdb: "imdb", tmdb: "tmdb", tvdb: "tvdb",
  anilist: "anilist", al: "anilist",
  mal: "mal", myanimelist: "mal",
  kitsu: "kitsu", anidb: "anidb", simkl: "simkl",
};

export default async function handler(req) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("id") || "").replace(/\.(jpe?g|png|webp)$/i, "");
  const type = (url.searchParams.get("type") || "").toLowerCase();

  const parsed = raw ? parseId(raw) : null;
  let imageUrl = null;
  if (parsed) {
    try { imageUrl = await resolve(parsed, type); } catch (_) { imageUrl = null; }
  }
  if (!imageUrl) return placeholder();

  const img = await fetch(imageUrl);
  if (!img.ok) return placeholder();

  return new Response(img.body, {
    status: 200,
    headers: {
      "Content-Type": img.headers.get("Content-Type") || "image/jpeg",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function parseId(raw) {
  const parts = decodeURIComponent(raw).trim().split(":");
  const first = parts[0].toLowerCase();

  if (/^tt\d+$/.test(first)) return { kind: "imdb", id: first };
  if (KNOWN[first] && parts[1]) {
    const id = parts[1].trim();
    return { kind: KNOWN[first], id: KNOWN[first] === "imdb" ? id.toLowerCase() : id };
  }
  if (/^\d+$/.test(first)) return { kind: "tmdb", id: first };
  return null;
}

async function resolve({ kind, id }, type) {
  switch (kind) {
    case "anilist": return anilist(`Media(id:${int(id)}, type:ANIME)`);
    case "mal": return anilist(`Media(idMal:${int(id)}, type:ANIME)`);
    case "kitsu": return kitsu(id);
    case "anidb": return anidb(id);
    case "simkl": return simkl(id, type);
    case "tmdb": return tmdb(id, type);
    case "imdb": return tmdbFind(id, "imdb_id", type);
    case "tvdb": return tmdbFind(id, "tvdb_id", type);
  }
  return null;
}

const int = (v) => parseInt(v, 10) || 0;

async function getJson(u, opts) {
  const r = await fetch(u, opts);
  return r.ok ? r.json() : null;
}

// --- Anime ---------------------------------------------------------------

async function anilist(mediaExpr) {
  const query = `query { ${mediaExpr} { coverImage { extraLarge large } } }`;
  const j = await getJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query }),
  });
  const c = j?.data?.Media?.coverImage;
  return c?.extraLarge || c?.large || null;
}

async function kitsu(id) {
  const j = await getJson(`https://kitsu.io/api/edge/anime/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/vnd.api+json" },
  });
  const p = j?.data?.attributes?.posterImage;
  return p?.large || p?.original || p?.medium || null;
}

async function anidb(id) {
  const u =
    "https://kitsu.io/api/edge/mappings?filter[externalSite]=anidb&filter[externalId]=" +
    encodeURIComponent(id) + "&include=item";
  const j = await getJson(u, { headers: { Accept: "application/vnd.api+json" } });
  const p = j?.included?.[0]?.attributes?.posterImage;
  return p?.large || p?.original || p?.medium || null;
}

async function simkl(id, type) {
  if (!process.env.SIMKL_ID) return null;
  const order =
    type === "movie" ? ["movies", "anime", "tv"] :
    type === "anime" ? ["anime", "tv", "movies"] :
    ["tv", "anime", "movies"];
  for (const kind of order) {
    const j = await getJson(
      `https://api.simkl.com/${kind}/${encodeURIComponent(id)}?client_id=${process.env.SIMKL_ID}`
    );
    if (j?.poster) return `https://simkl.in/posters/${j.poster}_m.webp`;
  }
  return null;
}

// --- Filmes e series (TMDB) ----------------------------------------------

const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

function mediaOrder(type) {
  return type === "movie" ? ["movie", "tv"] : ["tv", "movie"];
}

async function tmdb(id, type) {
  if (!process.env.TMDB_KEY) return null;
  for (const kind of mediaOrder(type)) {
    const j = await getJson(
      `https://api.themoviedb.org/3/${kind}/${encodeURIComponent(id)}?api_key=${process.env.TMDB_KEY}`
    );
    if (j?.poster_path) return TMDB_IMG + j.poster_path;
  }
  return null;
}

async function tmdbFind(id, source, type) {
  if (!process.env.TMDB_KEY) return null;
  const j = await getJson(
    `https://api.themoviedb.org/3/find/${encodeURIComponent(id)}?external_source=${source}&api_key=${process.env.TMDB_KEY}`
  );
  if (!j) return null;
  const lists = mediaOrder(type).map((k) => (k === "movie" ? j.movie_results : j.tv_results));
  for (const list of lists) {
    const hit = (list || []).find((x) => x.poster_path);
    if (hit) return TMDB_IMG + hit.poster_path;
  }
  return null;
}

// --- Fallback ------------------------------------------------------------

function placeholder() {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" viewBox="0 0 500 750">` +
    `<rect width="500" height="750" fill="#141414"/>` +
    `<text x="250" y="375" fill="#555" font-family="sans-serif" font-size="28" text-anchor="middle">sem poster</text>` +
    `</svg>`;
  return new Response(svg, {
    status: 200,
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, s-maxage=300" },
  });
}
