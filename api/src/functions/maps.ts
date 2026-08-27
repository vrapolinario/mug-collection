import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions'
import { z } from 'zod'
import { requireAdmin } from '../auth'
import { errorResponse, HttpError, json } from '../http'
import { credential } from '../storage'

const geocodingResponseSchema = z.object({
  features: z.array(z.object({
    geometry: z.object({ coordinates: z.array(z.number()).min(2) }),
    properties: z.object({
      address: z.object({ formattedAddress: z.string().optional() }).optional(),
      confidence: z.string().optional(),
      type: z.string().optional(),
    }),
  })),
})

function requireMapsClientId() {
  const mapsClientId = process.env.AZURE_MAPS_CLIENT_ID
  if (!mapsClientId) throw new Error('AZURE_MAPS_CLIENT_ID is not configured.')
  return mapsClientId
}

async function mapsToken() {
  const token = await credential.getToken('https://atlas.microsoft.com/.default')
  if (!token) throw new Error('Unable to acquire an Azure Maps token.')
  return token.token
}

async function geocode(request: HttpRequest): Promise<HttpResponseInit> {
  try {
    await requireAdmin(request)
    const query = request.query.get('query')?.trim() ?? ''
    if (query.length < 2 || query.length > 160) throw new HttpError(400, 'Enter a location between 2 and 160 characters.')

    const url = new URL('https://atlas.microsoft.com/geocode')
    url.search = new URLSearchParams({ 'api-version': '2025-01-01', query, top: '5' }).toString()
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${await mapsToken()}`,
        'x-ms-client-id': requireMapsClientId(),
      },
    })
    if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, 'Location search is temporarily unavailable.')

    const data = geocodingResponseSchema.parse(await response.json())
    const results = data.features.flatMap((feature, index) => {
      const [longitude, latitude] = feature.geometry.coordinates
      if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return []
      return [{
        id: `${index}-${longitude}-${latitude}`,
        label: feature.properties.address?.formattedAddress ?? query,
        latitude,
        longitude,
        confidence: feature.properties.confidence,
        type: feature.properties.type,
      }]
    })
    return { ...json({ results }), headers: { 'cache-control': 'no-store' } }
  } catch (error) { return errorResponse(error) }
}

async function tile(request: HttpRequest): Promise<HttpResponseInit> {
  try {
    const { z, x, y } = request.params
    if (![z, x, y].every((value) => /^\d+$/.test(value))) throw new HttpError(400, 'Invalid tile coordinates.')
    const url = new URL('https://atlas.microsoft.com/map/tile')
    url.search = new URLSearchParams({ 'api-version': '2024-04-01', tilesetId: 'microsoft.base.road', zoom: z, x, y }).toString()
    const response = await fetch(url, { headers: { authorization: `Bearer ${await mapsToken()}`, 'x-ms-client-id': requireMapsClientId() } })
    if (!response.ok) throw new HttpError(response.status, 'Map tile is unavailable.')
    return { body: new Uint8Array(await response.arrayBuffer()), headers: { 'content-type': response.headers.get('content-type') ?? 'image/png', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' } }
  } catch (error) { return errorResponse(error) }
}

app.http('geocodeLocation', { methods: ['GET'], route: 'maps/geocode', authLevel: 'anonymous', handler: geocode })
app.http('mapTile', { methods: ['GET'], route: 'maps/tiles/{z}/{x}/{y}', authLevel: 'anonymous', handler: tile })