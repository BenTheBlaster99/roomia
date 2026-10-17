'use client'

import { useEffect, useRef } from 'react'
import { importSceneById } from '@/lib/studio-import/import-room'
import { useStudioStore } from '@/store/useStudioStore'

const SCENE_ID = /^[A-Za-z0-9_-]{21}$/

/** Opens a scene that is already on the server when the address carries `?scene=<id>`. */
export default function OpenSceneFromLink() {
  const started = useRef(false)

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('scene') ?? ''
    if (!SCENE_ID.test(id) || started.current) return
    started.current = true
    const store = useStudioStore.getState()
    store.setImportStatus('loading')
    void importSceneById(id).then(result => {
      if (result.ok) useStudioStore.getState().commitImportedRoom(result)
      else useStudioStore.getState().setImportStatus('error', result.message)
    })
  }, [])

  return null
}
