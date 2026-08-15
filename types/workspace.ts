export type WorkspaceKind = 'upload' | 'generation'

export type WorkspaceFileRow = {
  id: string
  user_id: string
  kind: WorkspaceKind
  name: string
  storage_path: string
  public_url: string
  parent_id: string | null
  created_at: string
}
