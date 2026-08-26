import assert from 'node:assert/strict'
import test from 'node:test'
import { mugInputSchema } from '../src/domain'

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