import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions'
import { errorResponse, HttpError } from '../http'
import { credential } from '../storage'

async function tile(request: HttpRequest): Promise<HttpResponseInit> {
  try {
    const { z, x, y } = request.params
    if (![z, x, y].every((value) => /^\d+$/.test(value))) throw new HttpError(400, 'Invalid tile coordinates.')
    const mapsClientId = process.env.AZURE_MAPS_CLIENT_ID
    if (!mapsClientId) throw new Error('AZURE_MAPS_CLIENT_ID is not configured.')
    const token = await credential.getToken('https://atlas.microsoft.com/.default')
    if (!token) throw new Error('Unable to acquire an Azure Maps token.')
    const url = new URL('https://atlas.microsoft.com/map/tile')
    url.search = new URLSearchParams({ 'api-version': '2024-04-01', tilesetId: 'microsoft.base.road', zoom: z, x, y }).toString()
    const response = await fetch(url, { headers: { authorization: `Bearer ${token.token}`, 'x-ms-client-id': mapsClientId } })
    if (!response.ok) throw new HttpError(response.status, 'Map tile is unavailable.')
    return { body: new Uint8Array(await response.arrayBuffer()), headers: { 'content-type': response.headers.get('content-type') ?? 'image/png', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' } }
  } catch (error) { return errorResponse(error) }
}

app.http('mapTile', { methods: ['GET'], route: 'maps/tiles/{z}/{x}/{y}', authLevel: 'anonymous', handler: tile })