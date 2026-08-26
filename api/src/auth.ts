import type { HttpRequest } from '@azure/functions'
import { HttpError } from './http'
import { isAdmin } from './repositories'

type ClientPrincipal = { userDetails?: string; claims?: Array<{ typ: string; val: string }> }

export function getUserEmail(request: HttpRequest) {
  const encoded = request.headers.get('x-ms-client-principal')
  if (!encoded) return undefined
  try {
    const principal = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as ClientPrincipal
    const emailClaimTypes = new Set(['emails', 'email', 'preferred_username', 'upn', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'])
    return principal.claims?.find((claim) => emailClaimTypes.has(claim.typ))?.val ?? principal.userDetails
  } catch { return undefined }
}

export async function requireAdmin(request: HttpRequest) {
  const email = getUserEmail(request)
  if (!email) throw new HttpError(401, 'Microsoft authentication is required.')
  if (!(await isAdmin(email))) throw new HttpError(403, 'This account is not an administrator.')
  return email
}