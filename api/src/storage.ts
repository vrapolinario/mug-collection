import { TableClient } from '@azure/data-tables'
import { DefaultAzureCredential } from '@azure/identity'
import { BlobServiceClient } from '@azure/storage-blob'

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
const storageAccountName = process.env.STORAGE_ACCOUNT_NAME
export const credential = new DefaultAzureCredential()

function requireStorageAccountName() {
  if (!storageAccountName) throw new Error('STORAGE_ACCOUNT_NAME is not configured.')
  return storageAccountName
}

export function tableClient(tableName: string) {
  if (connectionString) return TableClient.fromConnectionString(connectionString, tableName, { allowInsecureConnection: true })
  return new TableClient(`https://${requireStorageAccountName()}.table.core.windows.net`, tableName, credential)
}

export function imageContainer() {
  const containerName = process.env.MUG_IMAGES_CONTAINER ?? 'mug-images'
  if (connectionString) return BlobServiceClient.fromConnectionString(connectionString).getContainerClient(containerName)
  return new BlobServiceClient(`https://${requireStorageAccountName()}.blob.core.windows.net`, credential).getContainerClient(containerName)
}