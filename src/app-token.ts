import type { GitHub, InstallationToken, TokenRequest } from "./github.ts";
import { createAppJwt } from "./jwt.ts";
import type { Signer } from "./signer.ts";
import type { Target } from "./target.ts";

export interface MintRequest {
  clientId: string;
  target: Target;
  permissions: Record<string, string> | undefined;
}

export interface AppToken extends InstallationToken {
  installationId: number;
  appSlug: string;
}

export async function mintAppToken(
  request: MintRequest,
  signer: Signer,
  github: GitHub,
  mask: (secret: string) => void,
  now: Date,
): Promise<AppToken> {
  const jwt = await createAppJwt(request.clientId, signer, now);
  mask(jwt);
  const installation = await github.findInstallation(jwt, request.target);
  const token = await github.createToken(jwt, installation.id, tokenRequest(request));
  mask(token.token);
  return { ...token, installationId: installation.id, appSlug: installation.appSlug };
}

function tokenRequest({ target, permissions }: MintRequest): TokenRequest {
  return {
    ...(target.type === "repository" ? { repositories: target.repositories } : {}),
    ...(permissions === undefined ? {} : { permissions }),
  };
}
