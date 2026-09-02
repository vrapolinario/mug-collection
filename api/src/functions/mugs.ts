import { randomUUID } from 'node:crypto'
import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions'
import { requireAdmin } from '../auth'
import { mugInputSchema, toPublicMug, type MugEntity } from '../domain'
import { errorResponse, HttpError, json } from '../http'
import { deleteImage, downloadImage, uploadImage } from '../images'
import { createMug as createMugEntity, getMug, getMugCount, listMugs, removeMug, saveMug } from '../repositories'

async function getMugs(): Promise<HttpResponseInit> {
  return json({ items: (await listMugs()).map(toPublicMug) })
}

async function getCount(): Promise<HttpResponseInit> {
  try { return json({ count: await getMugCount() }) }
  catch (error) { return errorResponse(error) }
}

async function createMug(request: HttpRequest): Promise<HttpResponseInit> {
  try {
    await requireAdmin(request)
    const form = await request.formData()
    const input = mugInputSchema.parse(Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === 'string')))
    const primary = form.get('primaryImage')
    const secondary = form.get('secondaryImage')
    if (!(primary instanceof File)) throw new HttpError(400, 'A primary photo is required.')
    const uploaded: string[] = []
    try {
      const primaryImageName = await uploadImage(primary); uploaded.push(primaryImageName)
      const secondaryImageName = secondary instanceof File && secondary.size ? await uploadImage(secondary) : undefined
      if (secondaryImageName) uploaded.push(secondaryImageName)
      const now = new Date().toISOString()
      const entity: MugEntity = { partitionKey: 'mug', rowKey: randomUUID(), ...input, series: String(input.series), primaryImageName, ...(secondaryImageName && { secondaryImageName }), createdAt: now, updatedAt: now }
      await createMugEntity(entity)
      return json(toPublicMug(entity), 201)
    } catch (error) { await Promise.allSettled(uploaded.map(deleteImage)); throw error }
  } catch (error) { return errorResponse(error) }
}

async function updateMug(request: HttpRequest): Promise<HttpResponseInit> {
  try {
    await requireAdmin(request)
    const existing = await getMug(request.params.id)
    if (!existing) throw new HttpError(404, 'Mug not found.')
    const form = await request.formData()
    const input = mugInputSchema.parse(Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === 'string')))
    const primary = form.get('primaryImage'); const secondary = form.get('secondaryImage')
    let primaryImageName = existing.primaryImageName; let secondaryImageName = existing.secondaryImageName
    const replacements: string[] = []
    try {
      if (primary instanceof File && primary.size) { primaryImageName = await uploadImage(primary); replacements.push(primaryImageName) }
      if (secondary instanceof File && secondary.size) { secondaryImageName = await uploadImage(secondary); replacements.push(secondaryImageName) }
      const entity: MugEntity = { partitionKey: 'mug', rowKey: existing.rowKey, ...input, series: String(input.series), primaryImageName, ...(secondaryImageName && { secondaryImageName }), createdAt: existing.createdAt, updatedAt: new Date().toISOString() }
      await saveMug(entity)
      await Promise.allSettled([primaryImageName !== existing.primaryImageName ? deleteImage(existing.primaryImageName) : Promise.resolve(), secondaryImageName !== existing.secondaryImageName ? deleteImage(existing.secondaryImageName) : Promise.resolve()])
      return json(toPublicMug(entity))
    } catch (error) { await Promise.allSettled(replacements.map(deleteImage)); throw error }
  } catch (error) { return errorResponse(error) }
}

async function deleteMug(request: HttpRequest): Promise<HttpResponseInit> {
  try {
    await requireAdmin(request)
    const existing = await getMug(request.params.id)
    if (!existing) throw new HttpError(404, 'Mug not found.')
    await removeMug(existing.rowKey)
    await Promise.allSettled([deleteImage(existing.primaryImageName), deleteImage(existing.secondaryImageName)])
    return { status: 204 }
  } catch (error) { return errorResponse(error) }
}

async function getImage(request: HttpRequest): Promise<HttpResponseInit> {
  try { const image = await downloadImage(request.params.name); return { body: image.body, headers: { 'content-type': image.contentType, 'cache-control': image.cacheControl, 'x-content-type-options': 'nosniff' } } }
  catch (error) { return errorResponse(error) }
}

app.http('listMugs', { methods: ['GET'], route: 'mugs', authLevel: 'anonymous', handler: getMugs })
app.http('getMugCount', { methods: ['GET'], route: 'mugs/count', authLevel: 'anonymous', handler: getCount })
app.http('createMug', { methods: ['POST'], route: 'mugs', authLevel: 'anonymous', handler: createMug })
app.http('updateMug', { methods: ['PUT'], route: 'mugs/{id}', authLevel: 'anonymous', handler: updateMug })
app.http('deleteMug', { methods: ['DELETE'], route: 'mugs/{id}', authLevel: 'anonymous', handler: deleteMug })
app.http('getImage', { methods: ['GET'], route: 'images/{name}', authLevel: 'anonymous', handler: getImage })