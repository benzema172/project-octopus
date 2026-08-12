import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { getR2Config } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { attachmentContentDisposition } from "@/lib/r2/sanitize";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

type DownloadUrlBody = {
  projectId?: string;
  versionId?: string;
};

type VersionRow = {
  id: string;
  file_name: string;
  mime_type: string;
  r2_bucket: string;
  r2_object_key: string;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);

  if (!user) {
    return jsonError("Brak aktywnej sesji.", 401);
  }

  let body: DownloadUrlBody;

  try {
    body = (await request.json()) as DownloadUrlBody;
  } catch {
    return jsonError("Nieprawidłowe dane pobierania.", 400);
  }

  if (!body.projectId || !body.versionId) {
    return jsonError("Brakuje identyfikatora inwestycji lub wersji.", 400);
  }

  const project = await getProjectForUser(user, body.projectId);

  if (!project) {
    return jsonError("Nie znaleziono inwestycji dla tego workspace.", 404);
  }

  const supabase = createServiceSupabaseClient();
  const { data: version, error } = await supabase
    .from("document_versions")
    .select("id,file_name,mime_type,r2_bucket,r2_object_key")
    .eq("id", body.versionId)
    .eq("project_id", project.id)
    .maybeSingle<VersionRow>();

  if (error) {
    return jsonError(`Nie udało się pobrać danych pliku: ${error.message}`, 500);
  }

  if (!version) {
    return jsonError("Nie znaleziono wersji dokumentu w tej inwestycji.", 404);
  }

  const r2Config = getR2Config();

  if (version.r2_bucket !== r2Config.bucketName) {
    return jsonError("Dokument wskazuje nieprawidłowy magazyn.", 409);
  }

  const command = new GetObjectCommand({
    Bucket: version.r2_bucket,
    Key: version.r2_object_key,
    ResponseContentType: version.mime_type,
    ResponseContentDisposition: attachmentContentDisposition(version.file_name)
  });
  const downloadUrl = await getSignedUrl(createR2Client(), command, {
    expiresIn: DOWNLOAD_URL_TTL_SECONDS
  });

  return NextResponse.json(
    {
      downloadUrl,
      expiresIn: DOWNLOAD_URL_TTL_SECONDS
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
