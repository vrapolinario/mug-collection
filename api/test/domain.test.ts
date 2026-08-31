import assert from 'node:assert/strict'
import test from 'node:test'
import { mugInputSchema, toPublicMug, type MugEntity } from '../src/domain'

test('accepts a located mug and converts a year', () => {
  const result = mugInputSchema.parse({ title: 'Seattle', type: 'City', series: '2024', additionalInfo: '', locationName: 'Seattle, WA', latitude: '47.61', longitude: '-122.33' })
  assert.equal(result.series, 2024)
  assert.equal(result.additionalInfo, undefined)
})

test('permits a film mug without a location', () => {
  assert.doesNotThrow(() => mugInputSchema.parse({ title: 'A film', type: 'Film', series: 'N/A', additionalInfo: '', locationName: '', latitude: '', longitude: '' }))
})

test('rejects a non-film mug without coordinates', () => {
  assert.throws(() => mugInputSchema.parse({ title: 'Paris', type: 'City', series: '2020', additionalInfo: '', locationName: 'Paris', latitude: '', longitude: '' }))
})

test('accepts Places as a mug type and rejects the old Location value', () => {
  const locatedMug = { title: 'Space Needle', series: '2024', additionalInfo: '', locationName: 'Space Needle', latitude: '47.62', longitude: '-122.35' }
  assert.doesNotThrow(() => mugInputSchema.parse({ ...locatedMug, type: 'Places' }))
  assert.throws(() => mugInputSchema.parse({ ...locatedMug, type: 'Location' }))
})

test('presents legacy Location records as Places', () => {
  const legacyMug: MugEntity = { partitionKey: 'mug', rowKey: 'legacy', title: 'Landmark', type: 'Location', series: '2024', locationName: 'Landmark', latitude: 1, longitude: 2, primaryImageName: 'mug.webp', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }
  assert.equal(toPublicMug(legacyMug).type, 'Places')
})