import "server-only";

import { S3Client } from "@aws-sdk/client-s3";
import { getR2Config } from "@/lib/env";

export function createR2Client() {
  const config = getR2Config();

  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
}
