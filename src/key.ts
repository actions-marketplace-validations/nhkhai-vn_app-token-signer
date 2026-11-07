export interface GcpKmsKey {
  backend: "gcp-kms";
  name: string;
}

export interface AwsKmsKey {
  backend: "aws-kms";
  arn: string;
  region: string;
  host: string;
}

export interface AzureKeyVaultKey {
  backend: "azure-kv";
  keyUrl: string;
  resource: string;
}

export interface VaultTransitKey {
  backend: "vault-transit";
  mount: string;
  name: string;
  version: number | undefined;
}

export type KeyRef = GcpKmsKey | AwsKmsKey | AzureKeyVaultKey | VaultTransitKey;

const gcpName = /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/[^/]+$/;
const awsArn = /^arn:(aws|aws-cn|aws-us-gov):kms:([a-z0-9-]+):\d{12}:(?:key|alias)\/[^/\s]+$/;
const azurePath = /^([a-z0-9-]+)\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/keys\/([^/]+)\/([^/]+)$/i;
const vaultName = /^[^/?#\s]+$/;

export function parseKey(uri: string): KeyRef {
  const separator = uri.indexOf("://");
  const scheme = separator < 0 ? "" : uri.slice(0, separator);
  const rest = uri.slice(separator + 3);
  switch (scheme) {
    case "gcp-kms":
      return parseGcp(rest);
    case "aws-kms":
      return parseAws(rest);
    case "azure-kv":
      return parseAzure(rest);
    case "vault-transit":
      return parseVault(rest);
    default:
      throw new Error(`key "${uri}": expected a gcp-kms://, aws-kms://, azure-kv:// or vault-transit:// URI`);
  }
}

function parseGcp(name: string): GcpKmsKey {
  if (!gcpName.test(name)) {
    throw new Error(`key gcp-kms://${name}: expected projects/P/locations/L/keyRings/R/cryptoKeys/K/cryptoKeyVersions/V`);
  }
  return { backend: "gcp-kms", name };
}

function parseAws(arn: string): AwsKmsKey {
  const match = awsArn.exec(arn);
  if (!match) throw new Error(`key aws-kms://${arn}: expected arn:aws:kms:REGION:ACCOUNT:key/ID or :alias/NAME`);
  const [, partition, region = ""] = match;
  const domain = partition === "aws-cn" ? "amazonaws.com.cn" : "amazonaws.com";
  return { backend: "aws-kms", arn, region, host: `kms.${region}.${domain}` };
}

function parseAzure(path: string): AzureKeyVaultKey {
  const match = azurePath.exec(path);
  if (!match) throw new Error(`key azure-kv://${path}: expected NAME.vault.azure.net/keys/KEY/VERSION`);
  const [, vault = "", domain = "", name = "", version = ""] = match;
  return {
    backend: "azure-kv",
    keyUrl: `https://${vault}.${domain}/keys/${name}/${version}`,
    resource: `https://${domain}`,
  };
}

function parseVault(rest: string): VaultTransitKey {
  const [path = "", query = ""] = rest.split("?", 2);
  const separator = path.lastIndexOf("/keys/");
  const mount = path.slice(0, separator);
  const name = path.slice(separator + "/keys/".length);
  if (separator <= 0 || !vaultName.test(name)) {
    throw new Error(`key vault-transit://${rest}: expected MOUNT/keys/NAME, optionally ?version=N`);
  }
  return { backend: "vault-transit", mount, name, version: parseVersion(rest, new URLSearchParams(query).get("version")) };
}

function parseVersion(rest: string, version: string | null): number | undefined {
  if (version === null) return undefined;
  if (!/^[1-9]\d*$/.test(version)) throw new Error(`key vault-transit://${rest}: version must be a positive integer`);
  return Number(version);
}
