import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions'
import { getUserEmail, requireAdmin } from '../auth'
import { errorResponse, HttpError, json } from '../http'
import { addAdmin, isAdmin, listAdmins, removeAdmin } from '../repositories'

async function session(request: HttpRequest): Promise<HttpResponseInit> {
  const email = getUserEmail(request)
  return json({ authenticated: Boolean(email), authorized: email ? await isAdmin(email) : false, ...(email && { email }) })
}

async function getAdmins(request: HttpRequest): Promise<HttpResponseInit> {
  try { await requireAdmin(request); return json({ items: (await listAdmins()).map(({ email, addedAt, addedBy }) => ({ email, addedAt, addedBy })) }) }
  catch (error) { return errorResponse(error) }
}

async function createAdmin(request: HttpRequest): Promise<HttpResponseInit> {
  try {
    const addedBy = await requireAdmin(request)
    const body = await request.json() as { email?: unknown }
    if (typeof body.email !== 'string' || !/^\S+@\S+\.\S+$/.test(body.email) || body.email.length > 254) throw new HttpError(400, 'A valid email address is required.')
    await addAdmin(body.email, addedBy)
    return json({ email: body.email.trim().toLowerCase() }, 201)
  } catch (error) { return errorResponse(error) }
}

async function deleteAdmin(request: HttpRequest): Promise<HttpResponseInit> {
  try { await requireAdmin(request); await removeAdmin(decodeURIComponent(request.params.email)); return { status: 204 } }
  catch (error) { return errorResponse(error instanceof Error && error.message.includes('last administrator') ? new HttpError(409, error.message) : error) }
}

app.http('adminSession', { methods: ['GET'], route: 'admin/session', authLevel: 'anonymous', handler: session })
app.http('listAdmins', { methods: ['GET'], route: 'admins', authLevel: 'anonymous', handler: getAdmins })
app.http('createAdmin', { methods: ['POST'], route: 'admins', authLevel: 'anonymous', handler: createAdmin })
app.http('deleteAdmin', { methods: ['DELETE'], route: 'admins/{email}', authLevel: 'anonymous', handler: deleteAdmin })