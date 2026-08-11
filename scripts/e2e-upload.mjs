import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const requiredEnv = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "R2_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY"
];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);

if (missingEnv.length > 0) {
  console.error(`Missing environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const testId = randomUUID();
const email = `codex-e2e-${testId}@project-octopus.local`;
const password = `Octopus-${testId}-2026`;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const publicClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true
});

if (createUserError || !createdUser.user) {
  console.error(`Could not create test user: ${createUserError?.message ?? "missing user"}`);
  process.exit(1);
}

const { data: sessionData, error: signInError } = await publicClient.auth.signInWithPassword({
  email,
  password
});

if (signInError || !sessionData.session) {
  console.error(`Could not sign in test user: ${signInError?.message ?? "missing session"}`);
  process.exit(1);
}

const accessToken = sessionData.session.access_token;
const workspaceName = `Workspace ${email}`;

const { data: workspace, error: workspaceError } = await admin
  .from("workspaces")
  .insert({
    name: workspaceName,
    owner_id: createdUser.user.id
  })
  .select("id")
  .single();

if (workspaceError || !workspace) {
  console.error(`Could not create workspace: ${workspaceError?.message ?? "missing workspace"}`);
  process.exit(1);
}

const { error: memberError } = await admin.from("workspace_members").insert({
  workspace_id: workspace.id,
  user_id: createdUser.user.id,
  role: "owner"
});

if (memberError) {
  console.error(`Could not create membership: ${memberError.message}`);
  process.exit(1);
}

const { data: project, error: projectError } = await admin
  .from("projects")
  .insert({
    workspace_id: workspace.id,
    name: `Codex E2E ${testId}`,
    status: "active",
    created_by: createdUser.user.id
  })
  .select("id")
  .single();

if (projectError || !project) {
  console.error(`Could not create project: ${projectError?.message ?? "missing project"}`);
  process.exit(1);
}

const fileContent = `Project Octopus e2e upload ${testId}\n`;
const file = new Blob([fileContent], {
  type: "text/plain"
});
const fileName = `codex-e2e-${testId}.txt`;

const uploadUrlResponse = await fetch(`${baseUrl}/api/storage/upload-url`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    projectId: project.id,
    fileName,
    mimeType: "text/plain",
    fileSize: file.size
  })
});

if (!uploadUrlResponse.ok) {
  console.error(`Could not create upload URL: HTTP ${uploadUrlResponse.status}`);
  console.error(await uploadUrlResponse.text());
  process.exit(1);
}

const upload = await uploadUrlResponse.json();
const putResponse = await fetch(upload.uploadUrl, {
  method: "PUT",
  headers: upload.headers,
  body: file
});

if (!putResponse.ok) {
  console.error(`R2 upload failed: HTTP ${putResponse.status}`);
  console.error(await putResponse.text());
  process.exit(1);
}

const hashBuffer = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
const sha256 = Array.from(new Uint8Array(hashBuffer))
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");

const completeResponse = await fetch(`${baseUrl}/api/storage/complete`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    token: upload.token,
    sha256
  })
});

if (!completeResponse.ok) {
  console.error(`Could not complete upload: HTTP ${completeResponse.status}`);
  console.error(await completeResponse.text());
  process.exit(1);
}

const completed = await completeResponse.json();
const { data: documentVersion, error: versionError } = await admin
  .from("document_versions")
  .select("id,r2_object_key,sha256,upload_status")
  .eq("id", completed.versionId)
  .single();

if (versionError || !documentVersion) {
  console.error(`Could not verify document version: ${versionError?.message ?? "missing version"}`);
  process.exit(1);
}

if (documentVersion.upload_status !== "uploaded" || documentVersion.sha256 !== sha256) {
  console.error("Document version was saved, but metadata does not match the uploaded file.");
  process.exit(1);
}

console.log(`E2E upload OK: ${completed.documentId}`);
console.log(`R2 object: ${documentVersion.r2_object_key}`);
