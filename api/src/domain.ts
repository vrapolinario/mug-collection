import { z } from 'zod'

export const mugTypes = ['Country', 'State', 'City', 'Places', 'Film', 'Old Collection', 'Special'] as const
type MugType = (typeof mugTypes)[number]

const optionalText = (maxLength: number) => z.string().trim().max(maxLength).transform((value) => value || undefined)
const optionalCoordinate = (minimum: number, maximum: number) => z.union([
  z.literal('').transform(() => undefined),
  z.coerce.number().min(minimum).max(maximum),
])

export const mugInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  type: z.enum(mugTypes),
  series: z.union([z.literal('N/A'), z.string().regex(/^\d{4}$/).transform(Number)]),
  additionalInfo: optionalText(2000),
  locationName: optionalText(160),
  latitude: optionalCoordinate(-90, 90),
  longitude: optionalCoordinate(-180, 180),
}).superRefine((mug, context) => {
  if (mug.type !== 'Film' && (!mug.locationName || mug.latitude === undefined || mug.longitude === undefined)) {
    context.addIssue({ code: 'custom', message: 'Location name, latitude, and longitude are required for this mug type.' })
  }
})

export type MugInput = z.infer<typeof mugInputSchema>

export type MugEntity = {
  partitionKey: 'mug'
  rowKey: string
  title: string
  type: MugType | 'Location'
  series: string
  additionalInfo?: string
  locationName?: string
  latitude?: number
  longitude?: number
  primaryImageName: string
  secondaryImageName?: string
  createdAt: string
  updatedAt: string
}

export type PublicMug = Omit<MugEntity, 'partitionKey' | 'rowKey' | 'primaryImageName' | 'secondaryImageName' | 'createdAt' | 'updatedAt' | 'series' | 'type'> & {
  id: string
  type: MugType
  series: number | 'N/A'
  primaryImageUrl: string
  secondaryImageUrl?: string
}

export function toPublicMug(entity: MugEntity): PublicMug {
  return {
    id: entity.rowKey,
    title: entity.title,
    type: entity.type === 'Location' ? 'Places' : entity.type,
    series: entity.series === 'N/A' ? 'N/A' : Number(entity.series),
    ...(entity.additionalInfo && { additionalInfo: entity.additionalInfo }),
    ...(entity.locationName && { locationName: entity.locationName }),
    ...(entity.latitude !== undefined && { latitude: entity.latitude }),
    ...(entity.longitude !== undefined && { longitude: entity.longitude }),
    primaryImageUrl: `/api/images/${encodeURIComponent(entity.primaryImageName)}`,
    ...(entity.secondaryImageName && { secondaryImageUrl: `/api/images/${encodeURIComponent(entity.secondaryImageName)}` }),
  }
}