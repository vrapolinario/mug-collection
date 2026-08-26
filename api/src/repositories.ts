import type { MugEntity } from './domain'
import { tableClient } from './storage'

const mugs = tableClient(process.env.MUGS_TABLE_NAME ?? 'Mugs')
const admins = tableClient(process.env.ADMINS_TABLE_NAME ?? 'Admins')

export async function listMugs(): Promise<MugEntity[]> {
  const results: MugEntity[] = []
  for await (const entity of mugs.listEntities<MugEntity>({ queryOptions: { filter: `PartitionKey eq 'mug'` } })) results.push(entity)
  return results.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function getMug(id: string): Promise<MugEntity | undefined> {
  try { return await mugs.getEntity<MugEntity>('mug', id) }
  catch (error) { if (isNotFound(error)) return undefined; throw error }
}

export async function saveMug(mug: MugEntity) { await mugs.upsertEntity(mug, 'Replace') }
export async function removeMug(id: string) { await mugs.deleteEntity('mug', id) }

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