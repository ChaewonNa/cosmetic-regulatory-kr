import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  SASProtocol,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';

const STORAGE_CONNECTION_SETTING = 'AZURE_STORAGE_CONNECTION_STRING';
const KR_DOCUMENT_CONTAINER = process.env.KR_DOCUMENT_CONTAINER || 'kr-product-documents';

type StorageAccount = { accountName: string; accountKey: string };

function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function storageAccount(): StorageAccount {
  const connectionString = setting(STORAGE_CONNECTION_SETTING);
  const accountName = /(?:^|;)AccountName=([^;]+)/i.exec(connectionString)?.[1];
  const accountKey = /(?:^|;)AccountKey=([^;]+)/i.exec(connectionString)?.[1];
  if (!accountName || !accountKey) {
    throw new Error(`${STORAGE_CONNECTION_SETTING} must include AccountName and AccountKey`);
  }
  return { accountName, accountKey };
}

function credential(): StorageSharedKeyCredential {
  const account = storageAccount();
  return new StorageSharedKeyCredential(account.accountName, account.accountKey);
}

export function getDocumentContainerClient() {
  const account = storageAccount();
  return new BlobServiceClient(
    `https://${account.accountName}.blob.core.windows.net`,
    credential(),
  ).getContainerClient(KR_DOCUMENT_CONTAINER);
}

export function createBlobSasUrl(blobName: string, permissions: BlobSASPermissions, expiresInMinutes = 10): string {
  const container = getDocumentContainerClient();
  const expiresOn = new Date(Date.now() + expiresInMinutes * 60 * 1000);
  const sas = generateBlobSASQueryParameters(
    {
      containerName: container.containerName,
      blobName,
      permissions,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    credential(),
  ).toString();
  return `${container.getBlockBlobClient(blobName).url}?${sas}`;
}

export const documentUploadPermissions = BlobSASPermissions.parse('cw');
export const documentReadPermissions = BlobSASPermissions.parse('r');
