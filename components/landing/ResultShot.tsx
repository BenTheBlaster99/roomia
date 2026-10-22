'use client'

import Image from 'next/image'
import { useState } from 'react'

/** One before/after pair: the photo, with the original 3D scene on hover or on tap. */
export default function ResultShot({ name, caption, light }: { name: string; caption: string; light: string }) {
  const [show3d, setShow3d] = useState(false)
  return (
    <figure className={`shot${show3d ? ' show3d' : ''}`}>
      <div className="frame">
        <Image src={`/landing/${name}-photo.jpg`} alt={`${caption}, photo Roomia`} fill sizes="(max-width: 720px) 100vw, 590px" />
        <Image className="three" src={`/landing/${name}-3d.jpg`} alt={`${caption}, scène 3D d’origine`} fill sizes="(max-width: 720px) 100vw, 590px" />
        <button type="button" aria-pressed={show3d} onClick={() => setShow3d(v => !v)}>
          {show3d ? 'Voir la photo' : 'Voir la 3D'}
        </button>
      </div>
      <figcaption>
        {caption} <span>{light}</span>
      </figcaption>
    </figure>
  )
}
