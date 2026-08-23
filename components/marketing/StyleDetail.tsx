import Image from 'next/image'
import { Link } from '@/i18n/navigation'
import type { StyleMaterial, StyleTrait, StyleVisual } from '@/lib/style-details'

type Labels = {
  back: string
  palette: string
  materials: string
  traits: string
  inspirations: string
  cta: string
  photoLiving: string
  photoBedroom: string
  photoKitchen: string
  materialName: (key: string) => string
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

export default function StyleDetail({
  styleId,
  name,
  body,
  visual,
  traits,
  labels,
}: {
  styleId: string
  name: string
  body: string
  visual: StyleVisual
  traits: StyleTrait[]
  labels: Labels
}) {
  const photos = [
    { src: visual.photos.living, label: labels.photoLiving },
    { src: visual.photos.bedroom, label: labels.photoBedroom },
    { src: visual.photos.kitchen, label: labels.photoKitchen },
  ]

  return (
    <section className="rm-style-detail">
      <div className="rm-style-sheet">
        <Link href="/styles" className="rm-style-back">
          ‹ {labels.back}
        </Link>

        <div className="rm-style-hero">
          <div className="rm-style-hero-copy">
            <h1 className="rm-style-sheet-title">{name}</h1>
            <p className="rm-style-hero-body">{body}</p>
          </div>
          <figure className="rm-style-hero-photo">
            <Image
              src={visual.photos.living}
              alt={name}
              fill
              sizes="(max-width: 768px) 46vw, 28rem"
              className="object-cover"
              priority
            />
          </figure>
        </div>

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

        <div>
          <h2 className="rm-style-sheet-heading">{labels.materials}</h2>
          <ul className="rm-style-materials">
            {visual.materials.map((material: StyleMaterial) => (
              <li key={material.labelKey}>
                <div className="rm-style-material-swatch">
                  <Image src={material.src} alt="" fill sizes="96px" className="object-cover" />
                </div>
                <span>{labels.materialName(material.labelKey)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="rm-style-sheet-heading">{labels.traits}</h2>
          <ul className="rm-style-traits">
            {traits.slice(0, 6).map((trait, index) => (
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

        <div>
          <h2 className="rm-style-sheet-heading">{labels.inspirations}</h2>
          <div className="rm-style-detail-photos">
            {photos.map(photo => (
              <figure key={photo.src} className="rm-style-photo">
                <Image
                  src={photo.src}
                  alt={`${name} — ${photo.label}`}
                  fill
                  sizes="(max-width: 768px) 30vw, 18rem"
                  className="object-cover"
                />
              </figure>
            ))}
          </div>
        </div>

        <a href={`/room-composer?style=${encodeURIComponent(styleId)}`} className="rm-style-cta">
          {labels.cta}
        </a>
      </div>
    </section>
  )
}
