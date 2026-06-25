import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "change-me";
const ACCESS_TTL = 60 * 60; // 1h
const REFRESH_TTL = 60 * 60 * 24 * 30; // 30d
const WS_TTL = 60 * 5; // 5m

export function signAccess(userId: string) {
  return jwt.sign({ sub: userId, type: "access" }, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

export function signRefresh(userId: string) {
  return jwt.sign({ sub: userId, type: "refresh" }, JWT_SECRET, { expiresIn: REFRESH_TTL });
}

export function signWs(userId: string) {
  return jwt.sign({ sub: userId, type: "ws" }, JWT_SECRET, { expiresIn: WS_TTL });
}

export function verifyToken(token: string, type: string): string {
  const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
  if (payload.type !== type) throw new Error("wrong token type");
  return payload.sub as string;
}

export { ACCESS_TTL };
