import { writeFile } from "node:fs/promises";

const descriptionUrl =
  "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json";

interface PermissionSchema {
  description: string;
  enum: string[];
}

const header = `name: "Create GitHub App Token (KMS / Key Vault / Vault)"
description: "Create a GitHub App installation token while the App private key stays in a key store"
author: "nhkhai-vn"
branding:
  icon: "key"
  color: "gray-dark"
inputs:
  client-id:
    description: "GitHub App client ID"
    required: false
  app-id:
    description: "GitHub App ID"
    required: false
    deprecationMessage: "Use 'client-id' instead."
  key:
    description: "Key that signs the App JWT: gcp-kms://, aws-kms://, azure-kv:// or vault-transit:// URI"
    required: true
  owner:
    description: "The owner of the GitHub App installation (defaults to current repository owner)"
    required: false
  repositories:
    description: "Comma or newline-separated list of repositories to grant the token access to (defaults to current repository if owner is unset)"
    required: false
  enterprise:
    description: "The slug of the enterprise account where the GitHub App is installed (cannot be used with 'owner' or 'repositories')"
    required: false
  skip-token-revoke:
    description: "If true, the token will not be revoked when the current job is complete"
    required: false
    default: "false"
  github-api-url:
    description: "The URL of the GitHub REST API"
    default: \${{ github.api_url }}
`;

const footer = `outputs:
  token:
    description: "GitHub installation access token"
  installation-id:
    description: "GitHub App installation ID"
  app-slug:
    description: "GitHub App slug"
runs:
  using: "node24"
  main: "dist/main.cjs"
  post: "dist/post.cjs"
`;

const response = await fetch(descriptionUrl);
if (!response.ok) throw new Error(`fetch ${descriptionUrl}: ${response.status}`);
const description = (await response.json()) as {
  components: { schemas: { "app-permissions": { properties: Record<string, PermissionSchema> } } };
};

const levels = new Intl.ListFormat("en", { style: "long", type: "disjunction" });
const permissions = Object.entries(description.components.schemas["app-permissions"].properties)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, schema]) => {
    const text = `${schema.description} Can be set to ${levels.format(schema.enum.map((level) => `'${level}'`))}.`;
    return `  permission-${name.replaceAll("_", "-")}:\n    description: ${JSON.stringify(text)}\n`;
  })
  .join("");

await writeFile("action.yml", header + permissions + footer);
