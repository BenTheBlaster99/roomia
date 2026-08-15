import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { nanoid } from 'nanoid'
import type { WorkspaceFileRow, WorkspaceKind } from '@/types/workspace'

export type { WorkspaceFileRow, WorkspaceKind } from '@/types/workspace'

function hasR2(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET &&
      process.env.R2_PUBLIC_URL,
  )
}

function getR2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'file'
}

function buildStoragePath(userId: string, filename: string): string {
  return `${userId}/${Date.now()}-${nanoid(8)}-${sanitizeName(filename)}`
}

async function uploadToR2(opts: {
  storagePath: string
  body: Buffer
  contentType: string
}): Promise<string> {
  const client = getR2Client()
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: opts.storagePath,
      Body: opts.body,
      ContentType: opts.contentType,
    }),
  )
  const base = process.env.R2_PUBLIC_URL!.replace(/\/$/, '')
  return `${base}/${opts.storagePath}`
}

async function uploadToSupabaseStorage(
  supabase: SupabaseClient,
  opts: { storagePath: string; body: Buffer; contentType: string },
): Promise<string> {
  const { error } = await supabase.storage.from('workspace').upload(opts.storagePath, opts.body, {
    contentType: opts.contentType,
    upsert: false,
  })
  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from('workspace').getPublicUrl(opts.storagePath)
  return data.publicUrl
}

export function storageBackend(): 'r2' | 'supabase' {
  return hasR2() ? 'r2' : 'supabase'
}

/** Upload bytes to R2 (preferred) or Supabase Storage bucket `workspace`. */
export async function uploadWorkspaceBytes(
  supabase: SupabaseClient,
  opts: {
    userId: string
    filename: string
    body: Buffer
    contentType: string
  },
): Promise<{ storagePath: string; publicUrl: string }> {
  const storagePath = buildStoragePath(opts.userId, opts.filename)
  const publicUrl = hasR2()
    ? await uploadToR2({
        storagePath,
        body: opts.body,
        contentType: opts.contentType,
      })
    : await uploadToSupabaseStorage(supabase, {
        storagePath,
        body: opts.body,
        contentType: opts.contentType,
      })

  return { storagePath, publicUrl }
}

export async function insertWorkspaceFile(
  supabase: SupabaseClient,
  row: {
    userId: string
    kind: WorkspaceKind
    name: string
    storagePath: string
    publicUrl: string
    parentId?: string | null
  },
): Promise<WorkspaceFileRow> {
  const { data, error } = await supabase
    .from('workspace_files')
    .insert({
      user_id: row.userId,
      kind: row.kind,
      name: row.name,
      storage_path: row.storagePath,
      public_url: row.publicUrl,
      parent_id: row.parentId ?? null,
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data as WorkspaceFileRow
}

export async function listWorkspaceFiles(
  supabase: SupabaseClient,
  userId: string,
): Promise<WorkspaceFileRow[]> {
  const { data, error } = await supabase
    .from('workspace_files')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as WorkspaceFileRow[]
}
