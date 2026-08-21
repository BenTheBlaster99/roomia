import Image from 'next/image'
import type { StyleVisual } from '@/lib/style-details'

type Labels = {
  palette: string
  materials: string
  traits: string
  photoLiving: string
  photoBedroom: string
  photoKitchen: string
}

const TRAIT_MARKS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

function StyleRule({ compact }: { compact?: boolean }) {
  return (
    <div className={`rm-style-rule${compact ? ' rm-style-rule-compact' : ''}`} aria-hidden>
      <span />
      <i />
      <span />
    </div>
  )
}

function SwatchRow({
  items,
  kind,
}: {
  items: string[]
  kind: 'color' | 'material'
}) {
  return (
    <div className="rm-style-swatches">
      {items.map((item, index) =>
        kind === 'color' ? (
          <div
            key={`${item}-${index}`}
            className="rm-style-swatch"
            style={{ background: item }}
          />
        ) : (
          <div key={`${item}-${index}`} className="rm-style-swatch">
            <Image src={item} alt="" fill sizes="120px" className="object-cover" />
          </div>
        ),
      )}
    </div>
  )
}

export default function StyleDetail({
  name,
  visual,
  traits,
  labels,
}: {
  name: string
  visual: StyleVisual
  traits: string[]
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
        <h1 className="rm-style-sheet-title">{name}</h1>
        <StyleRule />

        <div className="rm-style-sheet-grid">
          <div className="rm-style-sheet-info">
            <div>
              <h2 className="rm-style-sheet-heading">{labels.palette}</h2>
              <SwatchRow items={visual.palette} kind="color" />
            </div>
            <div>
              <h2 className="rm-style-sheet-heading">{labels.materials}</h2>
              <SwatchRow items={visual.materials} kind="material" />
            </div>
            <div>
              <h2 className="rm-style-sheet-heading">{labels.traits}</h2>
              <StyleRule compact />
              <ul className="rm-style-traits">
                {traits.slice(0, 8).map((trait, index) => (
                  <li key={trait}>
                    <span className="rm-style-trait-mark" aria-hidden>
                      {TRAIT_MARKS[index]}
                    </span>
                    <span>{trait}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rm-style-detail-photos">
            {photos.map(photo => (
              <figure key={photo.src} className="rm-style-photo">
                <Image
                  src={photo.src}
                  alt={`${name} — ${photo.label}`}
                  fill
                  sizes="(max-width: 720px) 55vw, 42vw"
                  className="object-cover"
                />
              </figure>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
