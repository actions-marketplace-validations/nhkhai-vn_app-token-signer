import { base64, fromBase64 } from "../encoding.ts";
import { requestJson } from "../http.ts";
import { object, string } from "../json.ts";
import type { AwsKmsKey } from "../key.ts";
import { explainRefusal, type Signer, type SignerDeps } from "../signer.ts";
import { type AwsCredentials, signV4 } from "./sigv4.ts";

export function awsKmsSigner(key: AwsKmsKey, { fetch, env, now }: Pick<SignerDeps, "fetch" | "env" | "now">): Signer {
  return {
    async signDigest(digest) {
      const body = JSON.stringify({
        KeyId: key.arn,
        Message: base64(digest),
        MessageType: "DIGEST",
        SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
      });
      const headers = signV4(
        {
          method: "POST",
          host: key.host,
          headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "TrentService.Sign" },
          body,
          service: "kms",
          region: key.region,
        },
        credentials(env),
        now(),
      );
      const response = object(
        await requestJson(fetch, "sign with AWS KMS", `https://${key.host}/`, { method: "POST", headers, body }).catch(
          explainRefusal(
            `this job may not sign with ${key.arn}: check kms:Sign in the role's policy and the key policy`,
            (error) => error.code === "AccessDeniedException",
          ),
        ),
        "AWS KMS response",
      );
      return fromBase64(string(response, "Signature", "AWS KMS response"));
    },
  };
}

function credentials(env: NodeJS.ProcessEnv): AwsCredentials {
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "AWS: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are not set; run aws-actions/configure-aws-credentials first",
    );
  }
  return { accessKeyId, secretAccessKey, sessionToken: env.AWS_SESSION_TOKEN };
}
