'use client'

import Image from 'next/image'
import { useState } from 'react'

/** One before/after pair: the photo, with the original 3D scene on hover or on tap. `large` is the full-width first project. */
export default function ResultShot({ name, caption, large = false, reveal }: { name: string; caption: string; large?: boolean; reveal?: number }) {
  const [show3d, setShow3d] = useState(false)
  const sizes = large ? '(max-width: 1212px) 100vw, 1180px' : '(max-width: 600px) 100vw, (max-width: 900px) 50vw, 390px'
  return (
    <figure className={`shot${show3d ? ' show3d' : ''}`} data-reveal={reveal === undefined ? undefined : String(reveal)}>
      <div className="frame">
        <Image src={`/landing/${name}-photo.jpg`} alt={`${caption}, photo Roomia`} fill sizes={sizes} />
        <Image className="three" src={`/landing/${name}-3d.jpg`} alt={`${caption}, scène 3D d’origine`} fill sizes={sizes} />
        <button type="button" aria-pressed={show3d} onClick={() => setShow3d(v => !v)}>
          {show3d ? 'Voir la photo' : 'Voir la 3D'}
        </button>
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  )
}
