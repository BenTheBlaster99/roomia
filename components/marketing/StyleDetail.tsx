'use client'

import Image from 'next/image'
import { Link } from '@/i18n/navigation'
import StylePhotoLightbox from '@/components/marketing/StylePhotoLightbox'
import {
  styleGallery,
  styleHero,
  type StyleMaterial,
  type StylePhoto,
  type StyleTrait,
  type StyleVisual,
} from '@/lib/style-details'

type Labels = {
  back: string
  palette: string
  materials: string
  traits: string
  motifs: string
  inspirations: string
  closePhoto: string
  prevPhoto: string
  nextPhoto: string
  cta: string
  materialName: Record<string, string>
}

function TraitIcon({ index }: { index: number }) {
  const i = index % 6
  const paths = [
    'M7 7h10v10H7z',
    'M12 5c3 4 5 6.5 5 9a5 5 0 1 1-10 0c0-2.5 2-5 5-9z',
    'M12 4l1.4 3.8L17.5 9l-3.2 2.5.9 4-3.2-2-3.2 2 .9-4L6.5 9l4.1-1.2L12 4z',
    'M7 8h10M7 12h10M7 16h6',
    'M8 8h3v3H8zm5 0h3v3h-3zM8 13h3v3H8zm5 0h3v3h-3z',
    'M12 6l.7 2.2H15l-1.9 1.4.7 2.2L12 10.4 10.2 11.8l.7-2.2L9 8.2h2.3L12 6z',
  ]
  return (
    <span className="rm-style-trait-icon" aria-hidden>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
        <path d={paths[i]} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function StyleMedia({
  src,
  alt,
  sizes,
  priority,
}: {
  src: string
  alt: string
  sizes?: string
  priority?: boolean
}) {
  if (src.startsWith('/')) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        className="object-cover"
        priority={priority}
      />
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className="absolute inset-0 h-full w-full object-cover"
      referrerPolicy="no-referrer"
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
    />
  )
}

function PhotoFigure({
  photo,
  name,
  onOpen,
}: {
  photo: StylePhoto
  name: string
  onOpen: () => void
}) {
  const alt = photo.kind ? `${name} — ${photo.kind}` : name
  return (
    <figure className="rm-style-photo-item">
      <button type="button" className="rm-style-photo rm-style-photo-open" onClick={onOpen}>
        <StyleMedia src={photo.src} alt={alt} sizes="(max-width: 768px) 30vw, 18rem" />
      </button>
      {photo.kind ? <figcaption className="rm-style-photo-kind">{photo.kind}</figcaption> : null}
    </figure>
  )
}

export default function StyleDetail({
  styleId,
  name,
  body,
  visual,
  traits,
  motifs,
  labels,
}: {
  styleId: string
  name: string
  body: string
  visual: StyleVisual
  traits: StyleTrait[]
  motifs: string[]
  labels: Labels
}) {
  const hero = styleHero(visual)
  const gallery = styleGallery(visual)
  const photos = visual.photos

  return (
    <section className="rm-style-detail">
      <StylePhotoLightbox
        photos={photos}
        name={name}
        labels={{ close: labels.closePhoto, prev: labels.prevPhoto, next: labels.nextPhoto }}
      >
        {openAt => (
          <div className="rm-style-sheet">
        <Link href="/styles" className="rm-style-back">
          ‹ {labels.back}
        </Link>

        <div className={hero ? 'rm-style-hero' : 'rm-style-hero rm-style-hero-solo'}>
          <div className="rm-style-hero-copy">
            <h1 className="rm-style-sheet-title">{name}</h1>
            <p className="rm-style-hero-body">{body}</p>
          </div>
          {hero ? (
            <button
              type="button"
              className="rm-style-hero-photo rm-style-photo-open"
              onClick={() => openAt(0)}
            >
              <StyleMedia
                src={hero.src}
                alt={name}
                sizes="(max-width: 768px) 46vw, 28rem"
                priority
              />
            </button>
          ) : null}
        </div>

        {visual.palette.length > 0 ? (
          <>
            <hr className="rm-style-rule" />
            <div className="rm-style-palette-row">
              <h2 className="rm-style-sheet-heading">{labels.palette}</h2>
              <div className="rm-style-palette">
                {visual.palette.map((hex, index) => (
                  <span
                    key={`${hex}-${index}`}
                    className="rm-style-dot"
                    style={{ background: hex }}
                    title={hex}
                  />
                ))}
              </div>
            </div>
          </>
        ) : null}

        {visual.materials.length > 0 ? (
          <div>
            <h2 className="rm-style-sheet-heading">{labels.materials}</h2>
            <ul className="rm-style-materials">
              {visual.materials.map((material: StyleMaterial) => (
                <li key={material.labelKey}>
                  <div className="rm-style-material-swatch">
                    {material.src ? (
                      <StyleMedia src={material.src} alt="" sizes="96px" />
                    ) : null}
                  </div>
                  <span>{labels.materialName[material.labelKey] ?? material.labelKey}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {traits.length > 0 ? (
          <div>
            <h2 className="rm-style-sheet-heading">{labels.traits}</h2>
            <ul className="rm-style-traits">
              {traits.map((trait, index) => (
                <li key={`${trait.title}-${index}`}>
                  <TraitIcon index={index} />
                  <div>
                    <p className="rm-style-trait-title">{trait.title}</p>
                    {trait.body ? <p className="rm-style-trait-body">{trait.body}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {motifs.length > 0 ? (
          <div>
            <h2 className="rm-style-sheet-heading">{labels.motifs}</h2>
            <ul className="rm-style-motifs">
              {motifs.map(motif => (
                <li key={motif}>{motif}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {gallery.length > 0 ? (
          <div>
            <h2 className="rm-style-sheet-heading">{labels.inspirations}</h2>
            <div className="rm-style-detail-photos">
              {gallery.map((photo, index) => (
                <PhotoFigure
                  key={`${photo.src}-${index}`}
                  photo={photo}
                  name={name}
                  onOpen={() => openAt(index + 1)}
                />
              ))}
            </div>
          </div>
        ) : null}

        <a href={`/room-composer?style=${encodeURIComponent(styleId)}`} className="rm-style-cta">
          {labels.cta}
        </a>
          </div>
        )}
      </StylePhotoLightbox>
    </section>
  )
}
