import { SignJWT, jwtVerify } from "jose"

function getSecret() {
  const key = process.env.JWT_SECRET
  if (!key) throw new Error("JWT_SECRET environment variable is required")
  return new TextEncoder().encode(key)
}

export type JwtPayload = { userId: string; role: string; email: string }

export async function signToken(payload: JwtPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret())
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getSecret())
  return payload as unknown as JwtPayload
}
