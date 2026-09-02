import type { TableEntityResult, TransactionAction } from '@azure/data-tables'
import type { MugEntity } from './domain'
import { tableClient } from './storage'

const mugs = tableClient(process.env.MUGS_TABLE_NAME ?? 'Mugs')
const admins = tableClient(process.env.ADMINS_TABLE_NAME ?? 'Admins')
const mugCountRowKey = '__mug_count__'
type MugCountEntity = { partitionKey: 'mug'; rowKey: typeof mugCountRowKey; count: number }

export async function listMugs(): Promise<MugEntity[]> {
  const results: MugEntity[] = []
  for await (const entity of mugs.listEntities<MugEntity>({ queryOptions: { filter: `PartitionKey eq 'mug' and RowKey ne '${mugCountRowKey}'` } })) results.push(entity)
  return results.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function getMug(id: string): Promise<MugEntity | undefined> {
  try { return await mugs.getEntity<MugEntity>('mug', id) }
  catch (error) { if (isNotFound(error)) return undefined; throw error }
}

export async function getMugCount() { return (await ensureMugCount()).count }

export async function createMug(mug: MugEntity) {
  await mutateMugCount(1, ['create', mug])
}

export async function saveMug(mug: MugEntity) { await mugs.upsertEntity(mug, 'Replace') }

export async function removeMug(id: string) {
  await mutateMugCount(-1, ['delete', { partitionKey: 'mug', rowKey: id }])
}

async function mutateMugCount(change: 1 | -1, mugAction: TransactionAction) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await ensureMugCount()
    const updated: MugCountEntity = { partitionKey: 'mug', rowKey: mugCountRowKey, count: Math.max(0, current.count + change) }
    try {
      await mugs.submitTransaction([mugAction, ['update', updated, 'Replace', { etag: current.etag }]])
      return
    } catch (error) {
      if (!isConcurrencyConflict(error) || attempt === 4) throw error
    }
  }
}

async function ensureMugCount(): Promise<TableEntityResult<MugCountEntity>> {
  try { return await mugs.getEntity<MugCountEntity>('mug', mugCountRowKey) }
  catch (error) { if (!isNotFound(error)) throw error }

  let count = 0
  for await (const _entity of mugs.listEntities({ queryOptions: { filter: `PartitionKey eq 'mug' and RowKey ne '${mugCountRowKey}'`, select: ['RowKey'] } })) count += 1
  try { await mugs.createEntity<MugCountEntity>({ partitionKey: 'mug', rowKey: mugCountRowKey, count }) }
  catch (error) { if (!isConcurrencyConflict(error)) throw error }
  return mugs.getEntity<MugCountEntity>('mug', mugCountRowKey)
}

export type AdminEntity = { partitionKey: 'admin'; rowKey: string; email: string; addedAt: string; addedBy: string }
export const normalizeEmail = (email: string) => email.trim().toLocaleLowerCase('en-US')

export async function isAdmin(email: string) {
  try { await admins.getEntity('admin', normalizeEmail(email)); return true }
  catch (error) { if (isNotFound(error)) return false; throw error }
}

export async function listAdmins() {
  const results: AdminEntity[] = []
  for await (const entity of admins.listEntities<AdminEntity>({ queryOptions: { filter: `PartitionKey eq 'admin'` } })) results.push(entity)
  return results.sort((left, right) => left.email.localeCompare(right.email))
}

export async function addAdmin(email: string, addedBy: string) {
  const normalized = normalizeEmail(email)
  await admins.upsertEntity({ partitionKey: 'admin', rowKey: normalized, email: normalized, addedAt: new Date().toISOString(), addedBy }, 'Replace')
}

export async function removeAdmin(email: string) {
  const allAdmins = await listAdmins()
  if (allAdmins.length <= 1) throw new Error('The last administrator cannot be removed.')
  await admins.deleteEntity('admin', normalizeEmail(email))
}

function isNotFound(error: unknown) {
  return typeof error === 'object' && error !== null && 'statusCode' in error && (error as { statusCode: number }).statusCode === 404
}

function isConcurrencyConflict(error: unknown) {
  return typeof error === 'object' && error !== null && 'statusCode' in error && [409, 412].includes((error as { statusCode: number }).statusCode)
}