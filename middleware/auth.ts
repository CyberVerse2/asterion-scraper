import { importJWK, jwtVerify } from 'jose';
import { findOrCreateUser, IUser } from '../models/User.js';

const CLERK_JWKS_URL = 'https://poetic-gator-97.clerk.accounts.dev/.well-known/jwks.json';

interface JwksKey {
  kid: string;
  kty: string;
  use: string;
  alg: string;
  n: string;
  e: string;
}

let jwksCache: { keys: JwksKey[] } | null = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchJwks(): Promise<{ keys: JwksKey[] }> {
  if (jwksCache && Date.now() - jwksCacheTime < JWKS_CACHE_TTL) {
    return jwksCache;
  }

  const response = await fetch(CLERK_JWKS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Clerk JWKS: ${response.status}`);
  }

  jwksCache = await response.json() as { keys: JwksKey[] };
  jwksCacheTime = Date.now();
  return jwksCache;
}

function decodeJwtHeader(token: string): { kid?: string } {
  const parts = token.split('.');
  if (parts.length < 2) {
    return {};
  }

  try {
    const headerJson = Buffer.from(parts[0], 'base64url').toString('utf-8');
    return JSON.parse(headerJson);
  } catch {
    return {};
  }
}

export async function verifyClerkToken(token: string): Promise<string> {
  const header = decodeJwtHeader(token);
  if (!header.kid) {
    throw new Error('JWT header missing "kid"');
  }

  const jwks = await fetchJwks();
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new Error(`JWK with kid "${header.kid}" not found`);
  }

  const publicKey = await importJWK(
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg },
    jwk.alg
  );

  const { payload } = await jwtVerify(token, publicKey, {
    issuer: `https://poetic-gator-97.clerk.accounts.dev`,
    algorithms: [jwk.alg],
  });

  const sub = payload.sub;
  if (!sub || typeof sub !== 'string') {
    throw new Error('JWT payload missing "sub" claim');
  }

  return sub;
}

export async function authenticateRequest(request: Request): Promise<{ user: IUser }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing or invalid Authorization header');
  }

  const token = authHeader.slice(7);
  let clerkUserId: string;

  try {
    clerkUserId = await verifyClerkToken(token);
  } catch (err) {
    throw new HttpError(401, 'Invalid authentication token');
  }

  const user = await findOrCreateUser(clerkUserId);
  return { user };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
